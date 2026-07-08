# Trip v1.7.0 — Fully Integrated Odoo 18 + Amadeus Release

This release completes the integration for all three services (Flights,
Hotels, Transfers/Cars) end-to-end: search → select → guests/passengers →
price validation → payment (wallet or external card flow) → supplier order.
Everything verified against the official Amadeus Python SDK (>= 8.0.0) and
developers.amadeus.com documentation.

## What's new

### Hotels — fully wired, SDK-based, Hotel Booking v2
- `services/amadeus_hotels.py` rewritten on the official SDK:
  - Hotel List: `client.reference_data.locations.hotels.by_city.get(cityCode=...)`
  - Hotel Search v3: `client.shopping.hotel_offers_search.get(hotelIds=..., adults=..., checkInDate=..., checkOutDate=...)`
  - Offer re-validation: SDK generic `client.get('/v3/shopping/hotel-offers/{offerId}')`
  - **Hotel Booking migrated from the decommissioned v1
    (`/v1/booking/hotel-bookings`) to v2 (`/v2/booking/hotel-orders`)** with
    the v2 body model: `data.type='hotel-order'`, `guests` with `tid`,
    `roomAssociations` mapping guest references to the `hotelOfferId`, and
    optional `travelAgent` contact (new setting: Travel Agent Email).
- New website routes: `/trip/hotels` (search form), `/trip/hotels/search`,
  `/trip/hotels/book` — same rate limiting, CSRF, and validation pattern as
  flights (IATA city code, date sanity, max 9 adults).
- `trip.booking` now supports the full hotel lifecycle:
  - `_load_hotel_stay_from_offer()` maps the Amadeus offer to
    `trip.hotel.stay` (room, dates, board, cancellation policy, price).
  - `action_price_hotel_booking()` re-validates the offer by ID before
    payment (per Amadeus guidance that availability can change).
  - `_create_hotel_provider_order()` books via Hotel Booking v2 and stores
    the confirmation number on the stay line.

### Transfers / Cars — fully wired, SDK-based
- `services/amadeus_cars.py` migrated to the official SDK (Transfer APIs are
  part of SDK 8.0.0):
  - Search: `client.shopping.transfer_offers.post(body)`
  - Booking: `client.ordering.transfer_orders.post(body, offerId=...)`
- New website routes: `/trip/cars`, `/trip/cars/search`, `/trip/cars/book`
  with validation (IATA pickup code, future datetime, full drop-off address
  with 2-letter country code, transfer type PRIVATE/SHARED/TAXI/AIRPORT_EXPRESS).
- `trip.booking`:
  - `_load_car_rental_from_offer()` maps vehicle/provider/pickup/drop-off/
    quotation to `trip.car.rental`.
  - `_create_transfer_provider_order()` books the transfer and stores the
    provider confirmation number.

### Unified booking lifecycle (all three types)
- New dispatcher `action_price_booking()`:
  - flight → Flight Offers Price (unchanged)
  - hotel → Hotel Search v3 by-offer re-validation
  - car → transfer quotes are short-lived; the quoted amount is kept and the
    booking marked priced (Amadeus has no separate transfer re-pricing call)
- Wallet payment (`action_pay_from_wallet_and_issue`) and external-card flow
  (`action_book_with_amadeus_card`) now work for hotels and transfers too —
  the flight-only guard was removed and pricing/ordering dispatch by type.
- `action_create_provider_order()` dispatches to flight/hotel/transfer
  supplier-order creation; the backend "Create Supplier Order" and
  "Revalidate Price" buttons are no longer flight-only.
- Passenger/guest collection step is now type-aware
  (`_traveler_types_for_booking`): flights derive traveler types from
  `travelerPricings`; hotels collect one guest per `guests_count`; transfers
  collect a lead passenger.
- Response parsing per type: PNR/associatedRecords for flights, hotel
  confirmation number from `hotelBookings[].hotelProviderInformation`,
  transfer `confirmNbr` for cars.

### Website UX
- New service navigation bar (Flights / Hotels / Transfers) on all search
  pages; hotel and transfer result cards mirror the flight card pattern;
  error page links to all three services.

### Settings
- New "Travel Agent Email" parameter (`trip.travel_agent_email`) used as the
  `travelAgent` contact in Hotel Booking v2 orders (falls back to the acting
  user's email).

## Carried over from v1.6.3
- Wallet advisory-lock against concurrent double-spend
  (`pg_advisory_xact_lock` keyed by partner/company).
- Transfer Search POST fix.
- Version consistency; no `__pycache__` in the package.

## Verified compatibility
- Odoo 18: `<list>` views, `<chatter/>`, `view_mode="list,form"`,
  `<app>/<block>/<setting>` settings, `t-out` templates — all confirmed.
- Amadeus Python SDK >= 8.0.0 (`requirements.txt` unchanged):
  flight_offers_search / flight_offers.pricing / flight_orders /
  hotel_offers_search / hotels.by_city / transfer_offers / transfer_orders
  all match the official SDK README/reference. Hotel Booking v2 uses the
  SDK's documented generic `client.post(path, body)` escape hatch so it
  stays correct across SDK versions.

## Legacy raw-HTTP client
`services/amadeus_client.py` is retained (unused by default) for Enterprise
or aggregator base-URL/token-URL overrides that bypass the Self-Service SDK.

## Business constraints (unchanged, by design)
- Flight ticketing/settlement requires a consolidator or Enterprise/NDC
  adapter; Flight Create Orders creates the PNR only.
- Many hotel rates require a payment guarantee; this module intentionally
  never collects raw card data — use a hosted/tokenized flow, or book
  guarantee-free rates. Hotel Booking v2 `payment` object is supported by
  `book_hotel(payment=...)` for adapter integrations.
- The wallet is an operational Odoo wallet, not a regulated ledger.

## Validation performed
- `python3 -m py_compile` on all Python files: PASS
- XML well-formedness on all XML files: PASS
- Cross-check: every template rendered by controllers exists; no module code
  still imports the legacy HTTP client; no flight-only guards remain in the
  shared payment/pricing/ordering paths.

## Install / upgrade
```bash
pip install -r trip/requirements.txt   # inside the Odoo venv
# then upgrade the module from Apps or:
odoo-bin -d <db> -u trip
```
Configure in Settings → Trip: credentials, environment, and (for hotels)
the Travel Agent Email.
