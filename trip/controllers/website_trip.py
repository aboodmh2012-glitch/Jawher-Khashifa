import base64
import json
import logging
from datetime import date, datetime, timedelta

from odoo import http, _
from odoo.exceptions import UserError, ValidationError
from odoo.http import request

from ..services.amadeus_flights import AmadeusFlights
from ..services.amadeus_hotels import AmadeusHotels
from ..services.amadeus_cars import AmadeusCars

_logger = logging.getLogger(__name__)


class TripWebsiteController(http.Controller):
    @http.route('/trip/flights', type='http', auth='public', website=True)
    def flights_page(self, **kwargs):
        return request.render('trip.flights_search_template', {})

    def _rate_limit_key(self):
        ip = request.httprequest.headers.get('X-Forwarded-For', request.httprequest.remote_addr or 'unknown')
        return f'trip.flight_search_rate.{ip.split(",")[0].strip()}'

    def _check_rate_limit(self, limit=20, window_minutes=10):
        config = request.env['ir.config_parameter'].sudo()
        key = self._rate_limit_key()
        now = datetime.utcnow()
        raw_value = config.get_param(key, '')
        stamps = []
        for item in raw_value.split(','):
            if not item:
                continue
            try:
                stamp = datetime.fromisoformat(item)
            except ValueError:
                continue
            if now - stamp < timedelta(minutes=window_minutes):
                stamps.append(stamp)
        if len(stamps) >= limit:
            raise UserError(_('Too many flight searches. Please wait a few minutes and try again.'))
        stamps.append(now)
        config.set_param(key, ','.join(stamp.isoformat() for stamp in stamps[-limit:]))

    def _safe_int(self, value, default=0):
        try:
            return int(value or default)
        except (TypeError, ValueError):
            return default

    def _safe_float(self, value):
        try:
            return float(value or 0.0)
        except (TypeError, ValueError):
            return 0.0

    def _validate_search(self, post):
        origin = (post.get('origin') or '').strip().upper()
        destination = (post.get('destination') or '').strip().upper()
        if len(origin) != 3 or len(destination) != 3:
            raise ValidationError(_('Use valid 3-letter IATA airport/city codes.'))
        if origin == destination:
            raise ValidationError(_('Origin and destination must be different.'))
        try:
            departure_date = datetime.strptime(post.get('departure_date') or '', '%Y-%m-%d').date()
        except ValueError as exc:
            raise ValidationError(_('Enter a valid departure date.')) from exc
        if departure_date < date.today():
            raise ValidationError(_('Departure date cannot be in the past.'))
        return_date = post.get('return_date') or False
        if return_date:
            try:
                parsed_return = datetime.strptime(return_date, '%Y-%m-%d').date()
            except ValueError as exc:
                raise ValidationError(_('Enter a valid return date.')) from exc
            if parsed_return < departure_date:
                raise ValidationError(_('Return date cannot be before departure date.'))
        adults = max(self._safe_int(post.get('adults'), 1), 1)
        children = max(self._safe_int(post.get('children'), 0), 0)
        infants = max(self._safe_int(post.get('infants'), 0), 0)
        if infants > adults:
            raise ValidationError(_('Infants cannot exceed adults.'))
        if adults + children + infants > 9:
            raise ValidationError(_('A maximum of 9 passengers is allowed per search.'))
        return {
            'origin': origin,
            'destination': destination,
            'departure_date': departure_date.isoformat(),
            'return_date': return_date,
            'adults': adults,
            'children': children,
            'infants': infants,
            'travel_class': post.get('travel_class') or False,
            'currency': (post.get('currency') or request.env.company.currency_id.name or 'USD').upper(),
            'max': 10,
        }

    def _encode_offer_payload(self, offer):
        raw = json.dumps(offer, ensure_ascii=False, default=str).encode('utf-8')
        return base64.urlsafe_b64encode(raw).decode('ascii')

    def _decode_offer_payload(self, payload):
        try:
            raw = base64.urlsafe_b64decode((payload or '').encode('ascii'))
            data = json.loads(raw.decode('utf-8'))
        except Exception as exc:  # noqa: BLE001
            raise ValidationError(_('Invalid selected offer. Please search again.')) from exc
        if not isinstance(data, dict):
            raise ValidationError(_('Invalid selected offer. Please search again.'))
        return data

    def _get_user_booking(self, booking_id):
        booking = request.env['trip.booking'].sudo().search([
            ('id', '=', booking_id),
            ('partner_id', '=', request.env.user.partner_id.id),
        ], limit=1)
        if not booking:
            raise UserError(_('Booking not found.'))
        return booking

    def _traveler_types_from_offer(self, offer):
        result = []
        traveler_pricings = offer.get('travelerPricings') or []
        for item in traveler_pricings:
            code = (item.get('travelerType') or 'ADULT').lower()
            if 'child' in code:
                result.append('child')
            elif 'infant' in code:
                result.append('infant')
            else:
                result.append('adult')
        return result or ['adult']

    def _traveler_types_for_booking(self, booking):
        """Traveler slots to collect, by booking type.

        Flights derive types from travelerPricings; hotels use the guest
        count stored on the stay line; transfers use one lead passenger.
        """
        if booking.booking_type == 'flight':
            return self._traveler_types_from_offer(booking._get_selected_offer())
        if booking.booking_type == 'hotel':
            count = booking.hotel_stay_ids[:1].guests_count or 1
            return ['adult'] * max(int(count), 1)
        return ['adult']

    @http.route('/trip/flights/search', type='http', auth='public', website=True, methods=['POST'], csrf=True)
    def flights_search(self, **post):
        error = None
        response = {}
        offers = []
        vals = {}
        try:
            self._check_rate_limit()
            vals = self._validate_search(post)
            response = AmadeusFlights(request.env).search_offers(vals)
            raw_offers = response.get('data', []) if isinstance(response, dict) else []
            for offer in raw_offers[:10]:
                if isinstance(offer, dict):
                    offer = dict(offer)
                    offer['_payload'] = self._encode_offer_payload(offer)
                    offers.append(offer)
        except (UserError, ValidationError) as exc:
            error = str(exc)
        except Exception:  # noqa: BLE001
            _logger.exception('Public flight search failed')
            error = _('Search could not be completed. Please try again later or contact support.')
        return request.render('trip.trip_search_results_template', {
            'search': vals,
            'offers': offers,
            'raw_response': response,
            'error': error,
        })

    @http.route('/trip/flights/book', type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def flights_book_offer(self, **post):
        try:
            offer = self._decode_offer_payload(post.get('offer_payload'))
            price = offer.get('price') or {}
            currency_name = price.get('currency') or request.env.company.currency_id.name
            currency = request.env['res.currency'].sudo().search([('name', '=', currency_name)], limit=1) or request.env.company.currency_id
            total = self._safe_float(price.get('grandTotal') or price.get('total'))
            booking = request.env['trip.booking'].sudo().create({
                'partner_id': request.env.user.partner_id.id,
                'agent_id': request.env.user.id,
                'company_id': request.env.company.id,
                'booking_source': 'website',
                'booking_type': 'flight',
                'state': 'searched',
                'currency_id': currency.id,
                'net_amount': total,
                'selected_offer_json': json.dumps(offer, ensure_ascii=False, indent=2, default=str),
            })
            booking._load_flight_segments_from_offer(offer)
            booking.action_apply_pricing_rule()
            return request.redirect(f'/trip/booking/{booking.id}/passengers')
        except (UserError, ValidationError) as exc:
            _logger.info('Flight offer selection failed: %s', exc)
            return request.render('trip.trip_booking_error_template', {'error': str(exc)})
        except Exception:  # noqa: BLE001
            _logger.exception('Flight offer selection failed')
            return request.render('trip.trip_booking_error_template', {
                'error': _('Booking could not be initialized. Please try again or contact support.')
            })

    @http.route('/trip/booking/<int:booking_id>/passengers', type='http', auth='user', website=True, methods=['GET'], csrf=True)
    def booking_passengers_page(self, booking_id, **kwargs):
        try:
            booking = self._get_user_booking(booking_id)
            traveler_types = self._traveler_types_for_booking(booking)
            return request.render('trip.trip_passenger_details_template', {
                'booking': booking,
                'traveler_types': traveler_types,
                'error': kwargs.get('error'),
            })
        except Exception as exc:  # noqa: BLE001
            return request.render('trip.trip_booking_error_template', {'error': str(exc)})

    @http.route('/trip/booking/<int:booking_id>/passengers', type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def booking_passengers_submit(self, booking_id, **post):
        try:
            booking = self._get_user_booking(booking_id)
            traveler_types = self._traveler_types_for_booking(booking)
            commands = [(5, 0, 0)]
            for index, passenger_type in enumerate(traveler_types):
                first_name = (post.get(f'first_name_{index}') or '').strip()
                last_name = (post.get(f'last_name_{index}') or '').strip()
                if not first_name or not last_name:
                    raise ValidationError(_('Passenger first and last names are required.'))
                nationality_code = (post.get(f'nationality_{index}') or '').strip().upper()
                nationality = False
                if nationality_code:
                    nationality = request.env['res.country'].sudo().search([('code', '=', nationality_code)], limit=1)
                commands.append((0, 0, {
                    'passenger_type': passenger_type,
                    'first_name': first_name,
                    'last_name': last_name,
                    'date_of_birth': post.get(f'date_of_birth_{index}') or False,
                    'gender': post.get(f'gender_{index}') or 'male',
                    'nationality_id': nationality.id if nationality else False,
                    'passport_number': (post.get(f'passport_number_{index}') or '').strip(),
                    'passport_expiry': post.get(f'passport_expiry_{index}') or False,
                    'email': (post.get(f'email_{index}') or request.env.user.email or '').strip(),
                    'phone': (post.get(f'phone_{index}') or request.env.user.partner_id.phone or request.env.user.partner_id.mobile or '').strip(),
                }))
            booking.write({'passenger_ids': commands})
            return request.redirect(f'/trip/booking/{booking.id}/confirm-price')
        except (UserError, ValidationError) as exc:
            return request.render('trip.trip_passenger_details_template', {
                'booking': self._get_user_booking(booking_id),
                'traveler_types': self._traveler_types_for_booking(self._get_user_booking(booking_id)),
                'error': str(exc),
            })
        except Exception:  # noqa: BLE001
            _logger.exception('Passenger submission failed')
            return request.render('trip.trip_booking_error_template', {
                'error': _('Passenger details could not be saved. Please try again.')
            })

    @http.route('/trip/booking/<int:booking_id>/confirm-price', type='http', auth='user', website=True, methods=['GET', 'POST'], csrf=True)
    def booking_confirm_price(self, booking_id, **post):
        try:
            booking = self._get_user_booking(booking_id)
            if request.httprequest.method == 'POST':
                booking.action_price_booking()
                return request.redirect(f'/trip/booking/{booking.id}/payment')
            return request.render('trip.trip_price_confirmation_template', {'booking': booking, 'error': False})
        except (UserError, ValidationError) as exc:
            return request.render('trip.trip_price_confirmation_template', {
                'booking': self._get_user_booking(booking_id),
                'error': str(exc),
            })
        except Exception:  # noqa: BLE001
            _logger.exception('Price confirmation failed')
            return request.render('trip.trip_price_confirmation_template', {
                'booking': self._get_user_booking(booking_id),
                'error': _('Price confirmation failed. Please contact support.'),
            })

    @http.route('/trip/booking/<int:booking_id>/payment', type='http', auth='user', website=True, methods=['GET', 'POST'], csrf=True)
    def booking_payment(self, booking_id, **post):
        try:
            booking = self._get_user_booking(booking_id)
            if request.httprequest.method == 'POST':
                if booking.state not in ('priced', 'pending_payment'):
                    booking.action_price_booking()

                payment_method = post.get('payment_method') or 'amadeus_card'
                if payment_method not in ('amadeus_card', 'wallet'):
                    raise ValidationError(_('Invalid payment method.'))

                if payment_method == 'wallet':
                    booking.action_pay_from_wallet_and_issue()
                    return request.redirect(f'/my/trip/booking/{booking.id}')

                # External provider-card flow: never collect raw card data in Odoo.
                # Use a hosted payment page/tokenized Enterprise/NDC adapter when card charging is enabled.
                booking.action_book_with_amadeus_card()
                return request.redirect(f'/my/trip/booking/{booking.id}')

            return request.render('trip.trip_payment_template', {'booking': booking, 'error': False})
        except (UserError, ValidationError) as exc:
            return request.render('trip.trip_payment_template', {'booking': self._get_user_booking(booking_id), 'error': str(exc)})
        except Exception:  # noqa: BLE001
            _logger.exception('Payment step failed')
            return request.render('trip.trip_payment_template', {
                'booking': self._get_user_booking(booking_id),
                'error': _('Payment could not be completed. Please contact support.'),
            })

    @http.route('/trip/booking/<int:booking_id>/issue', type='http', auth='user', website=True, methods=['GET', 'POST'], csrf=True)
    def booking_issue(self, booking_id, **post):
        try:
            booking = self._get_user_booking(booking_id)
            if request.httprequest.method == 'POST':
                booking.action_create_provider_order()
                booking.action_confirm_booking()
                return request.redirect(f'/my/trip/booking/{booking.id}')
            return request.render('trip.trip_issue_template', {'booking': booking, 'error': False})
        except (UserError, ValidationError) as exc:
            return request.render('trip.trip_issue_template', {'booking': self._get_user_booking(booking_id), 'error': str(exc)})
        except Exception:  # noqa: BLE001
            _logger.exception('Supplier order creation failed')
            return request.render('trip.trip_issue_template', {
                'booking': self._get_user_booking(booking_id),
                'error': _('Supplier order could not be created. Please contact support.'),
            })

    # ------------------------------------------------------------------
    # Hotels
    # ------------------------------------------------------------------
    @http.route('/trip/hotels', type='http', auth='public', website=True)
    def hotels_page(self, **kwargs):
        return request.render('trip.hotels_search_template', {})

    def _validate_hotel_search(self, post):
        city_code = (post.get('city_code') or '').strip().upper()
        if len(city_code) != 3:
            raise ValidationError(_('Use a valid 3-letter IATA city code (e.g. PAR, DXB).'))
        try:
            checkin = datetime.strptime(post.get('checkin_date') or '', '%Y-%m-%d').date()
            checkout = datetime.strptime(post.get('checkout_date') or '', '%Y-%m-%d').date()
        except ValueError as exc:
            raise ValidationError(_('Enter valid check-in and check-out dates.')) from exc
        if checkin < date.today():
            raise ValidationError(_('Check-in date cannot be in the past.'))
        if checkout <= checkin:
            raise ValidationError(_('Check-out date must be after check-in date.'))
        adults = max(self._safe_int(post.get('adults'), 1), 1)
        if adults > 9:
            raise ValidationError(_('A maximum of 9 adults is allowed per room search.'))
        rooms = max(self._safe_int(post.get('room_quantity'), 1), 1)
        return {
            'city_code': city_code,
            'checkin_date': checkin.isoformat(),
            'checkout_date': checkout.isoformat(),
            'adults': adults,
            'room_quantity': min(rooms, 9),
            'currency': (post.get('currency') or request.env.company.currency_id.name or 'USD').upper(),
        }

    @http.route('/trip/hotels/search', type='http', auth='public', website=True, methods=['POST'], csrf=True)
    def hotels_search(self, **post):
        error = None
        hotels = []
        vals = {}
        try:
            self._check_rate_limit()
            vals = self._validate_hotel_search(post)
            response = AmadeusHotels(request.env).search_hotels(vals)
            raw = response.get('data', []) if isinstance(response, dict) else []
            for item in raw[:12]:
                if not isinstance(item, dict):
                    continue
                hotel_info = item.get('hotel') or {}
                for offer in (item.get('offers') or [])[:2]:
                    if not isinstance(offer, dict):
                        continue
                    entry = {
                        'hotel': hotel_info,
                        'offer': offer,
                        '_payload': self._encode_offer_payload({'hotel': hotel_info, 'offer': offer}),
                    }
                    hotels.append(entry)
        except (UserError, ValidationError, ValueError) as exc:
            error = str(exc)
        except Exception:  # noqa: BLE001
            _logger.exception('Public hotel search failed')
            error = _('Hotel search could not be completed. Please try again later or contact support.')
        return request.render('trip.trip_hotel_results_template', {
            'search': vals,
            'hotels': hotels,
            'error': error,
        })

    @http.route('/trip/hotels/book', type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def hotels_book_offer(self, **post):
        try:
            payload = self._decode_offer_payload(post.get('offer_payload'))
            hotel_info = payload.get('hotel') or {}
            offer = payload.get('offer') or {}
            price = offer.get('price') or {}
            currency_name = price.get('currency') or request.env.company.currency_id.name
            currency = request.env['res.currency'].sudo().search([('name', '=', currency_name)], limit=1) or request.env.company.currency_id
            total = self._safe_float(price.get('total'))
            booking = request.env['trip.booking'].sudo().create({
                'partner_id': request.env.user.partner_id.id,
                'agent_id': request.env.user.id,
                'company_id': request.env.company.id,
                'booking_source': 'website',
                'booking_type': 'hotel',
                'state': 'searched',
                'currency_id': currency.id,
                'net_amount': total,
                'selected_offer_json': json.dumps(offer, ensure_ascii=False, indent=2, default=str),
            })
            booking._load_hotel_stay_from_offer(hotel_info, offer)
            booking.action_apply_pricing_rule()
            return request.redirect(f'/trip/booking/{booking.id}/passengers')
        except (UserError, ValidationError) as exc:
            _logger.info('Hotel offer selection failed: %s', exc)
            return request.render('trip.trip_booking_error_template', {'error': str(exc)})
        except Exception:  # noqa: BLE001
            _logger.exception('Hotel offer selection failed')
            return request.render('trip.trip_booking_error_template', {
                'error': _('Hotel booking could not be initialized. Please try again or contact support.')
            })

    # ------------------------------------------------------------------
    # Cars / Transfers
    # ------------------------------------------------------------------
    @http.route('/trip/cars', type='http', auth='public', website=True)
    def cars_page(self, **kwargs):
        return request.render('trip.cars_search_template', {})

    def _validate_car_search(self, post):
        pickup = (post.get('pickup_location') or '').strip().upper()
        if len(pickup) != 3:
            raise ValidationError(_('Use a valid 3-letter IATA airport code for the pickup location (e.g. CDG).'))
        raw_dt = (post.get('pickup_datetime') or '').strip()
        try:
            pickup_dt = datetime.strptime(raw_dt, '%Y-%m-%dT%H:%M')
        except ValueError as exc:
            raise ValidationError(_('Enter a valid pickup date and time.')) from exc
        if pickup_dt < datetime.now():
            raise ValidationError(_('Pickup time cannot be in the past.'))
        address = (post.get('dropoff_address') or '').strip()
        city = (post.get('dropoff_city') or '').strip()
        country = (post.get('dropoff_country_code') or '').strip().upper()
        if not address or not city or len(country) != 2:
            raise ValidationError(_('Enter the drop-off address, city, and 2-letter country code.'))
        passengers = max(self._safe_int(post.get('passengers'), 1), 1)
        return {
            'pickup_location': pickup,
            'pickup_datetime': pickup_dt.strftime('%Y-%m-%dT%H:%M:%S'),
            'dropoff_address': address,
            'dropoff_city': city,
            'dropoff_zip': (post.get('dropoff_zip') or '').strip(),
            'dropoff_country_code': country,
            'passengers': min(passengers, 9),
            'transfer_type': (post.get('transfer_type') or 'PRIVATE').upper(),
        }

    @http.route('/trip/cars/search', type='http', auth='public', website=True, methods=['POST'], csrf=True)
    def cars_search(self, **post):
        error = None
        offers = []
        vals = {}
        try:
            self._check_rate_limit()
            vals = self._validate_car_search(post)
            response = AmadeusCars(request.env).search_transfers(vals)
            raw = response.get('data', []) if isinstance(response, dict) else []
            for offer in raw[:10]:
                if isinstance(offer, dict):
                    offer = dict(offer)
                    offer['_payload'] = self._encode_offer_payload(offer)
                    offers.append(offer)
        except (UserError, ValidationError, ValueError) as exc:
            error = str(exc)
        except Exception:  # noqa: BLE001
            _logger.exception('Public transfer search failed')
            error = _('Transfer search could not be completed. Please try again later or contact support.')
        return request.render('trip.trip_car_results_template', {
            'search': vals,
            'offers': offers,
            'error': error,
        })

    @http.route('/trip/cars/book', type='http', auth='user', website=True, methods=['POST'], csrf=True)
    def cars_book_offer(self, **post):
        try:
            offer = self._decode_offer_payload(post.get('offer_payload'))
            quotation = offer.get('quotation') or {}
            currency_name = quotation.get('currencyCode') or request.env.company.currency_id.name
            currency = request.env['res.currency'].sudo().search([('name', '=', currency_name)], limit=1) or request.env.company.currency_id
            total = self._safe_float(quotation.get('monetaryAmount'))
            booking = request.env['trip.booking'].sudo().create({
                'partner_id': request.env.user.partner_id.id,
                'agent_id': request.env.user.id,
                'company_id': request.env.company.id,
                'booking_source': 'website',
                'booking_type': 'car',
                'state': 'searched',
                'currency_id': currency.id,
                'net_amount': total,
                'selected_offer_json': json.dumps(offer, ensure_ascii=False, indent=2, default=str),
            })
            booking._load_car_rental_from_offer(offer)
            booking.action_apply_pricing_rule()
            return request.redirect(f'/trip/booking/{booking.id}/passengers')
        except (UserError, ValidationError) as exc:
            _logger.info('Transfer offer selection failed: %s', exc)
            return request.render('trip.trip_booking_error_template', {'error': str(exc)})
        except Exception:  # noqa: BLE001
            _logger.exception('Transfer offer selection failed')
            return request.render('trip.trip_booking_error_template', {
                'error': _('Transfer booking could not be initialized. Please try again or contact support.')
            })
