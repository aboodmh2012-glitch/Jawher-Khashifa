# Migration Notes — 19.0.1.0.0 to 19.0.2.4.0

## Upgrade method

Upgrade the existing `fusion_travel` module. Do not install the supplied Trip module beside it because both contain overlapping travel responsibilities.

1. Take a complete database and filestore backup.
2. Restore them into staging.
3. Replace the old `fusion_travel` folder with this folder.
4. Restart Odoo and run `-u fusion_travel --stop-after-init`.
5. Review migration logs and then test in the UI before production rollout.

## Preserved compatibility

- Models `fusion.travel.flight.ticket` and `fusion.travel.airline`.
- Legacy ticket fields and M2M table `fusion_travel_ticket_move_rel`.
- Legacy menu/action/view/ACL external IDs.
- Original module technical name `fusion_travel`.

## Automatic migration work

- Backfill ticket company from a single-company accounting link, then creator company, then legacy fallback.
- Backfill operation type from legacy item type.
- Preserve a readable traveler value on old records.
- Map airline IATA/accounting aliases.
- Map legacy agent/customer values where possible.
- Mark existing provider references/booked records as already created so they are not automatically re-submitted.

## Mandatory staging checks

Run data checks before production upgrade:

- Duplicate ticket number by company and operation.
- Tickets linked to accounting documents from more than one company.
- Tickets missing customer, provider, airline, product or currency.
- Exchange/refund/void records missing an original ticket.
- Bookings whose invoice/sale order company, customer or currency differs from the booking.
- Existing failed bookings whose external provider result is uncertain.

## Rollback

Restore the database, filestore and previous code together. Do not roll back only the Python/XML code after a schema upgrade.
