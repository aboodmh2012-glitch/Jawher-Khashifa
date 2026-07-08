# Trip v1.7.1 — Review & Hardening Release

This maintenance release fixes correctness and robustness issues found in a
full code review of the v1.7.0 integrated package. No schema or workflow
redesign — behaviour is unchanged except where a real bug was corrected.

## Fixes

### Flights — held infants are now linked to an adult (correctness)
`trip.booking._build_amadeus_travelers()` now sets `associatedAdultId` on
every infant traveler, pairing one infant per accompanying adult. Amadeus
Flight Create Orders rejects a held-infant traveler that is not associated
with an adult, so previously **any booking containing an infant failed** at
supplier-order creation. A clear error is raised if infants outnumber adults.

### Website — price-confirmation step is now reachable (workflow)
The passenger step (`/trip/booking/<id>/passengers`) now redirects to the
existing `/trip/booking/<id>/confirm-price` revalidation page instead of
jumping straight to `/payment`. This matches the "Continue to price
confirmation" button and the 6-step wizard, and revalidates the supplier
price before the payment page shows a total. The confirm-price route and
template shipped in 1.7.0 were previously unreachable.

### Wallet — multi-currency balance (robustness)
`trip.booking._get_wallet_balance()` no longer filters wallet transactions by
a single currency. Each posted transaction is converted to the target
(booking) currency at today's rate via `res.currency._convert`, so a booking
is not incorrectly blocked when the wallet was funded in another currency.

### Public search — rate limiting no longer trusts spoofable headers (security)
`_rate_limit_key()` now keys on Odoo's resolved `remote_addr` (werkzeug
ProxyFix applies the trusted `X-Forwarded-For` only in proxy mode) instead of
reading a raw client-supplied `X-Forwarded-For` header, which a caller could
spoof to bypass the search rate limit. The limit is shared across all three
public search endpoints (flights/hotels/transfers).

### Consistency
- `custom_app_version` reported to the Amadeus SDK bumped to `1.7.1`
  (was a stale `1.6.2` in 1.7.0).

## Validation performed
- `python3 -m py_compile` on all Python files: PASS
- XML well-formedness on all XML files: PASS
- Templates referenced by controllers, menu actions, and view field names
  cross-checked against models: OK
- No `__pycache__` in the package.

## Carried over from v1.7.0
Full Odoo 18 + Amadeus integration for Flights, Hotels (Booking v2), and
Transfers/Cars; wallet advisory-lock against double-spend; unified
pricing/payment/ordering dispatch by booking type. See
`REVIEW_NOTES_v1_7_0.md` for details.
