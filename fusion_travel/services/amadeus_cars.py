from .amadeus_sdk_client import AmadeusSDKClient


class AmadeusCars:
    """Transfer (car service) APIs through the official Amadeus Python SDK.

    Amadeus Self-Service offers Transfer APIs (private transfers, taxis,
    airport shuttles...), not a classic car-rental inventory. The Trip module
    keeps the car-rental business model in Odoo and maps it onto transfers.

    v1.7.0: migrated from the legacy raw-HTTP client to the official SDK.
    Transfer Search/Booking/Management support was added in SDK 8.0.0:
      - amadeus.shopping.transfer_offers.post(body)
      - amadeus.ordering.transfer_orders.post(body, offerId=...)
    Both are POST-based with a JSON body (the v1.6.2 GET-based search was a
    bug fixed in v1.6.3 and fully SDK-migrated here).
    """

    def __init__(self, env):
        self.sdk = AmadeusSDKClient(env)

    def _client(self):
        return self.sdk.get_client()

    def _build_search_body(self, vals):
        body = {
            'startLocationCode': vals.get('pickup_location'),
            'startDateTime': vals.get('pickup_datetime'),
            'passengers': int(vals.get('passengers') or 1),
        }
        if vals.get('transfer_type'):
            body['transferType'] = vals.get('transfer_type')
        if vals.get('dropoff_geocode'):
            body['endGeoCode'] = vals.get('dropoff_geocode')
        if vals.get('dropoff_google_place_id'):
            body['endGooglePlaceId'] = vals.get('dropoff_google_place_id')
        if vals.get('dropoff_address'):
            body['endAddressLine'] = vals.get('dropoff_address')
        if vals.get('dropoff_city'):
            body['endCityName'] = vals.get('dropoff_city')
        if vals.get('dropoff_zip'):
            body['endZipCode'] = vals.get('dropoff_zip')
        if vals.get('dropoff_country_code'):
            body['endCountryCode'] = vals.get('dropoff_country_code')
        body = {key: value for key, value in body.items() if value not in (None, '', False)}
        if not body.get('startLocationCode') or not body.get('startDateTime'):
            raise ValueError('Transfer Search requires a pickup location code and pickup date/time.')
        if not (body.get('endGeoCode') or body.get('endAddressLine') or body.get('endGooglePlaceId')):
            raise ValueError('Transfer Search requires a drop-off address, geocode, or Google place ID.')
        return body

    def search_transfers(self, vals, booking=None):
        """Transfer Search.

        Maps to: POST /v1/shopping/transfer-offers
        SDK: amadeus.shopping.transfer_offers.post(body)
        """
        body = self._build_search_body(vals)
        client = self._client()
        return self.sdk.call(
            'Transfer / Car Search',
            client.shopping.transfer_offers,
            'post',
            body,
            booking=booking,
            request_payload=body,
        )

    # Backward-compatible alias for the pre-1.6.3 method name.
    def search_cars(self, vals, booking=None):
        return self.search_transfers(vals, booking=booking)

    def book_transfer(self, offer_id, passengers, note=None, booking=None):
        """Transfer Booking.

        Maps to: POST /v1/ordering/transfer-orders?offerId=<OFFER_ID>
        SDK: amadeus.ordering.transfer_orders.post(body, offerId=...)

        passengers: list of dicts like [{'firstName': 'John', 'lastName':
        'Doe', 'title': 'MR', 'contacts': {'phoneNumber': '+33...',
        'email': 'a@b.com'}}]
        """
        if not offer_id:
            raise ValueError('Transfer Booking requires the offerId returned by Transfer Search.')
        if not passengers:
            raise ValueError('Transfer Booking requires at least one passenger.')
        body = {
            'data': {
                'note': note or '',
                'passengers': passengers,
            }
        }
        client = self._client()
        return self.sdk.call(
            'Transfer / Car Booking',
            client.ordering.transfer_orders,
            'post',
            body,
            booking=booking,
            request_payload={'offerId': offer_id, 'passengers': len(passengers)},
            offerId=offer_id,
        )

    # Backward-compatible alias for the pre-1.7.0 method name.
    def book_car(self, offer_id, passengers, note=None, booking=None):
        return self.book_transfer(offer_id, passengers, note=note, booking=booking)
