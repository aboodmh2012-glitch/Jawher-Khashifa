# Trip v1.6.3 — Odoo 18 + Amadeus Verification & Fixes

Reviewed against Odoo 18 documentation/migration guides and the official
Amadeus Python SDK / REST documentation (amadeus4dev/amadeus-python and
developers.amadeus.com).

## Odoo 18 compatibility — verified, no changes required
- All views already use `<list>` (not the removed `<tree>` tag).
- No use of the removed `attrs=`/`states=` view syntax.
- `trip_booking_views.xml` already uses the Odoo 18 `<chatter/>` tag instead
  of the legacy `oe_chatter` div.
- All `act_window` actions use `view_mode = "list,form"`.
- `res_config_settings_views.xml` already uses the modern
  `<app>/<block>/<setting>` settings structure.
- Website templates already use `t-out` (not the legacy `t-esc`).

## Fixed in this version

### 1. Transfer / Car Search and Booking used the wrong HTTP verb (bug)
`services/amadeus_cars.py` called Transfer Search with `GET` and query-string
parameters. The real Amadeus Transfer Search API is `POST
/v1/shopping/transfer-offers` with a JSON body — GET is not supported, so the
previous code would fail at runtime.
- Added `search_transfers()` that builds a proper JSON body
  (`startLocationCode`, `startDateTime`, `passengers`, and one of
  `endGeoCode` / `endAddressLine` / `endGooglePlaceId`, plus optional
  `endCityName`, `endZipCode`, `endCountryCode`, `transferType`) and calls
  `POST /v1/shopping/transfer-offers`.
- Kept `search_cars()` as a backward-compatible alias.
- Fixed `book_car()` to call `POST /v1/ordering/transfer-orders?offerId=...`
  with a `{'data': {'note': ..., 'passengers': [...]}}` body, matching the
  documented Transfer Booking contract (offer ID as query param, passengers
  in the body). Signature changed from `book_car(payload, booking=None)` to
  `book_car(offer_id, passengers, note=None, booking=None)` — safe, since
  this method was not yet wired into any controller/model.

### 2. Wallet double-spend race condition
`action_pay_from_wallet_and_issue()` computed the wallet balance by summing
transactions with no locking. Two concurrent payment requests for the same
customer could both read the same balance and both pass the "sufficient
funds" check, resulting in an overdrawn wallet.
- Added `_lock_wallet()`, which takes a PostgreSQL transaction-level advisory
  lock (`pg_advisory_xact_lock`) keyed by `partner_id`/`company_id` before
  the balance is read. The lock is released automatically when the request's
  database transaction commits or rolls back, so concurrent wallet payments
  for the same customer are now serialized.

### 3. Housekeeping
- Manifest version bumped to `1.6.3` (was `1.6.0`, inconsistent with the
  filename/notes of prior "1.6.x" reviews).
- Removed all `__pycache__` directories from the distributed zip.

## Still open / not changed in this pass
- Hotel and car/transfer services still use the legacy HTTP client
  (`amadeus_client.py`) rather than the official SDK; only flights are fully
  on the SDK. This is documented, intentional scope from v1.6.1/v1.6.2.
- `search_transfers()` / `book_car()` are implemented and correct against the
  documented API, but are still not wired into any website/portal controller
  or `trip.car.rental` workflow — that integration is a separate follow-up.
- Ticketing/payment settlement for flights still requires a consolidator or
  Enterprise/NDC adapter outside this Self-Service wrapper (unchanged
  business constraint, not a bug).
- `client_secret` is stored in plain text in `ir.config_parameter`, standard
  Odoo practice but worth hardening (e.g. `ir.config_parameter` access is
  already admin-only) if your threat model requires it.

## Validation performed
- `python3 -m py_compile` on every `.py` file: PASS
- XML well-formedness on every `.xml` file: PASS
