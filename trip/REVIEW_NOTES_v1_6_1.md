# Trip Odoo Module v1.6.1 Review Notes

## Review performed
- Unzipped and inspected the Odoo 18 module structure.
- Parsed all Python files with AST syntax validation.
- Parsed all XML files for well-formed XML.
- Reviewed manifest ordering, security/access CSV, model/view consistency, website controller flow, and Amadeus SDK integration points.

## Fixes applied
1. Fixed Flight Offers Pricing SDK call.
   - Previous code used `pricing.post(body=body)`, which does not match the official `amadeus-python` SDK usage.
   - Updated to `pricing.post(flight_offer, include=...)` style.

2. Fixed SeatMap Display SDK call.
   - Previous code used `seatmaps.post(body=body)` as a keyword argument.
   - Updated to pass the body positionally.

3. Fixed the SDK wrapper call signature.
   - Moved `*args` before keyword-only `booking` and `request_payload` so positional SDK bodies can be passed safely.

4. Imported services from the module root.
   - Added `from . import services` in `trip/__init__.py` for cleaner package loading.

5. Corrected default API access mode.
   - Set the default access mode to `self_service` instead of `enterprise` because this rebuild is based on Amadeus Self-Service SDK usage.

## Validation status
- Python syntax: PASS
- XML well-formedness: PASS
- Manifest data ordering: PASS
- Security CSV presence for module models: PASS
- Amadeus SDK API call shapes: improved to match official SDK examples.

## Important remaining business limitations
- This module can create an Amadeus Flight Order/PNR using Self-Service API.
- Ticketing/issuing is not fully handled by Self-Service alone; production ticketing/payment settlement requires your consolidator, ARC/IATA setup, or Enterprise/NDC adapter.
- Hotel and car services still use the legacy HTTP client because the current rebuild focused on flight SDK integration.
- Wallet is an Odoo operational wallet, not a regulated financial ledger.

## Install reminder
Run inside the Odoo Python environment before installing/upgrading:

```bash
pip install -r trip/requirements.txt
```
