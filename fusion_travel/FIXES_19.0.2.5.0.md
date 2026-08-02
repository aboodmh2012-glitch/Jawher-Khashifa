# Fusion Travel 19.0.2.5.0 — Follow-up fixes

Closes three High findings from the post-19.0.2.4.0 review before public go-live.

## Changes

1. **Infant / traveler payload**
   - Send Amadeus `travelerType` (`ADULT` / `CHILD` / `HELD_INFANT`).
   - Restore `associatedAdultId` linking (one infant per adult).
   - Reject bookings with more infants than adults.
   - Require email for every flight traveler.

2. **Validate before wallet debit**
   - New `_ensure_provider_booking_ready()` runs before invoice post / wallet
     capture in `_pay_from_wallet_and_create_provider_order`, and again at the
     start of `_create_provider_order`.
   - Missing DOB, phone, email, or infant linkage fails *before* money moves.

3. **Hotel reprice integrity**
   - If the provider response does not contain the exact selected `offer_id`,
     pricing fails with a clear error.
   - Removed the unsafe fallback to `offers[0]`.

## Validation

- `python3 -m py_compile` on all module Python files: PASS
- XML well-formedness: PASS
