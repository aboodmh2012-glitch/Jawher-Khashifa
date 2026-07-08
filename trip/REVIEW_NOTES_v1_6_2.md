# Trip v1.6.2 SDK Documentation Alignment

Reviewed against Amadeus Python SDK 8.0.0 documentation.

## Fixed
- Removed unsupported `timeout` option from `Client(...)`. The SDK documents client options such as client_id, client_secret, hostname, host, ssl, port, logger, log_level, and custom app info.
- Set `custom_app_id` and `custom_app_version` consistently.
- If a custom base URL is provided, it is passed as SDK `host` after stripping scheme.
- Confirmed Flight Offers Search uses `amadeus.shopping.flight_offers_search.get(**params)`.
- Confirmed Flight Offers Pricing uses `amadeus.shopping.flight_offers.pricing.post(body, **params)`.
- Confirmed Flight Create Orders uses `amadeus.booking.flight_orders.post(flight, travelers)`.
- Confirmed Airport & City Search uses `amadeus.reference_data.locations.get(...)`.
- Confirmed Check-in Links uses `amadeus.reference_data.urls.checkin_links.get(...)`.
- Confirmed SeatMap Display uses `amadeus.shopping.seatmaps.post(body)`.

## Notes
- `queuingOfficeId`, `remarks`, `ticketingAgreement`, and extra Enterprise-specific booking fields are logged but not passed to `flight_orders.post()` because the official SDK method accepts only `(flight, travelers)`. Use a custom Enterprise adapter if Amadeus/aggregator requires these fields.
- Ticketing/payment capture remains outside this Self-Service booking wrapper.
