# Trip v1.8.0 — Manual Operations, Advanced Search & Reports

This release adds full manual operation management, advanced search, and an
operational/financial reporting layer, so every booking, ticket and payment —
whether created online by the module or captured manually from an external
source (Amadeus/GDS, airline portal, ARC, office booking, any external
system) — is managed and reported from one place.

## 1. Manual entry & operations

- `trip.booking` extended with:
  - **Source tracking:** `is_manual`, `source_system` (App / Amadeus-GDS /
    Airline Portal / ARC-External / Office Booking / Other), `booking_date`.
  - **Ticket information:** `airline`, `flight_number`, `booking_reference`,
    `ticket_number`, `issue_date`, `travel_date`, `ticket_status`
    (Pending / Issued / Cancelled / Void / Refund / Exchange).
  - **Financial breakdown:** `base_fare`, `tax_amount`, `fee_amount`,
    `net_cost` (computed), `selling_price`, `markup_amount`,
    `commission_amount`, `profit` (computed = total − cost − commission).
    `total_amount` now follows `selling_price` for manual bookings and keeps
    the automated `net + markup` behaviour otherwise.
  - Per-passenger `ticket_number`, `seat_number`, `is_lead`.
- **Manual operation buttons** on the booking: Manual Issue, Manual Payment,
  Void, Refund, Exchange / Reissue — each records a `trip.operation` entry and
  updates the ticket/payment/state.
- New **`trip.operation`** model: an operational ledger of every operation
  (Manual Booking, Ticket Issue, Payment, Void, Refund, Exchange) with source,
  amount, payment method/status/reference, invoice link, customer, agent and
  "recorded by" — usable standalone or attached to a booking.

## 2. Advanced search

The booking search view now finds any operation by: Booking Number,
Booking Reference, PNR, Ticket Number, Passenger Name, Passport Number, Phone,
Email, Airline, Flight Number, Agent, Customer, Invoice Number, Payment
Reference, Booking/Travel date ranges, Status and Ticket Status. Fast stored
helper fields (`passenger_names`, `passport_numbers`, `contact_phones`,
`contact_emails`, `invoice_number`) keep passenger/invoice lookups quick.

## 3. Reports & dashboard

- **Pivot + Graph** analytical views on `trip.booking` and `trip.operation`
  (measures: net cost, total, commission, profit, amount) — native
  **Excel (xlsx) download**, drill-down and grouping.
- **Reports menu:** Sales, Ticket, Passenger, Agent, Financial, Operations,
  and API Error reports, each preset with the right grouping/filters.
- **Manual vs Online** split via the `is_manual` filter on bookings and
  operations.
- **QWeb PDF report** "Trip Booking / Ticket" (print + PDF) with passenger,
  flight and financial summary, bound to the booking form Print menu.

## Security
- `trip.operation` access rights for users/managers/portal, plus record rules
  (users see their own/assigned operations; managers see their companies').

## Validation performed
- `python3 -m py_compile` on all Python files: PASS
- XML well-formedness on all XML files: PASS
- Menu actions resolve; view field names cross-checked against models.
- No `__pycache__` in the package.

## Carried over
Everything from v1.7.1 (infant-adult linkage, price-confirmation step,
multi-currency wallet balance, spoof-safe rate limiting) and the full
v1.7.0 Amadeus integration. See earlier REVIEW_NOTES files.
