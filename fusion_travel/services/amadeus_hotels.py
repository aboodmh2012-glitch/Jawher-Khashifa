from .amadeus_sdk_client import AmadeusSDKClient


class AmadeusHotels:
    """Hotel APIs implemented through documented Amadeus REST endpoints."""

    def __init__(self, env):
        self.api = AmadeusSDKClient(env)

    def list_hotels_by_city(self, city_code, radius=None, radius_unit='KM'):
        params = {'cityCode': city_code}
        if radius:
            params.update({'radius': radius, 'radiusUnit': radius_unit})
        return self.api.get(
            'Hotel List By City',
            '/v1/reference-data/locations/hotels/by-city',
            params=params,
        )

    def search_hotels(self, vals, booking=None):
        hotel_ids = vals.get('hotel_ids')
        if not hotel_ids and vals.get('city_code'):
            hotel_list = self.list_hotels_by_city(vals.get('city_code'))
            data = hotel_list.get('data', []) if isinstance(hotel_list, dict) else []
            hotel_ids = ','.join(
                hotel.get('hotelId') for hotel in data[:30] if hotel.get('hotelId')
            )
        if not hotel_ids:
            raise ValueError(
                'Hotel search requires hotel IDs or a city code that returns hotels.'
            )
        params = {
            'hotelIds': hotel_ids,
            'adults': int(vals.get('adults') or 1),
            'checkInDate': vals.get('checkin_date'),
            'checkOutDate': vals.get('checkout_date'),
            'currency': vals.get('currency') or 'USD',
        }
        if vals.get('room_quantity'):
            params['roomQuantity'] = int(vals.get('room_quantity'))
        params = {
            key: value for key, value in params.items()
            if value not in (None, '', False)
        }
        return self.api.get(
            'Hotel Offers Search',
            '/v3/shopping/hotel-offers',
            params=params,
            booking=booking,
        )

    def get_offer(self, offer_id, booking=None):
        return self.api.get(
            'Hotel Offer Validation',
            '/v3/shopping/hotel-offers/%s' % offer_id,
            booking=booking,
            request_payload={'offerId': offer_id},
        )

    def book_hotel(
        self,
        offer_id,
        guests,
        payment=None,
        travel_agent_email=None,
        booking=None,
    ):
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
        return self.api.post(
            'Hotel Booking v2',
            '/v2/booking/hotel-orders',
            {'data': data},
            booking=booking,
            request_payload={'offerId': offer_id, 'guestCount': len(v2_guests)},
        )
