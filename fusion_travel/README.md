# Fusion Travel — Integrated Odoo 19 Add-on v1.1

This package consolidates the uploaded Trip backend, the existing Fusion Travel ticket/accounting direction, and the supplied Figma travel experience into one technical add-on named `fusion_travel`.

## Included
- Odoo 19 manifest and module namespace.
- Flight, hotel and airport-transfer Amadeus adapters from the uploaded backend.
- Server-side search sessions and opaque offer tokens (browser payloads are no longer trusted).
- Unified booking, passenger, segment, hotel, vehicle, pricing, wallet and API-log models.
- Flight ticket operations with supplier/customer amounts, profit, exchange/refund/void linkage, multi-company support and safe cancellation rules.
- Figma-derived responsive QWeb pages for search, results, traveler details, price check, payment and confirmation.
- Website routes under `/travel/...` and portal routes under `/my/travel/...`.
- Role separation: Travel User, Accountant and Manager.

## Important provider boundary
The uploaded `amadeus_cars.py` integrates **Amadeus Transfers**, not classic self-drive car-rental inventory. The UI therefore says “Cars & Airport Transfers” while reusing a generic vehicle-service model. A real car-rental supplier adapter should be added before advertising self-drive availability.

## Installation
1. Copy `fusion_travel` into the Odoo 19 custom-addons directory.
2. Install Python dependency: `pip install -r fusion_travel/requirements.txt`.
3. Restart Odoo, update the Apps list, and install **Fusion Travel**.
4. Configure Amadeus credentials and service products in Settings → Fusion Travel.

## Before production
- Run installation and HTTP tests against the exact Odoo 19 build.
- Connect a hosted/tokenized payment provider; never collect raw card data in these forms.
- Add provider webhooks/polling and idempotent reconciliation for pending bookings.
- Replace the CSS-only brand mark with the official exported Fusion logo asset.
- Add a true rental-car provider if self-drive inventory is required.


See `INTEGRATION_MAP_AR.md` for the Arabic architecture and screen-to-backend mapping, and `VALIDATION_REPORT.md` for completed checks.
