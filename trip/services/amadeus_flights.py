from .amadeus_sdk_client import AmadeusSDKClient


class AmadeusFlights:
    """Flight APIs implemented through the official Amadeus Python SDK."""

    def __init__(self, env):
        self.sdk = AmadeusSDKClient(env)

    def _client(self):
        return self.sdk.get_client()

    def search_offers(self, vals):
        """Search flight offers using Flight Offers Search.

        Maps to: GET /v2/shopping/flight-offers
        SDK: amadeus.shopping.flight_offers_search.get(...)
        """
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
        for src, dst in optional_map.items():
            if vals.get(src) not in (None, '', False):
                params[dst] = vals.get(src)
        params = {key: value for key, value in params.items() if value not in (None, '', False)}
        client = self._client()
        return self.sdk.call(
            'Flight Offers Search',
            client.shopping.flight_offers_search,
            'get',
            request_payload=params,
            **params,
        )

    def price_offer(self, flight_offer, booking=None, include=None, payment=None):
        """Confirm availability/final price for one raw flight-offer object.

        Maps to: POST /v1/shopping/flight-offers/pricing
        Official SDK usage: amadeus.shopping.flight_offers.pricing.post(flight_offer, **params).
        The SDK wraps this into {'data': {'type': 'flight-offers-pricing', 'flightOffers': [...]}}.

        Raw card/payment data is intentionally not passed here. Use a hosted or
        tokenized provider flow outside this module when card charging is enabled.
        """
        if not isinstance(flight_offer, dict) or flight_offer.get('type') != 'flight-offer':
            raise ValueError('Flight Offers Price expects one raw flight-offer object returned by Flight Offers Search.')
        client = self._client()
        kwargs = {}
        if include:
            kwargs['include'] = include
        request_payload = {'flight_offer': flight_offer, **kwargs}
        return self.sdk.call(
            'Flight Offers Price',
            client.shopping.flight_offers.pricing,
            'post',
            flight_offer,
            booking=booking,
            request_payload=request_payload,
            **kwargs,
        )

    def create_order(self, flight_offer, travelers, booking=None, remarks=None, ticketing_agreement=None, contacts=None, queuing_office_id=None):
        """Create an Amadeus flight order/PNR from a priced offer and travelers.

        Maps to: POST /v1/booking/flight-orders
        SDK: amadeus.booking.flight_orders.post(flight, travelers)

        The official SDK method accepts flight + travelers. For extra Enterprise
        fields such as queuingOfficeId, remarks, contacts, or ticketingAgreement,
        use an Enterprise/aggregator adapter if your contract requires them.
        """
        if not isinstance(flight_offer, dict) or flight_offer.get('type') != 'flight-offer':
            raise ValueError('Flight Create Orders expects one priced flight-offer object.')
        if not travelers:
            raise ValueError('Flight Create Orders requires at least one traveler.')
        client = self._client()
        request_payload = {
            'flight': flight_offer,
            'travelers': travelers,
            'remarks': remarks,
            'ticketingAgreement': ticketing_agreement,
            'contacts': contacts,
            'queuingOfficeId': queuing_office_id,
        }
        return self.sdk.call(
            'Flight Create Orders',
            client.booking.flight_orders,
            'post',
            booking=booking,
            request_payload={k: v for k, v in request_payload.items() if v not in (None, '', False)},
            flight=flight_offer,
            travelers=travelers,
        )

    def search_airports_and_cities(self, keyword, sub_type='AIRPORT,CITY', page_limit=10):
        """Autocomplete airports/cities.

        Maps to: GET /v1/reference-data/locations
        SDK: amadeus.reference_data.locations.get(...)
        """
        client = self._client()
        params = {
            'keyword': keyword,
            'subType': sub_type,
            'page[limit]': page_limit,
        }
        return self.sdk.call(
            'Airport & City Search',
            client.reference_data.locations,
            'get',
            request_payload=params,
            **params,
        )

    def get_checkin_links(self, airline_code):
        """Return airline check-in links.

        Maps to: GET /v2/reference-data/urls/checkin-links
        SDK: amadeus.reference_data.urls.checkin_links.get(...)
        """
        client = self._client()
        params = {'airlineCode': airline_code}
        return self.sdk.call(
            'Flight Check-in Links',
            client.reference_data.urls.checkin_links,
            'get',
            request_payload=params,
            **params,
        )

    def get_seatmaps(self, flight_offer):
        """Return seat maps for a flight offer when available.

        Maps to: POST /v1/shopping/seatmaps
        SDK resource mapping may vary by SDK version, so this is isolated here.
        """
        if not isinstance(flight_offer, dict) or flight_offer.get('type') != 'flight-offer':
            raise ValueError('SeatMap Display expects one flight-offer object.')
        client = self._client()
        body = {'data': [flight_offer]}
        return self.sdk.call(
            'SeatMap Display',
            client.shopping.seatmaps,
            'post',
            body,
            request_payload=body,
        )
