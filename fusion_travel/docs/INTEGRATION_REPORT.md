# Fusion Travel Integration Report

## Objective

Combine the current `smartexsoftorg/fusion_travel` Odoo 19 module, the supplied Trip backend, and the Fusion Travel Figma prototype into one upgrade-compatible add-on. The technical name remains `fusion_travel`; this is an upgrade of the existing database module, not a parallel application.

## Architecture

| Area | Decision |
|---|---|
| Existing ticket/accounting data | Preserve `fusion.travel.flight.ticket`, `fusion.travel.airline`, legacy fields, relation tables and XML IDs. |
| Booking backend | Consolidate bookings, passengers, segments, hotels, transfers, pricing and wallet workflows. |
| Provider connection | Direct OAuth2/REST client with test/production base URLs, bounded timeout, redacted logging and no archived SDK dependency. |
| Public website | Odoo QWeb + SCSS + JavaScript derived from Figma rather than React/Tailwind. |
| Portal | Customer-owned booking/ticket views under `/my/travel`. |
| Accounting | Native sale orders, customer invoices, supplier bills/credits and wallet settlement journal entries. |
| Security | Travel User, Accountant and Manager groups, multi-company and ownership record rules, private server workflow helpers. |

## Website routes

- `/travel` and `/travel/flights`
- `/travel/flights/search`
- `/travel/hotels` and `/travel/hotels/search`
- `/travel/cars` and `/travel/cars/search`
- Booking selection, passengers, price confirmation, payment and provider-order routes
- `/my/travel/bookings` and `/my/travel/booking/<id>`

## Provider boundaries

- Flight Create Orders creates a PNR/reservation. Ticket issuance and post-ticketing operations remain with the consolidator.
- `queuingOfficeId` is optional and should only be configured when Amadeus has enabled multiple consolidators for the application.
- The current Cars service is Amadeus Transfers, not self-drive car rental.
- Hosted card processing is intentionally disabled unless a separate PCI-compliant adapter and signed callback are installed.

## Figma status

The shared Fusion identity, primary flight-search/results experience, traveler collection, price confirmation, payment, confirmation and portal structure are implemented as responsive Odoo templates. This is not a claim that every Figma frame and interaction state is pixel-complete; remaining hotel/car/deals/mobile states still require runtime visual QA.

## Validation completed

- Python compilation and AST scan.
- XML parsing and duplicate external-ID scan.
- Manifest data/asset existence checks.
- ACL/model reference and duplicate ACL checks.
- Legacy XML-ID preservation check.
- JavaScript syntax check.
- Embedded-secret and unsafe `t-raw` scan.

## Validation still required

- Exact Odoo 19 registry/model setup.
- PostgreSQL migration on a restored database.
- Browser route/portal tests.
- Live provider and consolidator tests.
- Hosted-payment callback/reconciliation tests.
- Infrastructure rate-limit/load tests.
