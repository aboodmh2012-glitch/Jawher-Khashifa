# Trip v1.8.1 — Security Hardening Release

This maintenance release closes two security issues found in a full code
review of the v1.8.0 package. No schema or workflow redesign — behaviour is
unchanged for legitimate flows.

## Fixes

### Portal — operations were readable across all customers (security, data leak)
`trip.operation` granted `base.group_portal` read in `ir.model.access.csv`
(added with the v1.8.0 manual-operations feature) but shipped **without a
matching record rule**, unlike every other portal-exposed model. A portal user
could therefore read *every* operation of *every* customer and company —
exposing PNRs, ticket numbers, payment references, amounts, and customer
links (IDOR).

A new `trip_operation_portal_own_rule` `ir.rule` now restricts portal read to
operations of the user's own bookings
(`booking_id.partner_id == user.partner_id`), matching the existing portal
rules for bookings, passengers, segments, hotel stays, and car rentals.

### Website — search offers are now tamper-proof (security, price tampering)
Search offers are round-tripped through the browser as a base64 `_payload`
hidden field and decoded when the customer selects an offer. Base64 is not a
signature, so the payload could be edited client-side. Flights and hotels
re-validate the price against Amadeus before payment, but **transfers/cars
have no re-pricing call** (`action_price_booking` keeps the quoted amount), so
a tampered `monetaryAmount` drove the invoice and wallet deduction directly —
a financial loss to the agency.

`_encode_offer_payload` now signs the payload with HMAC-SHA256 using the
server-only `database.secret`, and `_decode_offer_payload` verifies the
signature with a constant-time compare before decoding. Any tampered or
unsigned offer is rejected with "Invalid selected offer. Please search again."
This closes the transfer price-tampering path and hardens flights/hotels as
defense in depth. The signing key is never sent to the browser.

## Validation performed
- `python3 -m py_compile` on changed Python files: PASS
- XML well-formedness on changed XML files: PASS
- Offer `_payload` producers/consumers cross-checked; hidden-field templates
  unchanged (signed payload is a plain ASCII string).

## Carried over from v1.8.0
Manual operations, advanced search, and reporting on top of the full Odoo 18 +
Amadeus integration. See `REVIEW_NOTES_v1_8_0.md` for details.
