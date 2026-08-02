# Travel Module Requirements – Fusion Platform

**Status:** Draft for development team  
**Owner:** Fusion Platform  
**Audience:** Backend, Odoo, Frontend, DevOps, QA  
**Related codebase today:** `fusion_travel` (Odoo 19 add-on, current reviewed build `19.0.2.5.0` in Jawher-Khashifa)

---

## 1. Vision

Build an **enterprise-grade Travel module** that serves as the **core booking engine** for Fusion — not a single-provider booking script.

Fusion must become a **professional travel platform**: multi-provider, multi-product, agent-ready, ERP-integrated, and prepared for AI-assisted commerce.

### Non-negotiable architectural rule

> Design the Travel module as a **provider-agnostic platform**.  
> Business logic must **never** depend directly on Amadeus or any single provider.  
> All providers must be replaceable through **adapters** and a **unified orchestration layer**.

Adding Amadeus GDS, Amadeus NDC, IATI, Qatar NDC, or any future provider must mean implementing **one adapter** — without rewriting booking, pricing, ticketing, wallet, or agent flows.

This follows **Adapter / Strategy** patterns used by scalable travel platforms.

---

## 2. Phase 1 – Flights (MVP core)

### 2.1 Search & shop
- One-way, Round-trip, Multi-city
- Parallel multi-provider search with result aggregation, deduplication, and ranking
- Fare rules
- Branded fares
- Seat availability
- Baggage information
- Filters and sorting (price, duration, stops, airline, departure window, refundable, etc.)

### 2.2 Book & fulfill
- Booking creation
- PNR management
- Ticket issuance
- Ticket retrieval
- Void
- Refund
- Exchange / reissue
- Ancillary services: Seats, Bags, Meals, SSR

### 2.3 Provider coverage (Phase 1 target)
| Provider | Role |
|----------|------|
| Amadeus GDS | Baseline air content |
| Amadeus NDC | Airline NDC offers |
| IATI | Additional content / markets |
| Qatar NDC | Carrier-direct NDC |
| Future adapters | Plug-in without core rewrite |

---

## 3. Customer features

- Passenger profiles
- Saved travelers
- Wallet & balance
- Payment methods (PCI-compliant hosted / tokenized card + wallet + agency credit)
- Booking history
- Download itinerary (PDF)
- Email notifications
- SMS notifications

---

## 4. Agent / agency features

- Customer management
- Commission management
- Agency balance
- Credit limits
- Booking queue
- Ticket queue
- Operational & financial reports

---

## 5. Provider layer (mandatory design)

```
┌──────────────────────────────────────────────┐
│           Fusion Travel Domain               │
│  Search · Offer · Booking · Ticket · Wallet  │
│  Commission · Queue · Notifications · AI     │
└───────────────────┬──────────────────────────┘
                    │  Port / Interface
        ┌───────────┼───────────┬──────────────┐
        ▼           ▼           ▼              ▼
   AmadeusGDS   AmadeusNDC    IATI        QatarNDC …
   Adapter      Adapter     Adapter       Adapter
```

### Requirements
1. **Unified Offer / Order / Ticket DTOs** across providers.
2. **Orchestration service** for parallel search, timeout budgets, partial failure, and ranking.
3. **Idempotency keys** on book / pay / ticket / void / refund / exchange.
4. **Provider capability matrix** (supports branded fares? ancillaries? NDC exchange?).
5. **No provider SDK types** leak into domain models or Odoo/API controllers.
6. **Observability:** structured logs, correlation id, redacted payloads, per-provider SLIs.

---

## 6. Integration stack

| Layer | Technology |
|-------|------------|
| ERP / back-office | Odoo |
| API / orchestration | FastAPI backend |
| Data | PostgreSQL |
| Infra | AWS |
| Contracts | REST APIs + OpenAPI |
| Async | Event-driven where appropriate (search fan-out, ticket status, notifications, reconciliation) |

Odoo remains the system of record for partners, accounting, wallet journals, and agency operations.  
FastAPI owns high-throughput search/orchestration and provider adapters.  
Both talk through versioned REST contracts — not by embedding provider calls inside random Odoo buttons forever.

---

## 7. Future product modules (architecture must allow)

The same platform shape must support adding:

- Hotels
- Car Rental
- Transfers
- Activities
- Insurance
- Visa Services
- Cruise
- Rail
- Bus Transportation

Each product line gets its own domain package + provider adapters; shared kernel owns customer, wallet, payments, commissions, notifications, and identity.

---

## 8. AI readiness

Prepare extension points for an **AI Travel Assistant** capable of:

- Trip recommendations
- Itinerary optimization
- Rebooking assistance
- Refund assistance
- Customer support
- Cross-selling (Hotel, Car, Insurance)

AI must call the same orchestration APIs as humans/agents — never bypass fare rules, inventory, or payment state.

---

## 9. Code quality bar

- Clean Architecture
- Domain-Driven Design
- SOLID
- Repository Pattern
- Unit tests
- Integration tests (provider sandboxes + payment + wallet concurrency)
- Full API documentation (OpenAPI / Swagger)
- Docker support
- CI/CD ready (lint, test, build, migrate, deploy)

### Definition of Done (any Phase 1 story)
1. Domain logic has no direct Amadeus/IATI import.
2. Adapter covered by contract tests against recorded fixtures.
3. OpenAPI updated.
4. Idempotent happy-path + failure-path tests.
5. Observability fields present (provider, latency, correlation id).

---

## 10. Delivery phases (suggested)

| Phase | Scope | Outcome |
|-------|-------|---------|
| **P0** | Provider ports + Amadeus GDS adapter + flight search/book skeleton + Odoo sync | Platform spine |
| **P1** | Ticketing, void/refund/exchange, wallet, agent queues, reports | Sellable air MVP |
| **P1.1** | Branded fares, ancillaries, seat maps, fare rules UX | Competitive shop |
| **P2** | Second provider (NDC or IATI) proving adapter model | True multi-provider |
| **P3** | Hotels + Transfers (reuse orchestration) | Multi-product |
| **P4** | AI assistant on top of stable APIs | Differentiation |

---

## 11. Explicit out-of-scope for Phase 1

- Full pixel-perfect every Figma frame for all products
- Classic self-drive car rental inventory (Transfers ≠ Car Rental)
- Production card PAN handling inside Odoo (hosted/tokenized only)
- Guaranteeing consolidator ticketing without sandbox certification

---

## 12. Handoff note to the development team

Do **not** treat this as “add more Amadeus buttons to Odoo.”

Treat it as:

> Build Fusion Travel as a **provider-agnostic booking platform**, with Odoo as ERP/ops surface and FastAPI as orchestration engine, so any new content source is one adapter away.

See also: `docs/TRAVEL_GAP_ANALYSIS_AR.md` for how today’s `fusion_travel` Odoo module compares to this target.
