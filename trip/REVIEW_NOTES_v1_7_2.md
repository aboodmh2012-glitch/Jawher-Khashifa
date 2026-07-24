# Trip v1.7.2 — Full Code Review Notes

This document records **all** observations from a complete code review of the
v1.7.1 package (13 Python files + security + views/templates), and the fixes
applied in this release. Findings are grouped by severity. Items marked
**FIXED** are addressed in v1.7.2; items marked **RECOMMENDED** are documented
for a follow-up release and left unchanged to avoid unverified refactors.

---

## 🔴 Critical — financial / security

### 1. Offer price could be tampered by the client (FIXED)
**Files:** `controllers/website_trip.py` (`_encode_offer_payload` /
`_decode_offer_payload`), `models/trip_booking.py:action_price_booking`.

The selected offer — including its price — round-trips through the browser as
a base64 hidden form field and is decoded back on the server in
`flights_book_offer` / `hotels_book_offer` / `cars_book_offer`, where
`net_amount` is taken from the decoded payload.

- Flights and hotels re-validate the price against Amadeus at the
  `confirm-price` step (`action_price_flight_booking` /
  `action_price_hotel_booking`), so a tampered price is corrected before
  payment.
- **Transfers/cars are NOT re-priced.** `action_price_booking` for the car
  branch keeps the stored amount and marks the booking `priced`. A user could
  therefore edit `quotation.monetaryAmount` in the encoded payload to an
  arbitrarily low value; the wallet is then debited the tampered amount while
  the real transfer is still booked with the provider via `offer_id`.

**Fix:** the offer payload is now signed with an HMAC-SHA256 keyed on the
per-database `database.secret`. `_encode_offer_payload` appends the signature;
`_decode_offer_payload` verifies it with `hmac.compare_digest` and rejects any
tampered payload with "Invalid selected offer. Please search again." This
closes the transfer price-tampering hole and hardens the flight/hotel flows
against payload tampering in general. The secret never leaves the server.

### 2. Duplicate supplier order / double booking (FIXED)
**Files:** `models/trip_booking.py:action_create_provider_order`,
`controllers/website_trip.py` `/trip/booking/<id>/issue`.

After a successful wallet/card flow the booking already has a provider
order/PNR and is `booked`/`confirmed`. The manual `/issue` route (POST) had no
state or reference guard, so calling it again invoked
`action_create_provider_order()` a second time — creating a **duplicate PNR /
hotel order / transfer order and a duplicate supplier charge**.

**Fix:** `action_create_provider_order` now skips any booking that already has
an `amadeus_reference` or is in state `booked` / `ticketed` / `confirmed`,
making supplier-order creation idempotent.

---

## 🟠 Medium

### 3. Child/infant placeholder date of birth (FIXED)
**File:** `models/trip_booking.py:_build_amadeus_travelers`.

A missing `date_of_birth` fell back to `1990-01-01` for every traveler,
including infants and children. Amadeus validates the traveler type against
the DOB, so a "held infant" born in 1990 is rejected at Flight Create Orders.

**Fix:** `_build_amadeus_travelers` now raises a clear error when a `child` or
`infant` passenger has no date of birth, before the order is attempted.

### 4. Rate-limit store in `ir.config_parameter` (RECOMMENDED)
**File:** `controllers/website_trip.py:_check_rate_limit`.

Every distinct client IP creates a permanent `ir.config_parameter` row that is
never cleaned up (unbounded table growth), and `get_param`/`set_param` is a
non-atomic read-modify-write, so under concurrency the window can be exceeded
or stamps lost.

**Recommendation:** move the sliding-window store to a dedicated indexed model
(or an in-memory/cache backend) with a scheduled `ir.cron` to purge expired
windows. Left unchanged in 1.7.2 because it is a hardening refactor, not a
functional defect, and warrants its own migration + tests.

---

## 🟡 Minor / improvements (RECOMMENDED)

### 5. Pricing-rule granularity not fully honoured
**Files:** `models/trip_pricing_rule.py`,
`models/trip_booking.py:action_apply_pricing_rule`.

`trip.pricing.rule` defines `city`, `provider` and `cabin_class`, but
`action_apply_pricing_rule` only filters by `service_type` and `company_id`
(plus airline/cabin for flights). Hotel and car markup rules therefore apply
the first matching rule for the type regardless of city/provider.
**Recommendation:** extend the domain to match `city`/`provider` for
hotel/car bookings.

### 6. `cabin_class` never populated on flight segments
**File:** `models/trip_booking.py:_load_flight_segments_from_offer`.

Flight segments are created without `cabin_class`, so the `cabin_class` branch
of the pricing-rule domain never activates in practice.
**Recommendation:** map the fare cabin from `travelerPricings[].fareDetailsBySegment[].cabin`.

### 7. No wallet refund / provider cancellation on cancel
**File:** `models/trip_booking.py:action_cancel`.

`action_cancel` only flips `state` to `cancelled`; it does not reverse a wallet
`booking_payment` transaction or cancel the Amadeus order.
**Recommendation:** add a refund wallet transaction and a provider-cancellation
call (where the Amadeus contract allows) as part of cancellation.

### 8. Inconsistent default `access_mode`
**Files:** `services/amadeus_sdk_client.py` (`self_service`),
`models/trip_api_log.py` and `services/amadeus_client.py` (`enterprise`).

Cosmetic, but the value logged for the same request can differ from the value
the SDK actually used. **Recommendation:** align the defaults.

---

## ✅ Confirmed strengths (unchanged)
- `pg_advisory_xact_lock` serialises wallet operations per customer/company;
  "book supplier first, then debit wallet and invoice" ordering is correct.
- Flight and hotel prices are re-validated against Amadeus before payment.
- No raw card data is collected or stored (PCI-safe; hosted/tokenised flows).
- `ir.rule` records correctly separate agent / manager / portal visibility,
  and sensitive API payloads are hidden unless `debug_logging` is enabled.
- Search rate limiting keys on the resolved `remote_addr`, not the spoofable
  raw `X-Forwarded-For` header.

---

## Changes in v1.7.2
- HMAC-signed offer payloads (offer/price tamper protection). *(Finding 1)*
- Idempotent supplier-order creation. *(Finding 2)*
- Child/infant date-of-birth is required before flight ordering. *(Finding 3)*
- `custom_app_version` reported to the Amadeus SDK bumped to `1.7.2`.

## Validation performed
- `python3 -m py_compile` on all Python files: PASS
- XML well-formedness on all XML files: PASS
- No `__pycache__` shipped in the package.

## Carried over
Full Odoo 18 + Amadeus integration for Flights, Hotels (Booking v2) and
Transfers/Cars; wallet advisory-lock against double-spend; unified
pricing/payment/ordering dispatch by booking type. See `REVIEW_NOTES_v1_7_1.md`
and `REVIEW_NOTES_v1_7_0.md`.
