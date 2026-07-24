# Fusion Travel — Integrated Odoo 19 Add-on (19.0.2.4.0)

`fusion_travel` is the upgrade-compatible unified travel module for Odoo 19. It combines the existing Fusion Travel ticket/accounting module, the supplied Trip backend, and the approved Fusion Travel Figma direction without changing the technical module name.

## Included

- Flight, hotel and airport-transfer search/booking adapters.
- Direct OAuth2/REST provider client with bounded timeouts, redacted diagnostics and no extra Python package.
- Server-side search sessions and one-time opaque offer tokens.
- Booking, passenger, itinerary, hotel, transfer, pricing, wallet and API-log models.
- Supplier/customer flight-ticket amounts, issue/exchange/refund/void linkage and accounting controls.
- Responsive Odoo QWeb/SCSS/JavaScript website and customer portal pages.
- Multi-company record rules and separate Travel User, Travel Accountant and Travel Manager roles.
- Upgrade scripts from the existing `19.0.1.0.0` module.

## Important provider boundary

Amadeus Self-Service Flight Create Orders creates a reservation/PNR. Ticket issuance and post-ticketing changes/refunds require the configured consolidator. The vehicle integration is Amadeus Transfers, not classic self-drive rental inventory.

The historical Amadeus Python SDK and OpenAPI repositories were archived in July 2026. This build calls the documented REST endpoints directly and therefore does not require the archived SDK package.

## Installation / upgrade

1. Back up the database and filestore together.
2. Test on a restored staging database first.
3. Replace the existing `fusion_travel` folder with this folder. Do not install the old Trip module in parallel.
4. Restart Odoo and run an upgrade of `fusion_travel`.
5. Configure provider credentials, products, wallet journal/liability account, users and consolidator settings.
6. Run controlled test searches and non-production bookings before enabling public traffic.

Example upgrade command:

```bash
odoo-bin -d DATABASE_NAME -u fusion_travel --stop-after-init
```

## Before production

- Perform an actual Odoo 19 registry/install/upgrade test against the exact server build and a database copy.
- Test live provider credentials and every request/response schema in the Amadeus test environment.
- Use a PCI-compliant hosted/tokenized card adapter with signed callbacks; the built-in card option remains disabled by default.
- Add external-order reconciliation/polling or a queue/outbox worker before high-volume production use.
- Add infrastructure-level rate limiting/WAF protection for public search routes.
- Complete pixel-level implementation of all remaining Figma frames and mobile states.

## Documentation

- `docs/DEEP_REVIEW_AR.md` — detailed Arabic audit, applied fixes and remaining blockers.
- `docs/INTEGRATION_REPORT.md` — architecture and source mapping.
- `docs/MIGRATION_NOTES.md` — upgrade procedure and data checks.
- `docs/VALIDATION_REPORT.md` — static validation results.
