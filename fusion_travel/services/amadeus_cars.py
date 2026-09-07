from .amadeus_sdk_client import AmadeusSDKClient


class AmadeusCars:
    """Amadeus transfer APIs exposed as car/transfer services in Odoo."""

    def __init__(self, env):
        self.api = AmadeusSDKClient(env)

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
        body = {
            key: value for key, value in body.items()
            if value not in (None, '', False)
        }
        if not body.get('startLocationCode') or not body.get('startDateTime'):
            raise ValueError(
                'Transfer Search requires a pickup location code and pickup date/time.'
            )
        if not (
            body.get('endGeoCode')
            or body.get('endAddressLine')
            or body.get('endGooglePlaceId')
        ):
            raise ValueError(
                'Transfer Search requires a drop-off address, geocode, or Google place ID.'
            )
        return body

    def search_transfers(self, vals, booking=None):
        body = self._build_search_body(vals)
        return self.api.post(
            'Transfer / Car Search',
            '/v1/shopping/transfer-offers',
            body,
            booking=booking,
        )

    def search_cars(self, vals, booking=None):
        return self.search_transfers(vals, booking=booking)

    def book_transfer(self, offer_id, passengers, note=None, booking=None):
        if not offer_id:
            raise ValueError(
                'Transfer Booking requires the offerId returned by Transfer Search.'
            )
        if not passengers:
            raise ValueError('Transfer Booking requires at least one passenger.')
        body = {
            'data': {
                'note': note or '',
                'passengers': passengers,
            }
        }
        return self.api.post(
            'Transfer / Car Booking',
            '/v1/ordering/transfer-orders',
            body,
            params={'offerId': offer_id},
            booking=booking,
            request_payload={'offerId': offer_id, 'passengerCount': len(passengers)},
        )

    def book_car(self, offer_id, passengers, note=None, booking=None):
        return self.book_transfer(offer_id, passengers, note=note, booking=booking)
