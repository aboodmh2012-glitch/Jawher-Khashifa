from .amadeus_sdk_client import AmadeusSDKClient


class AmadeusHotels:
    """Hotel APIs implemented through the official Amadeus Python SDK.

    v1.7.0: migrated from the legacy raw-HTTP client to the SDK, and from the
    decommissioned Hotel Booking v1 (/v1/booking/hotel-bookings) to Hotel
    Booking v2 (/v2/booking/hotel-orders), per the official Amadeus migration
    guide.
    """

    def __init__(self, env):
        self.sdk = AmadeusSDKClient(env)

    def _client(self):
        return self.sdk.get_client()

    def list_hotels_by_city(self, city_code, radius=None, radius_unit='KM'):
        """Hotel List API.

        Maps to: GET /v1/reference-data/locations/hotels/by-city
        SDK: amadeus.reference_data.locations.hotels.by_city.get(cityCode=...)
        """
        client = self._client()
        params = {'cityCode': city_code}
        if radius:
            params.update({'radius': radius, 'radiusUnit': radius_unit})
        return self.sdk.call(
            'Hotel List By City',
            client.reference_data.locations.hotels.by_city,
            'get',
            request_payload=params,
            **params,
        )

    def search_hotels(self, vals, booking=None):
        """Hotel Search v3: real-time offers for a set of hotel IDs.

        Maps to: GET /v3/shopping/hotel-offers
        SDK: amadeus.shopping.hotel_offers_search.get(hotelIds=..., adults=...)
        """
        hotel_ids = vals.get('hotel_ids')
        if not hotel_ids and vals.get('city_code'):
            hotel_list = self.list_hotels_by_city(vals.get('city_code'))
            data = hotel_list.get('data', []) if isinstance(hotel_list, dict) else []
            hotel_ids = ','.join([h.get('hotelId') for h in data[:30] if h.get('hotelId')])
        if not hotel_ids:
            raise ValueError('Hotel search requires hotel IDs or a city code that returns hotels.')
        params = {
            'hotelIds': hotel_ids,
            'adults': int(vals.get('adults') or 1),
            'checkInDate': vals.get('checkin_date'),
            'checkOutDate': vals.get('checkout_date'),
            'currency': vals.get('currency') or 'USD',
        }
        if vals.get('room_quantity'):
            params['roomQuantity'] = int(vals.get('room_quantity'))
        params = {key: value for key, value in params.items() if value not in (None, '', False)}
        client = self._client()
        return self.sdk.call(
            'Hotel Offers Search',
            client.shopping.hotel_offers_search,
            'get',
            booking=booking,
            request_payload=params,
            **params,
        )

    def get_offer(self, offer_id, booking=None):
        """Re-validate a specific hotel offer before booking.

        Maps to: GET /v3/shopping/hotel-offers/{offerId}
        Uses the SDK generic call so it stays correct across SDK versions.
        """
        client = self._client()
        return self.sdk.call(
            'Hotel Offer Validation',
            client,
            'get',
            '/v3/shopping/hotel-offers/%s' % offer_id,
            booking=booking,
            request_payload={'offerId': offer_id},
        )

    def book_hotel(self, offer_id, guests, payment=None, travel_agent_email=None, booking=None):
        """Hotel Booking v2: create a hotel order from a validated offer.

        Maps to: POST /v2/booking/hotel-orders
        v2 body requires data.type='hotel-order', guests with tid references,
        and roomAssociations mapping guests to the hotelOfferId. Payment is
        optional here; many rates require a guarantee, which should be handled
        by a tokenized/hosted flow outside Odoo when card charging is enabled.

        guests: list of dicts like {'firstName': 'JOHN', 'lastName': 'DOE',
                'title': 'MR', 'phone': '+33679278416', 'email': 'a@b.com'}
        """
        if not offer_id:
            raise ValueError('Hotel Booking requires the offerId returned by Hotel Search.')
        if not guests:
            raise ValueError('Hotel Booking requires at least one guest.')
        v2_guests = []
        guest_refs = []
        for index, guest in enumerate(guests, start=1):
            entry = {
                'tid': index,
                'title': guest.get('title') or 'MR',
                'firstName': (guest.get('firstName') or '').upper(),
                'lastName': (guest.get('lastName') or '').upper(),
            }
            if guest.get('phone'):
                entry['phone'] = guest['phone']
            if guest.get('email'):
                entry['email'] = guest['email']
            v2_guests.append(entry)
            guest_refs.append({'guestReference': str(index)})
        data = {
            'type': 'hotel-order',
            'guests': v2_guests,
            'roomAssociations': [{
                'guestReferences': guest_refs,
                'hotelOfferId': offer_id,
            }],
        }
        if travel_agent_email:
            data['travelAgent'] = {'contact': {'email': travel_agent_email}}
        if payment:
            data['payment'] = payment
        body = {'data': data}
        client = self._client()
        return self.sdk.call(
            'Hotel Booking v2',
            client,
            'post',
            '/v2/booking/hotel-orders',
            body,
            booking=booking,
            request_payload={'offerId': offer_id, 'guests': len(v2_guests)},
        )
