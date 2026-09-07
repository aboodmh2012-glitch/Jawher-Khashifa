from .amadeus_sdk_client import AmadeusSDKClient


class AmadeusFlights:
    """Flight APIs implemented through documented Amadeus REST endpoints."""

    def __init__(self, env):
        self.api = AmadeusSDKClient(env)

    def search_offers(self, vals):
        if not isinstance(vals, dict):
            raise ValueError('Search values must be a dictionary.')
        params = {
            'originLocationCode': vals.get('origin'),
            'destinationLocationCode': vals.get('destination'),
            'departureDate': vals.get('departure_date'),
            'adults': int(vals.get('adults') or 1),
            'currencyCode': vals.get('currency') or 'USD',
            'max': int(vals.get('max') or 20),
        }
        optional_map = {
            'return_date': 'returnDate',
            'children': 'children',
            'infants': 'infants',
            'travel_class': 'travelClass',
            'non_stop': 'nonStop',
            'included_airline_codes': 'includedAirlineCodes',
            'excluded_airline_codes': 'excludedAirlineCodes',
            'max_price': 'maxPrice',
        }
        for source, destination in optional_map.items():
            if vals.get(source) not in (None, '', False):
                params[destination] = vals.get(source)
        params = {
            key: value for key, value in params.items()
            if value not in (None, '', False)
        }
        return self.api.get(
            'Flight Offers Search',
            '/v2/shopping/flight-offers',
            params=params,
        )

    def price_offer(self, flight_offer, booking=None, include=None):
        if not isinstance(flight_offer, dict) or flight_offer.get('type') != 'flight-offer':
            raise ValueError(
                'Flight Offers Price expects one raw flight-offer object returned by Flight Offers Search.'
            )
        body = {
            'data': {
                'type': 'flight-offers-pricing',
                'flightOffers': [flight_offer],
            }
        }
        params = {'include': include} if include else None
        return self.api.post(
            'Flight Offers Price',
            '/v1/shopping/flight-offers/pricing',
            body,
            params=params,
            booking=booking,
            request_payload={'flightOfferId': flight_offer.get('id'), 'include': include},
        )

    def create_order(
        self,
        flight_offer,
        travelers,
        booking=None,
        remarks=None,
        ticketing_agreement=None,
        contacts=None,
        queuing_office_id=None,
    ):
        if not isinstance(flight_offer, dict) or flight_offer.get('type') != 'flight-offer':
            raise ValueError('Flight Create Orders expects one priced flight-offer object.')
        if not travelers:
            raise ValueError('Flight Create Orders requires at least one traveler.')
        data = {
            'type': 'flight-order',
            'flightOffers': [flight_offer],
            'travelers': travelers,
        }
        if remarks:
            data['remarks'] = remarks
        if ticketing_agreement:
            data['ticketingAgreement'] = ticketing_agreement
        if contacts:
            data['contacts'] = contacts
        if queuing_office_id:
            data['queuingOfficeId'] = queuing_office_id
        body = {'data': data}
        return self.api.post(
            'Flight Create Orders',
            '/v1/booking/flight-orders',
            body,
            booking=booking,
            request_payload={
                'flightOfferId': flight_offer.get('id'),
                'travelerCount': len(travelers),
                'queuingOfficeId': queuing_office_id,
            },
        )

    def search_airports_and_cities(
        self, keyword, sub_type='AIRPORT,CITY', page_limit=10
    ):
        params = {
            'keyword': keyword,
            'subType': sub_type,
            'page[limit]': page_limit,
        }
        return self.api.get(
            'Airport & City Search',
            '/v1/reference-data/locations',
            params=params,
        )

    def get_checkin_links(self, airline_code):
        return self.api.get(
            'Flight Check-in Links',
            '/v2/reference-data/urls/checkin-links',
            params={'airlineCode': airline_code},
        )

    def get_seatmaps(self, flight_offer):
        if not isinstance(flight_offer, dict) or flight_offer.get('type') != 'flight-offer':
            raise ValueError('SeatMap Display expects one flight-offer object.')
        body = {'data': [flight_offer]}
        return self.api.post(
            'SeatMap Display',
            '/v1/shopping/seatmaps',
            body,
            request_payload={'flightOfferId': flight_offer.get('id')},
        )
