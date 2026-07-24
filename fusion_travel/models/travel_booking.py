import json
import re
from datetime import datetime

from odoo import api, fields, models, _
from odoo.exceptions import AccessError, UserError, ValidationError


class FusionTravelBooking(models.Model):
    _name = 'fusion.travel.booking'
    _description = 'Fusion Travel Booking'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'id desc'

    name = fields.Char(string='Booking Number', required=True, copy=False, readonly=True, default='New')
    company_id = fields.Many2one('res.company', string='Company', required=True, default=lambda self: self.env.company, index=True)
    partner_id = fields.Many2one('res.partner', string='Customer', required=True, tracking=True)
    agent_id = fields.Many2one('res.users', string='Booked By / Agent', default=lambda self: self.env.user, tracking=True)
    booking_source = fields.Selection([('website', 'Website'), ('backend', 'Backend'), ('agent', 'Agent')], default='backend', required=True)
    booking_type = fields.Selection([('flight', 'Flight'), ('hotel', 'Hotel'), ('car', 'Car / Transfer')], required=True, tracking=True)
    state = fields.Selection([
        ('draft', 'Draft'),
        ('searched', 'Searched'),
        ('priced', 'Priced'),
        ('pending_payment', 'Pending Payment'),
        ('booked', 'Booked'),
        ('ticketed', 'Ticketed'),
        ('confirmed', 'Confirmed'),
        ('cancelled', 'Cancelled'),
        ('failed', 'Failed'),
    ], default='draft', tracking=True)
    payment_status = fields.Selection([
        ('unpaid', 'Unpaid'),
        ('paid', 'Paid'),
        ('partial', 'Partial'),
        ('refunded', 'Refunded'),
    ], default='unpaid', tracking=True)
    currency_id = fields.Many2one('res.currency', required=True, default=lambda self: self.env.company.currency_id)
    net_amount = fields.Monetary(currency_field='currency_id', string='Net Amount')
    markup_amount = fields.Monetary(currency_field='currency_id', string='Markup')
    commission_amount = fields.Monetary(currency_field='currency_id', string='Agent Commission')
    total_amount = fields.Monetary(currency_field='currency_id', string='Total Amount', compute='_compute_total_amount', store=True)
    sale_order_id = fields.Many2one('sale.order', string='Sale Order', readonly=True)
    invoice_id = fields.Many2one('account.move', string='Invoice', readonly=True)
    flight_ticket_ids = fields.One2many('fusion.travel.flight.ticket', 'booking_id', string='Flight Tickets', readonly=True)
    offer_token = fields.Char(readonly=True, copy=False)
    idempotency_key = fields.Char(copy=False, index=True)
    amadeus_reference = fields.Char(string='Provider Reference')
    pnr = fields.Char(string='PNR')
    ticket_number = fields.Char(string='Ticket Number')
    api_status = fields.Char(string='API Status')
    passenger_ids = fields.One2many('fusion.travel.passenger', 'booking_id', string='Passengers')
    flight_segment_ids = fields.One2many('fusion.travel.flight.segment', 'booking_id', string='Flight Segments')
    hotel_stay_ids = fields.One2many('fusion.travel.hotel.stay', 'booking_id', string='Hotel Stay')
    car_rental_ids = fields.One2many('fusion.travel.car.service', 'booking_id', string='Car Rental')
    api_log_ids = fields.One2many('fusion.travel.api.log', 'booking_id', string='API Logs')
    selected_offer_json = fields.Text(string='Selected Offer JSON')
    priced_offer_json = fields.Text(string='Priced Offer JSON')
    booking_response_json = fields.Text(string='Booking / Order Response JSON')
    payment_method = fields.Selection([
        ('amadeus_card', 'Card via Amadeus API'),
        ('wallet', 'Odoo Wallet Balance'),
    ], default='amadeus_card', string='Payment Method')
    payment_reference = fields.Char(string='Payment Reference')
    internal_notes = fields.Text(string='Internal Notes')

    def _require_accountant(self):
        if not self.env.su and not self.env.user.has_group('fusion_travel.group_fusion_travel_accountant'):
            raise AccessError(_('Only a Travel Accountant or Manager can perform this operation.'))

    def _require_manager(self):
        if not self.env.su and not self.env.user.has_group('fusion_travel.group_fusion_travel_manager'):
            raise AccessError(_('Only a Travel Manager can perform this operation.'))

    def write(self, vals):
        protected_fields = {
            'payment_status', 'payment_reference', 'amadeus_reference', 'pnr',
            'ticket_number', 'api_status', 'booking_response_json', 'invoice_id',
        }
        if protected_fields.intersection(vals) and not self.env.su:
            self._require_accountant()
        return super().write(vals)

    @api.depends('net_amount', 'markup_amount')
    def _compute_total_amount(self):
        for rec in self:
            rec.total_amount = (rec.net_amount or 0.0) + (rec.markup_amount or 0.0)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('fusion.travel.booking') or 'New'
        return super().create(vals_list)

    def action_mark_priced(self):
        self.write({'state': 'priced'})

    def action_pending_payment(self):
        self.write({'state': 'pending_payment'})

    def action_confirm_booking(self):
        self._require_manager()
        self.write({'state': 'confirmed'})
        return True

    def action_mark_ticketed(self):
        self._require_accountant()
        for booking in self:
            if booking.booking_type == 'flight':
                if not booking.pnr:
                    raise UserError(_('A PNR is required before marking a flight booking as ticketed.'))
                if len(booking.passenger_ids) == 1 and booking.ticket_number and not booking.passenger_ids.ticket_number:
                    booking.passenger_ids.ticket_number = booking.ticket_number
                missing = booking.passenger_ids.filtered(lambda passenger: not passenger.ticket_number)
                if missing:
                    raise UserError(_('Each passenger must have an issued e-ticket number before ticketing.'))
            booking.write({'state': 'ticketed'})
            booking._create_flight_ticket_summary()
        return True

    def action_cancel(self):
        self._require_manager()
        self.write({'state': 'cancelled'})
        return True

    def action_apply_pricing_rule(self):
        for booking in self:
            domain = [('active', '=', True), ('service_type', '=', booking.booking_type), ('company_id', '=', booking.company_id.id)]
            first_segment = booking.flight_segment_ids[:1]
            if booking.booking_type == 'flight' and first_segment:
                if first_segment.airline_code:
                    domain += ['|', ('airline_code', '=', False), ('airline_code', '=', first_segment.airline_code)]
                if first_segment.cabin_class:
                    domain += ['|', ('cabin_class', '=', False), ('cabin_class', '=', first_segment.cabin_class)]
            rule = self.env['fusion.travel.pricing.rule'].search(domain, order='priority asc, id desc', limit=1)
            if rule:
                booking.markup_amount = rule.compute_markup(booking.net_amount or 0.0)
        return True


    def _get_service_product(self):
        self.ensure_one()
        key_map = {
            "flight": "fusion_travel.flight_product_id",
            "hotel": "fusion_travel.hotel_product_id",
            "car": "fusion_travel.car_product_id",
        }
        fallback_map = {
            "flight": "fusion_travel.product_fusion_travel_flight",
            "hotel": "fusion_travel.product_fusion_travel_hotel",
            "car": "fusion_travel.product_fusion_travel_car",
        }
        value = self.env["ir.config_parameter"].sudo().get_param(key_map[self.booking_type])
        product = self.env["product.product"].browse(int(value)).exists() if value and str(value).isdigit() else self.env["product.product"]
        return product or self.env.ref(fallback_map[self.booking_type])

    def _ensure_idempotency_key(self):
        for booking in self:
            if not booking.idempotency_key:
                booking.idempotency_key = "%s-%s" % (booking.company_id.id, booking.name)
        return True

    def _create_flight_ticket_summary(self):
        Ticket = self.env["fusion.travel.flight.ticket"]
        for booking in self.filtered(lambda rec: rec.booking_type == "flight"):
            if booking.flight_ticket_ids:
                continue
            first_segment = booking.flight_segment_ids[:1]
            airline = False
            if first_segment and first_segment.airline_code:
                airline = self.env["fusion.travel.airline"].search([("iata_code", "=", first_segment.airline_code)], limit=1)
            travelers = booking.passenger_ids or self.env["fusion.travel.passenger"]
            traveler_count = len(travelers) or 1
            for passenger in travelers:
                if not passenger.ticket_number:
                    raise UserError(_('An issued e-ticket number is required for every passenger.'))
                Ticket.create({
                    "company_id": booking.company_id.id,
                    "booking_id": booking.id,
                    "partner_id": booking.partner_id.id,
                    "agent_id": booking.agent_id.id,
                    "airline_id": airline.id if airline else False,
                    "ticket_number": passenger.ticket_number,
                    "pnr": booking.pnr,
                    "traveler_name": "%s %s" % (passenger.first_name, passenger.last_name),
                    "currency_id": booking.currency_id.id,
                    "supplier_fare": booking.net_amount / traveler_count,
                    "customer_fare": booking.net_amount / traveler_count,
                    "service_fee": booking.markup_amount / traveler_count,
                    "invoice_id": booking.invoice_id.id,
                    "state": "confirmed" if booking.state in ("ticketed", "confirmed") else "draft",
                })
        return True

    def action_create_sale_order(self):
        for booking in self:
            if booking.sale_order_id:
                continue
            if not booking.total_amount:
                raise UserError(_('Total amount must be greater than zero before creating a sale order.'))
            order = self.env['sale.order'].create({
                'partner_id': booking.partner_id.id,
                'company_id': booking.company_id.id,
                'currency_id': booking.currency_id.id,
                'origin': booking.name,
                'order_line': [(0, 0, {
                    'product_id': booking._get_service_product().id,
                    'name': _('Fusion Travel Booking %s') % booking.name,
                    'product_uom_qty': 1,
                    'price_unit': booking.total_amount,
                })],
            })
            booking.sale_order_id = order.id
        return True

    def action_create_invoice(self):
        self._require_accountant()
        for booking in self:
            if booking.invoice_id:
                continue
            if not booking.total_amount:
                raise UserError(_('Total amount must be greater than zero before creating invoice.'))
            invoice = self.env['account.move'].create({
                'move_type': 'out_invoice',
                'partner_id': booking.partner_id.id,
                'company_id': booking.company_id.id,
                'currency_id': booking.currency_id.id,
                'invoice_origin': booking.name,
                'invoice_line_ids': [(0, 0, {
                    'product_id': booking._get_service_product().id,
                    'name': _('Fusion Travel Booking %s') % booking.name,
                    'quantity': 1,
                    'price_unit': booking.total_amount,
                })],
            })
            booking.invoice_id = invoice.id
        return True

    def action_view_invoice(self):
        self.ensure_one()
        if not self.invoice_id:
            raise UserError(_('No invoice has been created.'))
        return {
            'type': 'ir.actions.act_window',
            'name': _('Invoice'),
            'res_model': 'account.move',
            'res_id': self.invoice_id.id,
            'view_mode': 'form',
        }

    def action_view_sale_order(self):
        self.ensure_one()
        if not self.sale_order_id:
            raise UserError(_('No sale order has been created.'))
        return {
            'type': 'ir.actions.act_window',
            'name': _('Sale Order'),
            'res_model': 'sale.order',
            'res_id': self.sale_order_id.id,
            'view_mode': 'form',
        }


    def _get_selected_offer(self):
        self.ensure_one()
        try:
            return json.loads(self.selected_offer_json or '{}')
        except Exception as exc:  # noqa: BLE001
            raise UserError(_('Selected offer is invalid. Please search again.')) from exc

    def _get_priced_offer(self):
        self.ensure_one()
        try:
            return json.loads(self.priced_offer_json or self.selected_offer_json or '{}')
        except Exception as exc:  # noqa: BLE001
            raise UserError(_('Priced offer is invalid. Please re-price the booking.')) from exc

    def _parse_provider_datetime(self, value):
        if not value:
            return False
        try:
            value = value.replace('Z', '+00:00')
            return datetime.fromisoformat(value).replace(tzinfo=None)
        except Exception:
            try:
                return fields.Datetime.to_datetime(value)
            except Exception:
                return False

    def _extract_offer_price(self, offer):
        price = (offer or {}).get('price') or {}
        return (
            price.get('currency') or self.currency_id.name,
            float(price.get('grandTotal') or price.get('total') or 0.0),
        )

    def _load_flight_segments_from_offer(self, offer):
        self.ensure_one()
        self.flight_segment_ids.unlink()
        values = []
        itineraries = (offer or {}).get('itineraries') or []
        for itinerary in itineraries:
            for segment in itinerary.get('segments') or []:
                carrier = segment.get('carrierCode')
                departure = segment.get('departure') or {}
                arrival = segment.get('arrival') or {}
                aircraft = segment.get('aircraft') or {}
                values.append((0, 0, {
                    'airline_code': carrier,
                    'flight_number': '%s%s' % (carrier or '', segment.get('number') or ''),
                    'origin_airport': departure.get('iataCode'),
                    'destination_airport': arrival.get('iataCode'),
                    'departure_time': self._parse_provider_datetime(departure.get('at')),
                    'arrival_time': self._parse_provider_datetime(arrival.get('at')),
                    'duration': itinerary.get('duration'),
                    'aircraft': aircraft.get('code') if isinstance(aircraft, dict) else False,
                }))
        if values:
            self.write({'flight_segment_ids': values})

    def _load_hotel_stay_from_offer(self, hotel_info, offer):
        """Map a Hotel Search v3 offer onto fusion.travel.hotel.stay lines."""
        self.ensure_one()
        self.hotel_stay_ids.unlink()
        hotel_info = hotel_info or {}
        offer = offer or {}
        room = offer.get('room') or {}
        room_desc = (room.get('description') or {}).get('text') or room.get('type') or ''
        policies = offer.get('policies') or {}
        cancellations = policies.get('cancellations') or policies.get('cancellation') or []
        if isinstance(cancellations, dict):
            cancellations = [cancellations]
        cancellation_text = json.dumps(cancellations, ensure_ascii=False, default=str) if cancellations else ''
        guests = offer.get('guests') or {}
        price = offer.get('price') or {}
        currency = self.env['res.currency'].sudo().search([('name', '=', price.get('currency') or self.currency_id.name)], limit=1) or self.currency_id
        address = hotel_info.get('address') or {}
        country = False
        if address.get('countryCode'):
            country = self.env['res.country'].sudo().search([('code', '=', address.get('countryCode'))], limit=1)
        self.write({'hotel_stay_ids': [(0, 0, {
            'hotel_name': hotel_info.get('name') or 'Hotel',
            'hotel_code': hotel_info.get('hotelId') or '',
            'city': hotel_info.get('cityCode') or address.get('cityName') or '',
            'country_id': country.id if country else False,
            'checkin_date': offer.get('checkInDate') or False,
            'checkout_date': offer.get('checkOutDate') or False,
            'room_type': room_desc[:120] if room_desc else '',
            'guests_count': int(guests.get('adults') or 1),
            'rate_plan': offer.get('rateCode') or '',
            'meal_plan': (offer.get('boardType') or ''),
            'cancellation_policy': cancellation_text,
            'total_amount': float(price.get('total') or 0.0),
            'currency_id': currency.id,
        })]})

    def _load_car_rental_from_offer(self, offer):
        """Map an Amadeus Transfer offer onto fusion.travel.car.service lines."""
        self.ensure_one()
        self.car_rental_ids.unlink()
        offer = offer or {}
        vehicle = offer.get('vehicle') or {}
        service_provider = offer.get('serviceProvider') or {}
        start = offer.get('start') or {}
        end = offer.get('end') or {}
        end_address = (end.get('address') or {})
        quotation = offer.get('quotation') or {}
        currency = self.env['res.currency'].sudo().search([('name', '=', quotation.get('currencyCode') or self.currency_id.name)], limit=1) or self.currency_id
        self.write({'car_rental_ids': [(0, 0, {
            'provider': service_provider.get('name') or '',
            'vehicle_type': vehicle.get('description') or vehicle.get('code') or '',
            'pickup_location': start.get('locationCode') or 'N/A',
            'dropoff_location': end_address.get('line') or end.get('locationCode') or 'N/A',
            'pickup_datetime': self._parse_provider_datetime(start.get('dateTime')),
            'dropoff_datetime': self._parse_provider_datetime(end.get('dateTime')),
            'total_amount': float(quotation.get('monetaryAmount') or 0.0),
            'currency_id': currency.id,
        })]})

    def action_price_booking(self):
        """Generic re-validation dispatcher used by website flows and buttons.

        - flight: Flight Offers Price API (full server-side revalidation)
        - hotel: Hotel Search v3 by-offer re-validation (real-time offer check)
        - car: transfer offers are short-lived quotes; keep the quoted amount
          and mark priced (Amadeus has no separate transfer re-pricing call).
        """
        for booking in self:
            if booking.booking_type == 'flight':
                booking.action_price_flight_booking()
            elif booking.booking_type == 'hotel':
                booking.action_price_hotel_booking()
            else:
                if not booking.net_amount:
                    raise UserError(_('This transfer booking has no quoted amount. Please search again.'))
                booking.write({'state': 'priced'})
                booking.action_apply_pricing_rule()
        return True

    def action_price_hotel_booking(self):
        for booking in self:
            if booking.booking_type != 'hotel':
                raise UserError(_('Hotel price validation applies to hotel bookings only.'))
            offer = booking._get_selected_offer()
            offer_id = offer.get('id')
            if not offer_id:
                raise UserError(_('Selected hotel offer is missing its ID. Please search again.'))
            from ..services.amadeus_hotels import AmadeusHotels
            response = AmadeusHotels(booking.env).get_offer(offer_id, booking=booking)
            data = response.get('data') if isinstance(response, dict) else {}
            validated_offer = offer
            hotel_info = {}
            if isinstance(data, dict):
                hotel_info = data.get('hotel') or {}
                offers = data.get('offers') or []
                for candidate in offers:
                    if candidate.get('id') == offer_id:
                        validated_offer = candidate
                        break
                else:
                    if offers:
                        validated_offer = offers[0]
            currency_name, total = booking._extract_offer_price(validated_offer)
            currency = booking.env['res.currency'].sudo().search([('name', '=', currency_name)], limit=1) or booking.currency_id
            booking.write({
                'priced_offer_json': json.dumps(validated_offer, ensure_ascii=False, indent=2, default=str),
                'currency_id': currency.id,
                'net_amount': total,
                'state': 'priced',
            })
            booking._load_hotel_stay_from_offer(hotel_info, validated_offer)
            booking.action_apply_pricing_rule()
        return True

    def action_price_flight_booking(self):
        for booking in self:
            if booking.booking_type != 'flight':
                raise UserError(_('Price confirmation is currently implemented for flight bookings.'))
            offer = booking._get_selected_offer()
            from ..services.amadeus_flights import AmadeusFlights
            response = AmadeusFlights(booking.env).price_offer(offer, booking=booking)
            data = response.get('data') if isinstance(response, dict) else {}
            priced_offer = offer
            if isinstance(data, dict):
                priced_offers = data.get('flightOffers') or []
                if priced_offers:
                    priced_offer = priced_offers[0]
            currency_name, total = booking._extract_offer_price(priced_offer)
            currency = booking.env['res.currency'].sudo().search([('name', '=', currency_name)], limit=1) or booking.currency_id
            booking.write({
                'priced_offer_json': json.dumps(priced_offer, ensure_ascii=False, indent=2, default=str),
                'currency_id': currency.id,
                'net_amount': total,
                'state': 'priced',
            })
            booking._load_flight_segments_from_offer(priced_offer)
            booking.action_apply_pricing_rule()
        return True

    def _build_amadeus_travelers(self):
        self.ensure_one()
        travelers = []
        gender_map = {'male': 'MALE', 'female': 'FEMALE'}
        for index, passenger in enumerate(self.passenger_ids, start=1):
            if not passenger.date_of_birth:
                raise UserError(_('Date of birth is required for every flight traveler.'))
            phone_digits = re.sub(r'\D+', '', passenger.phone or self.partner_id.phone or self.partner_id.mobile or '')
            if not phone_digits:
                raise UserError(_('A valid phone number is required for every flight traveler.'))
            if not passenger.first_name or not passenger.last_name:
                raise UserError(_('Passenger first and last names are required.'))
            traveler = {
                'id': str(index),
                'dateOfBirth': passenger.date_of_birth.isoformat(),
                'name': {
                    'firstName': passenger.first_name,
                    'lastName': passenger.last_name,
                },
                'gender': gender_map.get(passenger.gender or 'male', 'MALE'),
                'contact': {
                    'emailAddress': passenger.email or self.partner_id.email or '',
                    'phones': [{
                        'deviceType': 'MOBILE',
                        'countryCallingCode': self.env['ir.config_parameter'].sudo().get_param('fusion_travel.default_country_calling_code', '1') or '1',
                        'number': phone_digits,
                    }],
                },
            }
            documents = []
            if passenger.passport_number:
                documents.append({
                    'documentType': 'PASSPORT',
                    'number': passenger.passport_number,
                    'expiryDate': passenger.passport_expiry.isoformat() if passenger.passport_expiry else False,
                    'issuanceCountry': passenger.nationality_id.code if passenger.nationality_id else False,
                    'nationality': passenger.nationality_id.code if passenger.nationality_id else False,
                    'holder': True,
                })
            if documents:
                traveler['documents'] = [{k: v for k, v in doc.items() if v} for doc in documents]
            travelers.append(traveler)
        if not travelers:
            raise UserError(_('Add at least one passenger before creating the supplier order.'))
        return travelers


    def action_post_invoice(self):
        for booking in self:
            if not booking.invoice_id:
                booking.action_create_invoice()
            if booking.invoice_id.state == 'draft':
                booking.invoice_id.action_post()
        return True


    def _get_wallet_balance(self):
        self.ensure_one()
        Wallet = self.env['fusion.travel.wallet.transaction'].sudo()
        txs = Wallet.search([
            ('partner_id', '=', self.partner_id.id),
            ('company_id', '=', self.company_id.id),
            ('currency_id', '=', self.currency_id.id),
            ('state', '=', 'posted'),
        ])
        balance = 0.0
        for tx in txs:
            if tx.transaction_type in ('topup', 'refund', 'adjustment'):
                balance += tx.amount
            elif tx.transaction_type == 'booking_payment':
                balance -= tx.amount
        return balance

    def action_send_invoice_to_account(self):
        for booking in self:
            if not booking.invoice_id:
                continue
            template = self.env.ref('account.email_template_edi_invoice', raise_if_not_found=False)
            if template:
                template.sudo().send_mail(booking.invoice_id.id, force_send=True)
        return True


    def action_book_with_amadeus_card(self, card_payload=None):
        """Create a supplier PNR/order for an external provider-card flow.

        Important: Amadeus Self-Service Flight Create Orders creates the booking/PNR,
        but ticketing/payment settlement is handled by the consolidator, ARC/IATA,
        or an approved Enterprise/NDC adapter. This method deliberately does not
        collect, store, or forward raw card data from Odoo. Use a hosted payment
        page/tokenized provider flow for PCI-safe card collection.
        """
        for booking in self:
            if booking.state not in ('priced', 'pending_payment'):
                booking.action_price_booking()
            booking.write({
                'payment_method': 'amadeus_card',
                'payment_status': 'unpaid',
                'state': 'pending_payment',
                'payment_reference': _('Hosted provider/card payment is pending'),
            })
            # Supplier order creation must happen only after a signed callback from
            # the hosted/tokenized payment provider confirms payment. This module
            # deliberately does not collect or persist raw card data.
        return True

    def _lock_wallet(self):
        """Serialize wallet operations for the same customer/company using a
        PostgreSQL transaction-level advisory lock. This prevents two
        concurrent bookings from both reading a stale balance and
        overdrawing the wallet (double-spend). The lock is automatically
        released when the database transaction commits or rolls back.
        """
        self.ensure_one()
        lock_key = self.partner_id.id * 1000003 + self.company_id.id
        self.env.cr.execute('SELECT pg_advisory_xact_lock(%s)', (lock_key,))

    def action_pay_from_wallet_and_issue(self):
        """Wallet flow: check balance first, book supplier, then deduct and invoice.

        If balance is not enough: no booking.
        If supplier booking fails: no wallet deduction and no invoice.
        If supplier booking succeeds: deduct wallet, create/post invoice, send to accounting.
        """
        for booking in self:
            # Lock first, before any re-pricing or balance read, so a concurrent
            # or duplicated submission (double click / back button) serializes
            # here and observes the committed result of the first payment.
            booking._lock_wallet()

            # Idempotency guard: never charge a booking that is already paid or
            # whose supplier order was already created. Without this, a second
            # submission would skip the (already created) provider order but
            # still post a second wallet deduction for the same booking.
            booking.invalidate_recordset(['payment_status', 'state'])
            if booking.payment_status == 'paid' or booking.state in ('booked', 'ticketed', 'confirmed'):
                continue

            if booking.state not in ('priced', 'pending_payment'):
                booking.action_price_booking()

            balance = booking._get_wallet_balance()
            if balance < booking.total_amount:
                raise UserError(_('Wallet balance is not enough. Available: %s %s') % (balance, booking.currency_id.name))

            booking.write({
                'payment_method': 'wallet',
                'payment_status': 'unpaid',
                'state': 'pending_payment',
            })

            # Supplier booking first. If this raises, no wallet transaction or invoice is created.
            booking.action_create_provider_order(allow_unpaid=True)

            # Only after successful supplier booking, capture wallet and create accounting invoice.
            tx = booking.env['fusion.travel.wallet.transaction'].sudo().create({
                'company_id': booking.company_id.id,
                'partner_id': booking.partner_id.id,
                'transaction_type': 'booking_payment',
                'amount': booking.total_amount,
                'currency_id': booking.currency_id.id,
                'booking_id': booking.id,
                'payment_reference': _('Wallet payment for %s') % booking.name,
                'state': 'posted',
            })

            if not booking.invoice_id:
                booking.action_create_invoice()
            if booking.invoice_id.state == 'draft':
                booking.invoice_id.action_post()
            tx.invoice_id = booking.invoice_id.id

            booking.write({
                'payment_status': 'paid',
                'payment_reference': tx.payment_reference,
            })
            if booking.booking_type == 'flight':
                # A flight supplier order/PNR is not the same as an issued e-ticket.
                booking.write({'state': 'booked'})
            else:
                booking.action_confirm_booking()
            booking.action_send_invoice_to_account()
        return True

    def action_mark_payment_received(self):
        self._require_accountant()
        for booking in self:
            if not booking.invoice_id:
                raise UserError(_('Create and post the customer invoice, then register and reconcile its payment first.'))
            if booking.invoice_id.state != 'posted' or booking.invoice_id.payment_state != 'paid':
                raise UserError(_('The linked invoice must be posted and fully paid before confirming payment.'))
            booking.write({
                'payment_status': 'paid',
                'state': 'pending_payment' if booking.state == 'priced' else booking.state,
                'payment_reference': booking.payment_reference or booking.invoice_id.payment_reference or booking.invoice_id.name,
            })
            booking.action_send_invoice_to_account()
        return True

    def _build_hotel_guests(self):
        self.ensure_one()
        title_map = {'male': 'MR', 'female': 'MS'}
        guests = []
        for passenger in self.passenger_ids:
            if not passenger.first_name or not passenger.last_name:
                raise UserError(_('Guest first and last names are required.'))
            guests.append({
                'title': title_map.get(passenger.gender or 'male', 'MR'),
                'firstName': passenger.first_name,
                'lastName': passenger.last_name,
                'phone': passenger.phone or self.partner_id.phone or self.partner_id.mobile or '',
                'email': passenger.email or self.partner_id.email or '',
            })
        if not guests:
            raise UserError(_('Add at least one guest before creating the hotel order.'))
        return guests

    def _build_transfer_passengers(self):
        self.ensure_one()
        title_map = {'male': 'MR', 'female': 'MS'}
        passengers = []
        for passenger in self.passenger_ids:
            if not passenger.first_name or not passenger.last_name:
                raise UserError(_('Passenger first and last names are required.'))
            entry = {
                'firstName': passenger.first_name,
                'lastName': passenger.last_name,
                'title': title_map.get(passenger.gender or 'male', 'MR'),
                'contacts': {
                    'phoneNumber': passenger.phone or self.partner_id.phone or self.partner_id.mobile or '',
                    'email': passenger.email or self.partner_id.email or '',
                },
            }
            passengers.append(entry)
        if not passengers:
            raise UserError(_('Add at least one passenger before creating the transfer order.'))
        return passengers

    def action_create_provider_order(self, payment_payload=None, allow_unpaid=False):
        self._require_accountant()
        self._ensure_idempotency_key()
        for booking in self:
            if booking.amadeus_reference or booking.state in ('booked', 'ticketed', 'confirmed'):
                continue
            if booking.payment_status != 'paid' and not allow_unpaid:
                raise UserError(_('Confirm payment before creating the supplier order.'))
            if booking.booking_type == 'flight':
                booking._create_flight_provider_order()
            elif booking.booking_type == 'hotel':
                booking._create_hotel_provider_order()
            elif booking.booking_type == 'car':
                booking._create_transfer_provider_order()
            else:
                raise UserError(_('Unsupported booking type for supplier order creation.'))
            booking.write({'state': 'booked'})
        return True

    def _create_flight_provider_order(self):
        self.ensure_one()
        priced_offer = self._get_priced_offer()
        remarks = {
            'general': [{
                'subType': 'GENERAL_MISCELLANEOUS',
                'text': 'Created from Odoo booking %s' % self.name,
            }]
        }
        from ..services.amadeus_flights import AmadeusFlights
        queuing_office_id = self.env['ir.config_parameter'].sudo().get_param('fusion_travel.amadeus.queuing_office_id')
        response = AmadeusFlights(self.env).create_order(
            priced_offer,
            self._build_amadeus_travelers(),
            booking=self,
            remarks=remarks,
            queuing_office_id=queuing_office_id,
        )
        self._set_provider_response(response)

    def _create_hotel_provider_order(self):
        self.ensure_one()
        offer = self._get_priced_offer()
        offer_id = offer.get('id')
        if not offer_id:
            raise UserError(_('Hotel offer ID is missing. Please re-validate the offer.'))
        from ..services.amadeus_hotels import AmadeusHotels
        agent_email = self.env['ir.config_parameter'].sudo().get_param('fusion_travel.travel_agent_email') or self.env.user.email
        response = AmadeusHotels(self.env).book_hotel(
            offer_id,
            self._build_hotel_guests(),
            travel_agent_email=agent_email,
            booking=self,
        )
        self._set_hotel_provider_response(response)

    def _create_transfer_provider_order(self):
        self.ensure_one()
        offer = self._get_priced_offer()
        offer_id = offer.get('id')
        if not offer_id:
            raise UserError(_('Transfer offer ID is missing. Please search again.'))
        from ..services.amadeus_cars import AmadeusCars
        response = AmadeusCars(self.env).book_transfer(
            offer_id,
            self._build_transfer_passengers(),
            note='Created from Odoo booking %s' % self.name,
            booking=self,
        )
        self._set_transfer_provider_response(response)

    def _set_provider_response(self, response):
        self.ensure_one()
        debug_logging = self.env['ir.config_parameter'].sudo().get_param('fusion_travel.amadeus.debug_logging', 'False') in ('True', 'true', '1')
        self.booking_response_json = json.dumps(response, indent=2, ensure_ascii=False, default=str) if debug_logging else ''
        data = response.get('data') if isinstance(response, dict) else None
        if isinstance(data, dict):
            self.amadeus_reference = data.get('id') or self.amadeus_reference
            records = data.get('associatedRecords') or []
            if records:
                self.pnr = records[0].get('reference') or self.pnr
        self.api_status = 'success'

    def _set_hotel_provider_response(self, response):
        """Extract references from a Hotel Booking v2 hotel-order response."""
        self.ensure_one()
        debug_logging = self.env['ir.config_parameter'].sudo().get_param('fusion_travel.amadeus.debug_logging', 'False') in ('True', 'true', '1')
        self.booking_response_json = json.dumps(response, indent=2, ensure_ascii=False, default=str) if debug_logging else ''
        data = response.get('data') if isinstance(response, dict) else None
        if isinstance(data, dict):
            self.amadeus_reference = data.get('id') or self.amadeus_reference
            hotel_bookings = data.get('hotelBookings') or []
            if hotel_bookings:
                first = hotel_bookings[0] or {}
                confirmation = (first.get('hotelProviderInformation') or [{}])[0].get('confirmationNumber') or first.get('id')
                if confirmation and self.hotel_stay_ids:
                    self.hotel_stay_ids[0].confirmation_number = confirmation
                self.pnr = data.get('associatedRecords', [{}])[0].get('reference') if data.get('associatedRecords') else self.pnr
        self.api_status = 'success'

    def _set_transfer_provider_response(self, response):
        """Extract references from a Transfer Booking transfer-order response."""
        self.ensure_one()
        debug_logging = self.env['ir.config_parameter'].sudo().get_param('fusion_travel.amadeus.debug_logging', 'False') in ('True', 'true', '1')
        self.booking_response_json = json.dumps(response, indent=2, ensure_ascii=False, default=str) if debug_logging else ''
        data = response.get('data') if isinstance(response, dict) else None
        if isinstance(data, dict):
            self.amadeus_reference = data.get('id') or self.amadeus_reference
            transfers = data.get('transfers') or []
            if transfers and self.car_rental_ids:
                confirmation = transfers[0].get('confirmNbr') or transfers[0].get('reference')
                if confirmation:
                    self.car_rental_ids[0].confirmation_number = confirmation
        self.api_status = 'success'

    @api.constrains('booking_type', 'flight_segment_ids', 'hotel_stay_ids', 'car_rental_ids')
    def _check_trip_dates(self):
        for booking in self:
            for segment in booking.flight_segment_ids:
                if segment.departure_time and segment.arrival_time and segment.arrival_time < segment.departure_time:
                    raise ValidationError(_('Flight arrival time cannot be before departure time.'))
            for stay in booking.hotel_stay_ids:
                if stay.checkin_date and stay.checkout_date and stay.checkout_date <= stay.checkin_date:
                    raise ValidationError(_('Hotel checkout date must be after check-in date.'))
            for car in booking.car_rental_ids:
                if car.pickup_datetime and car.dropoff_datetime and car.dropoff_datetime <= car.pickup_datetime:
                    raise ValidationError(_('Car/transfer drop-off time must be after pickup time.'))
