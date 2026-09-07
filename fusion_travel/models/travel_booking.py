import json
import re
from datetime import datetime

from odoo import Command, api, fields, models, _
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
        ('amadeus_card', 'Hosted / Tokenized Card Adapter'),
        ('wallet', 'Odoo Wallet Balance'),
    ], default='amadeus_card', string='Payment Method')
    payment_reference = fields.Char(string='Payment Reference')
    wallet_transaction_id = fields.Many2one(
        'fusion.travel.wallet.transaction', string='Wallet Payment', readonly=True,
        copy=False, ondelete='restrict',
    )
    provider_order_status = fields.Selection([
        ('not_started', 'Not Started'),
        ('processing', 'Processing'),
        ('created', 'Created'),
        ('needs_review', 'Needs Review'),
    ], default='not_started', required=True, copy=False, tracking=True)
    provider_order_error = fields.Text(string='Provider Order Error', readonly=True, copy=False)
    internal_notes = fields.Text(string='Internal Notes')

    _sql_constraints = [
        (
            'fusion_travel_booking_idempotency_unique',
            'unique(company_id, idempotency_key)',
            'The provider idempotency key must be unique per company.',
        ),
    ]

    def _require_accountant(self):
        if not self.env.su and not self.env.user.has_group('fusion_travel.group_fusion_travel_accountant'):
            raise AccessError(_('Only a Travel Accountant or Manager can perform this operation.'))

    def _require_manager(self):
        if not self.env.su and not self.env.user.has_group('fusion_travel.group_fusion_travel_manager'):
            raise AccessError(_('Only a Travel Manager can perform this operation.'))

    def _require_travel_user(self):
        if not self.env.su and not self.env.user.has_group('fusion_travel.group_fusion_travel_user'):
            raise AccessError(_('Only an authorized Fusion Travel user can perform this operation.'))

    def _check_website_actor(self, partner_id):
        """Validate a controller-initiated private workflow call.

        This method is private (not RPC-callable) and must be supplied the current
        authenticated website user's partner id by the controller.  It prevents a
        ``sudo()`` website recordset from being used against another customer's
        booking.
        """
        self.ensure_one()
        if not partner_id or self.partner_id.id != int(partner_id):
            raise AccessError(_("You cannot operate another customer's booking."))
        if self.booking_source != 'website':
            raise AccessError(_('This operation is available only for website bookings.'))
        return True

    def write(self, vals):
        vals = dict(vals)
        workflow_write = self.env.context.get('fusion_travel_workflow_write')
        pricing_write = self.env.context.get('fusion_travel_pricing_write')
        provider_write = self.env.context.get('fusion_travel_provider_write')
        if 'state' in vals and not self.env.su and not workflow_write:
            raise AccessError(_('Use the booking workflow actions to change booking status.'))

        immutable_identity = {'company_id', 'partner_id', 'currency_id', 'booking_type'}
        if immutable_identity.intersection(vals):
            locked = self.filtered(lambda booking: (
                booking.sale_order_id
                or booking.invoice_id
                or booking.wallet_transaction_id
                or booking.payment_status != 'unpaid'
                or booking.provider_order_status != 'not_started'
                or booking.amadeus_reference
            ))
            if locked:
                raise ValidationError(_(
                    'Company, customer, currency and booking type cannot be changed after '
                    'sales, payment, accounting or provider processing has started.'
                ))

        protected_fields = {
            'payment_status', 'payment_reference', 'wallet_transaction_id',
            'provider_order_status', 'provider_order_error', 'amadeus_reference',
            'pnr', 'ticket_number', 'api_status', 'booking_response_json',
            'invoice_id', 'sale_order_id', 'idempotency_key',
        }
        pricing_fields = {
            'offer_token', 'selected_offer_json', 'priced_offer_json',
            'net_amount', 'markup_amount', 'commission_amount', 'currency_id',
        }
        if protected_fields.intersection(vals) and not self.env.su and not provider_write:
            self._require_accountant()
        if pricing_fields.intersection(vals) and not self.env.su and not pricing_write:
            self._require_accountant()
        return super().write(vals)

    def _write_workflow(self, vals):
        return self.with_context(
            fusion_travel_workflow_write=True,
            fusion_travel_pricing_write=True,
            fusion_travel_provider_write=True,
        ).write(vals)

    def _write_pricing(self, vals):
        return self.with_context(fusion_travel_pricing_write=True).write(vals)

    def _write_provider(self, vals):
        return self.with_context(
            fusion_travel_workflow_write=True,
            fusion_travel_provider_write=True,
        ).write(vals)

    @api.depends('net_amount', 'markup_amount')
    def _compute_total_amount(self):
        for rec in self:
            rec.total_amount = (rec.net_amount or 0.0) + (rec.markup_amount or 0.0)

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = [dict(vals) for vals in vals_list]
        trusted_create = self.env.su or self.env.context.get('fusion_travel_trusted_create')
        is_accountant = self.env.user.has_group(
            'fusion_travel.group_fusion_travel_accountant'
        ) if not self.env.su else True
        server_fields = {
            'payment_status', 'payment_reference', 'wallet_transaction_id',
            'provider_order_status', 'provider_order_error', 'amadeus_reference',
            'pnr', 'ticket_number', 'api_status', 'booking_response_json',
            'invoice_id', 'sale_order_id', 'idempotency_key',
        }
        offer_fields = {'offer_token', 'selected_offer_json', 'priced_offer_json'}
        for vals in vals_list:
            if not trusted_create and not is_accountant:
                vals['state'] = 'draft'
                vals['payment_status'] = 'unpaid'
                vals['provider_order_status'] = 'not_started'
                for field_name in server_fields | offer_fields:
                    if field_name not in {'payment_status', 'provider_order_status'}:
                        vals.pop(field_name, None)
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('fusion.travel.booking') or 'New'
        return super().create(vals_list)

    def action_mark_priced(self):
        self._require_accountant()
        self._write_workflow({'state': 'priced'})
        return True

    def action_pending_payment(self):
        self._require_accountant()
        self._write_workflow({'state': 'pending_payment'})
        return True

    def action_confirm_booking(self):
        self._require_manager()
        for booking in self:
            if booking.booking_source == 'website':
                if booking.payment_status != 'paid':
                    raise UserError(_('Website bookings must be paid before confirmation.'))
                if booking.provider_order_status != 'created' or not booking.amadeus_reference:
                    raise UserError(_('Create and reconcile the provider order before confirming the booking.'))
            if booking.provider_order_status in ('processing', 'needs_review'):
                raise UserError(_('Reconcile the provider order before confirming this booking.'))
            booking._write_workflow({'state': 'confirmed'})
        return True

    def action_mark_ticketed(self):
        self._require_accountant()
        for booking in self:
            if booking.booking_type == 'flight':
                if booking.booking_source == 'website':
                    if booking.payment_status != 'paid':
                        raise UserError(_('Website flight bookings must be paid before ticketing.'))
                    if booking.provider_order_status != 'created' or not booking.amadeus_reference:
                        raise UserError(_('Create and reconcile the provider order before ticketing.'))
                if not booking.pnr:
                    raise UserError(_('A PNR is required before marking a flight booking as ticketed.'))
                if len(booking.passenger_ids) == 1 and booking.ticket_number and not booking.passenger_ids.ticket_number:
                    booking.passenger_ids.ticket_number = booking.ticket_number
                missing = booking.passenger_ids.filtered(lambda passenger: not passenger.ticket_number)
                if missing:
                    raise UserError(_('Each passenger must have an issued e-ticket number before ticketing.'))
            booking._write_workflow({'state': 'ticketed'})
            booking._create_flight_ticket_summary()
        return True

    def action_cancel(self):
        self._require_manager()
        for booking in self:
            if booking.payment_status == 'paid' or booking.wallet_transaction_id:
                raise UserError(_(
                    'A paid booking cannot be cancelled by changing its status. '
                    'Create and post the appropriate refund/accounting correction first.'
                ))
            if (
                booking.provider_order_status in ('processing', 'created', 'needs_review')
                or booking.amadeus_reference
            ):
                raise UserError(_(
                    'This booking has provider activity. Reconcile or cancel it with the '
                    'provider before changing the Odoo booking status.'
                ))
            if booking.invoice_id and booking.invoice_id.state == 'posted':
                raise UserError(_(
                    'Cancel or reverse the posted customer invoice before cancelling the booking.'
                ))
            booking._write_workflow({'state': 'cancelled'})
        return True

    def action_apply_pricing_rule(self):
        self._require_travel_user()
        return self._apply_pricing_rule()

    def _apply_pricing_rule(self):
        for booking in self:
            domain = [
                ('active', '=', True),
                ('service_type', '=', booking.booking_type),
                ('company_id', '=', booking.company_id.id),
            ]
            first_segment = booking.flight_segment_ids[:1]
            if booking.booking_type == 'flight' and first_segment:
                if first_segment.airline_code:
                    domain += ['|', ('airline_code', '=', False), ('airline_code', '=', first_segment.airline_code)]
                if first_segment.cabin_class:
                    domain += ['|', ('cabin_class', '=', False), ('cabin_class', '=', first_segment.cabin_class)]
            rule = self.env['fusion.travel.pricing.rule'].search(
                domain, order='priority asc, id desc', limit=1,
            )
            booking._write_pricing({
                'markup_amount': rule.compute_markup(booking.net_amount or 0.0) if rule else 0.0,
            })
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

    def _allocate_currency_amount(self, amount, weights):
        """Allocate an amount with currency rounding and an exact final remainder."""
        self.ensure_one()
        weights = [max(float(weight or 0.0), 0.0) for weight in weights]
        if not weights:
            return []
        rounded_total = self.currency_id.round(float(amount or 0.0))
        weight_total = sum(weights)
        allocations = []
        remaining = rounded_total
        for index, weight in enumerate(weights):
            if index == len(weights) - 1:
                allocated = remaining
            elif weight_total:
                allocated = self.currency_id.round(rounded_total * weight / weight_total)
            else:
                allocated = self.currency_id.round(rounded_total / len(weights))
            allocations.append(allocated)
            remaining = self.currency_id.round(remaining - allocated)
        return allocations

    def _get_passenger_price_allocations(self):
        """Return supplier fare/tax and customer markup per passenger.

        Flight Offers Price returns ``travelerPricings`` keyed by traveler id.
        Passenger records are created in that same order for the provider order.
        When the provider omits traveler pricing, use a rounded equal allocation.
        """
        self.ensure_one()
        passengers = self.passenger_ids
        count = len(passengers)
        if not count:
            return []

        priced_offer = self._get_priced_offer()
        offer_price = (priced_offer or {}).get('price') or {}
        expected_total = float(
            offer_price.get('grandTotal')
            or offer_price.get('total')
            or self.net_amount
            or 0.0
        )
        expected_base = float(offer_price.get('base') or expected_total)
        traveler_pricings = (priced_offer or {}).get('travelerPricings') or []
        by_id = {
            str(item.get('travelerId')): item
            for item in traveler_pricings
            if isinstance(item, dict) and item.get('travelerId') is not None
        }

        allocations = []
        complete = bool(by_id)
        for index, _passenger in enumerate(passengers, start=1):
            item = by_id.get(str(index))
            price = (item or {}).get('price') or {}
            if not item or not price:
                complete = False
                break
            total = float(price.get('grandTotal') or price.get('total') or 0.0)
            base = float(price.get('base') or total)
            allocations.append({
                'supplier_fare': self.currency_id.round(base),
                'supplier_tax': self.currency_id.round(max(total - base, 0.0)),
            })

        if not complete or len(allocations) != count:
            base_parts = self._allocate_currency_amount(expected_base, [1.0] * count)
            tax_parts = self._allocate_currency_amount(
                max(expected_total - expected_base, 0.0), [1.0] * count,
            )
            allocations = [
                {'supplier_fare': base_parts[index], 'supplier_tax': tax_parts[index]}
                for index in range(count)
            ]
        else:
            # Absorb any provider-level rounding/fee remainder into the last tax
            # allocation so ticket totals still reconcile exactly to the offer.
            allocated_total = sum(
                item['supplier_fare'] + item['supplier_tax'] for item in allocations
            )
            difference = self.currency_id.round(expected_total - allocated_total)
            allocations[-1]['supplier_tax'] = self.currency_id.round(
                allocations[-1]['supplier_tax'] + difference
            )

        weights = [item['supplier_fare'] + item['supplier_tax'] for item in allocations]
        markup_parts = self._allocate_currency_amount(self.markup_amount, weights)
        for index, item in enumerate(allocations):
            item['service_fee'] = markup_parts[index]
        return allocations

    def _create_flight_ticket_summary(self):
        Ticket = self.env["fusion.travel.flight.ticket"]
        for booking in self.filtered(lambda rec: rec.booking_type == "flight"):
            if booking.flight_ticket_ids:
                continue
            first_segment = booking.flight_segment_ids[:1]
            airline = False
            if first_segment and first_segment.airline_code:
                airline = self.env["fusion.travel.airline"].search([
                    '|',
                    ("iata_code", "=", first_segment.airline_code),
                    ("airline_code", "=", first_segment.airline_code),
                ], limit=1)
            travelers = booking.passenger_ids
            if not travelers:
                raise UserError(_('Add passengers before creating issued ticket records.'))
            allocations = booking._get_passenger_price_allocations()
            params = self.env["ir.config_parameter"].sudo()
            provider_value = params.get_param("fusion_travel.default_provider_id")
            provider = (
                self.env["res.partner"].browse(int(provider_value)).exists()
                if provider_value and str(provider_value).isdigit()
                else self.env["res.partner"]
            )
            ticket_product = booking._get_service_product()
            for index, passenger in enumerate(travelers):
                if not passenger.ticket_number:
                    raise UserError(_('An issued e-ticket number is required for every passenger.'))
                allocation = allocations[index]
                Ticket.create({
                    "company_id": booking.company_id.id,
                    "booking_id": booking.id,
                    "partner_id": booking.partner_id.id,
                    "provider_id": provider.id,
                    "agent_id": booking.agent_id.partner_id.id if booking.agent_id else False,
                    "ticket_product_id": ticket_product.id,
                    "airline_id": airline.id if airline else False,
                    "ticket_number": passenger.ticket_number,
                    "pnr": booking.pnr,
                    "traveler_name": "%s %s" % (passenger.first_name, passenger.last_name),
                    "currency_id": booking.currency_id.id,
                    "supplier_fare": allocation['supplier_fare'],
                    "supplier_tax": allocation['supplier_tax'],
                    "customer_fare": allocation['supplier_fare'],
                    "customer_tax": allocation['supplier_tax'],
                    "service_fee": allocation['service_fee'],
                    "invoice_id": booking.invoice_id.id,
                    "move_ids": [Command.link(booking.invoice_id.id)] if booking.invoice_id else [],
                    # Ticketing and accounting are separate controls. The issued
                    # ticket is created in draft accounting state and can then
                    # reuse the booking invoice while posting any supplier bill.
                    "state": "draft",
                })
        return True

    def action_create_sale_order(self):
        self._require_accountant()
        for booking in self:
            if booking.sale_order_id:
                continue
            if not booking.total_amount:
                raise UserError(_('Total amount must be greater than zero before creating a sale order.'))
            order = self.env['sale.order'].with_company(booking.company_id).create({
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
            invoice = self.env['account.move'].with_company(booking.company_id).create({
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
        self.write({'car_rental_ids': [(0, 0, {
            'provider': service_provider.get('name') or '',
            'vehicle_type': vehicle.get('description') or vehicle.get('code') or '',
            'pickup_location': start.get('locationCode') or 'N/A',
            'dropoff_location': end_address.get('line') or end.get('locationCode') or 'N/A',
            'pickup_datetime': self._parse_provider_datetime(start.get('dateTime')),
            'dropoff_datetime': self._parse_provider_datetime(end.get('dateTime')),
            'total_amount': float(quotation.get('monetaryAmount') or 0.0),
        })]})

    def action_price_booking(self):
        self._require_travel_user()
        return self._price_booking()

    def _website_price_booking(self, partner_id):
        for booking in self:
            booking._check_website_actor(partner_id)
        return self._price_booking()

    def _price_booking(self):
        """Revalidate an unpaid booking before payment.

        A paid, booked, ticketed, confirmed, cancelled, or provider-review booking
        must never be pushed backwards into the pricing flow.
        """
        for booking in self:
            if booking.payment_status == 'paid':
                raise UserError(_('A paid booking cannot be repriced. Create a controlled change or refund instead.'))
            if booking.state in ('booked', 'ticketed', 'confirmed', 'cancelled'):
                raise UserError(_('This booking is no longer in the pricing workflow.'))
            if booking.provider_order_status in ('processing', 'created', 'needs_review'):
                raise UserError(_('Provider processing has already started for this booking.'))
            if booking.booking_type == 'flight':
                booking._price_flight_booking()
            elif booking.booking_type == 'hotel':
                booking._price_hotel_booking()
            else:
                if not booking.net_amount:
                    raise UserError(_('This transfer booking has no quoted amount. Please search again.'))
                booking._write_workflow({'state': 'priced'})
                booking._apply_pricing_rule()
        return True

    def action_price_hotel_booking(self):
        self._require_travel_user()
        return self._price_hotel_booking()

    def _price_hotel_booking(self):
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
            booking._write_workflow({
                'priced_offer_json': json.dumps(validated_offer, ensure_ascii=False, indent=2, default=str),
                'currency_id': currency.id,
                'net_amount': total,
                'state': 'priced',
            })
            booking._load_hotel_stay_from_offer(hotel_info, validated_offer)
            booking._apply_pricing_rule()
        return True

    def action_price_flight_booking(self):
        self._require_travel_user()
        return self._price_flight_booking()

    def _price_flight_booking(self):
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
            booking._write_workflow({
                'priced_offer_json': json.dumps(priced_offer, ensure_ascii=False, indent=2, default=str),
                'currency_id': currency.id,
                'net_amount': total,
                'state': 'priced',
            })
            booking._load_flight_segments_from_offer(priced_offer)
            booking._apply_pricing_rule()
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
        self._require_accountant()
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
        self._require_accountant()
        for booking in self:
            if not booking.invoice_id:
                continue
            template = self.env.ref('account.email_template_edi_invoice', raise_if_not_found=False)
            if template:
                # Email delivery must not roll back a successfully created provider
                # order or wallet payment. Mail failures are handled by Odoo's queue.
                template.sudo().send_mail(booking.invoice_id.id, force_send=False)
        return True


    def action_book_with_amadeus_card(self):
        self._require_accountant()
        return self._start_hosted_card_payment()

    def _website_start_hosted_card_payment(self, partner_id):
        for booking in self:
            booking._check_website_actor(partner_id)
        return self._start_hosted_card_payment()

    def _start_hosted_card_payment(self):
        """Move a booking to a hosted/tokenized card-payment stage.

        Amadeus Self-Service Create Orders creates a PNR, not a card charge or an
        issued ticket. Raw card data is never accepted or stored by this method.
        A signed callback from the selected payment/provider adapter must call the
        accountant-controlled payment confirmation workflow.
        """
        enabled = self.env['ir.config_parameter'].sudo().get_param(
            'fusion_travel.hosted_card_adapter_enabled', 'False'
        ) in ('True', 'true', '1')
        if not enabled:
            raise UserError(_(
                'Hosted card payment is not enabled. Install and validate a PCI-compliant '
                'payment adapter with a signed callback before exposing this option.'
            ))
        for booking in self:
            if booking.payment_status == 'paid' or booking.provider_order_status == 'created':
                raise UserError(_('This booking is already paid or has a provider order.'))
            if booking.state not in ('priced', 'pending_payment'):
                raise UserError(_('Revalidate the price before starting card payment.'))
            booking._write_workflow({
                'payment_method': 'amadeus_card',
                'payment_status': 'unpaid',
                'state': 'pending_payment',
                'payment_reference': _('Hosted/tokenized card payment is pending'),
            })
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

    def _create_wallet_settlement_entry(self):
        """Settle the posted customer invoice against the wallet liability.

        A wallet ledger debit alone is not accounting payment.  This journal entry
        debits the configured customer-wallet liability and credits the customer's
        receivable, then reconciles that receivable line with the invoice.
        """
        self.ensure_one()
        if not self.invoice_id or self.invoice_id.state != 'posted':
            raise UserError(_('A posted customer invoice is required for wallet settlement.'))

        company = self.company_id
        journal = company.fusion_travel_wallet_journal_id
        liability = company.fusion_travel_wallet_liability_account_id
        if not journal or not liability:
            raise UserError(_(
                'Configure the Travel Wallet Journal and Wallet Liability Account '
                'for company %s before accepting wallet payments.'
            ) % company.display_name)
        if journal.company_id != company:
            raise UserError(_('The configured wallet journal belongs to another company.'))
        if company not in liability.company_ids:
            raise UserError(_('The configured wallet liability account is not available to this company.'))
        if liability.account_type != 'liability_current' or not liability.active:
            raise UserError(_('The wallet account must be an active Current Liabilities account.'))

        receivable = self.partner_id.with_company(company).property_account_receivable_id
        if not receivable or not receivable.reconcile:
            raise UserError(_('The customer must have a reconcilable receivable account.'))

        move_date = fields.Date.context_today(self)
        company_amount = self.currency_id._convert(
            self.total_amount, company.currency_id, company, move_date,
        )
        if not company_amount:
            raise UserError(_('Wallet settlement amount must be greater than zero.'))

        foreign_currency = self.currency_id != company.currency_id
        liability_line = {
            'name': _('Wallet settlement for %s') % self.name,
            'partner_id': self.partner_id.id,
            'account_id': liability.id,
            'debit': company_amount,
            'credit': 0.0,
        }
        receivable_line = {
            'name': _('Wallet settlement for %s') % self.name,
            'partner_id': self.partner_id.id,
            'account_id': receivable.id,
            'date_maturity': move_date,
            'debit': 0.0,
            'credit': company_amount,
        }
        if foreign_currency:
            liability_line.update({
                'currency_id': self.currency_id.id,
                'amount_currency': self.total_amount,
            })
            receivable_line.update({
                'currency_id': self.currency_id.id,
                'amount_currency': -self.total_amount,
            })

        move = self.env['account.move'].with_company(company).create({
            'move_type': 'entry',
            'company_id': company.id,
            'journal_id': journal.id,
            'date': move_date,
            'ref': _('Wallet payment for %s') % self.name,
            'line_ids': [
                Command.create(liability_line),
                Command.create(receivable_line),
            ],
        })
        move.action_post()

        lines = (self.invoice_id.line_ids | move.line_ids).filtered(
            lambda line: line.account_id == receivable and not line.reconciled
        )
        if lines:
            lines.reconcile()
        self.invoice_id.invalidate_recordset(['payment_state'])
        if self.invoice_id.payment_state not in ('paid', 'in_payment'):
            raise UserError(_('The wallet settlement did not fully reconcile the customer invoice.'))
        return move

    def action_pay_from_wallet_and_issue(self):
        self._require_accountant()
        return self._pay_from_wallet_and_create_provider_order()

    def _website_pay_from_wallet_and_issue(self, partner_id):
        for booking in self:
            booking._check_website_actor(partner_id)
        return self._pay_from_wallet_and_create_provider_order()

    def _pay_from_wallet_and_create_provider_order(self):
        """Capture an idempotent wallet payment, account for it, then book.

        The local wallet debit and invoice settlement are intentionally retained if
        the provider result is uncertain.  That is safer than rolling them back
        after a timeout, which could leave a real external booking with no customer
        charge.  A failed/uncertain provider response is recorded as Needs Review
        and cannot be retried until a manager reconciles it.
        """
        Wallet = self.env['fusion.travel.wallet.transaction'].sudo()
        all_created = True
        for booking in self:
            self.env.cr.execute(
                'SELECT id FROM fusion_travel_booking WHERE id = %s FOR UPDATE',
                (booking.id,),
            )
            booking.invalidate_recordset([
                'state', 'payment_status', 'wallet_transaction_id',
                'provider_order_status', 'amadeus_reference', 'invoice_id',
            ])

            if booking.provider_order_status in ('processing', 'needs_review'):
                raise UserError(_('Provider processing has already started or requires review.'))
            if booking.provider_order_status == 'created' or booking.amadeus_reference:
                continue
            if booking.state not in ('priced', 'pending_payment', 'failed'):
                raise UserError(_('Revalidate the booking before paying from the wallet.'))

            payment_key = 'wallet-booking-%s-%s' % (booking.company_id.id, booking.id)
            existing_tx = Wallet.search([
                ('idempotency_key', '=', payment_key),
                ('company_id', '=', booking.company_id.id),
                ('booking_id', '=', booking.id),
            ], limit=1)

            if existing_tx and existing_tx.state == 'posted':
                booking.write({
                    'wallet_transaction_id': existing_tx.id,
                    'payment_method': 'wallet',
                    'payment_status': 'paid',
                    'payment_reference': existing_tx.payment_reference,
                })
            elif existing_tx:
                raise UserError(_('A previous wallet payment attempt is still pending.'))
            else:
                booking._lock_wallet()
                balance = booking._get_wallet_balance()
                if balance < booking.total_amount:
                    raise UserError(
                        _('Wallet balance is not enough. Available: %s %s')
                        % (balance, booking.currency_id.name)
                    )

                # All local accounting steps must succeed before the external call.
                if not booking.invoice_id:
                    booking.action_create_invoice()
                if booking.invoice_id.state == 'draft':
                    booking.invoice_id.action_post()

                tx = Wallet.create({
                    'company_id': booking.company_id.id,
                    'partner_id': booking.partner_id.id,
                    'transaction_type': 'booking_payment',
                    'amount': booking.total_amount,
                    'currency_id': booking.currency_id.id,
                    'booking_id': booking.id,
                    'invoice_id': booking.invoice_id.id,
                    'idempotency_key': payment_key,
                    'payment_reference': _('Wallet payment for %s') % booking.name,
                    'state': 'draft',
                })
                settlement_move = booking._create_wallet_settlement_entry()
                tx.write({'accounting_entry_id': settlement_move.id})
                tx.action_post()
                booking.write({
                    'wallet_transaction_id': tx.id,
                    'payment_method': 'wallet',
                    'payment_status': 'paid',
                    'payment_reference': tx.payment_reference,
                })
                booking._write_workflow({'state': 'pending_payment'})

            created = booking._create_provider_order()
            all_created = all_created and created
            if created and booking.booking_type != 'flight':
                booking._write_workflow({'state': 'confirmed'})

            try:
                booking.action_send_invoice_to_account()
            except Exception:  # noqa: BLE001
                # Mail delivery is queued and must not invalidate payment/booking.
                pass
        return all_created

    def action_mark_payment_received(self):
        self._require_accountant()
        for booking in self:
            if not booking.invoice_id:
                raise UserError(_('Create and post the customer invoice, then register and reconcile its payment first.'))
            if booking.invoice_id.state != 'posted' or booking.invoice_id.payment_state != 'paid':
                raise UserError(_('The linked invoice must be posted and fully paid before confirming payment.'))
            booking._write_workflow({
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

    def action_create_provider_order(self):
        self._require_accountant()
        created = self._create_provider_order(allow_unpaid=False)
        if created:
            return True
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'title': _('Provider order requires review'),
                'message': _('The payment was retained and automatic retry was blocked. Reconcile the provider result before retrying or refunding.'),
                'type': 'warning',
                'sticky': True,
            },
        }

    def _website_create_provider_order(self, partner_id):
        for booking in self:
            booking._check_website_actor(partner_id)
        return self._create_provider_order()

    def _create_provider_order(self, allow_unpaid=False):
        self._ensure_idempotency_key()
        all_created = True
        for booking in self:
            self.env.cr.execute(
                'SELECT id FROM fusion_travel_booking WHERE id = %s FOR UPDATE',
                (booking.id,),
            )
            booking.invalidate_recordset([
                'amadeus_reference', 'state', 'payment_status',
                'provider_order_status', 'provider_order_error',
            ])
            if booking.amadeus_reference or booking.provider_order_status == 'created':
                continue
            if booking.state in ('booked', 'ticketed', 'confirmed'):
                continue
            if booking.provider_order_status in ('processing', 'needs_review'):
                raise UserError(_('The provider order is already processing or requires manual reconciliation.'))
            if booking.payment_status != 'paid' and not allow_unpaid:
                raise UserError(_('Confirm payment before creating the supplier order.'))

            booking._write_workflow({
                'provider_order_status': 'processing',
                'provider_order_error': False,
            })
            try:
                if booking.booking_type == 'flight':
                    booking._create_flight_provider_order()
                elif booking.booking_type == 'hotel':
                    booking._create_hotel_provider_order()
                elif booking.booking_type == 'car':
                    booking._create_transfer_provider_order()
                else:
                    raise UserError(_('Unsupported booking type for supplier order creation.'))
            except Exception as exc:  # noqa: BLE001
                # Do not raise after writing Needs Review: an exception would roll
                # back the status and could also roll back a wallet debit while an
                # external order actually exists after a network timeout.
                booking._write_workflow({
                    'provider_order_status': 'needs_review',
                    'provider_order_error': str(exc)[:2000],
                    'api_status': 'needs_review',
                    'state': 'failed',
                })
                booking.message_post(body=_(
                    'Provider order outcome is uncertain or failed. Automatic retry is blocked until a manager reconciles it.'
                ))
                all_created = False
                continue

            if not booking.amadeus_reference:
                booking._write_workflow({
                    'provider_order_status': 'needs_review',
                    'provider_order_error': _('The provider response did not contain an order reference.'),
                    'api_status': 'needs_review',
                    'state': 'failed',
                })
                all_created = False
                continue

            booking._write_workflow({
                'provider_order_status': 'created',
                'provider_order_error': False,
                'state': 'booked',
            })
        return all_created

    def action_reset_provider_order_for_retry(self):
        self._require_manager()
        for booking in self:
            if booking.amadeus_reference:
                raise UserError(_('A booking with a provider reference cannot be reset for retry.'))
            if booking.provider_order_status != 'needs_review':
                raise UserError(_('Only bookings marked Needs Review can be reset.'))
            booking._write_workflow({
                'provider_order_status': 'not_started',
                'provider_order_error': False,
                'api_status': False,
                'state': 'pending_payment' if booking.payment_status == 'paid' else 'priced',
            })
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
        self._write_provider({
            'booking_response_json': json.dumps(response, indent=2, ensure_ascii=False, default=str) if debug_logging else '',
        })
        values = {'api_status': 'success'}
        data = response.get('data') if isinstance(response, dict) else None
        if isinstance(data, dict):
            values['amadeus_reference'] = data.get('id') or self.amadeus_reference
            records = data.get('associatedRecords') or []
            if records:
                values['pnr'] = records[0].get('reference') or self.pnr
        self._write_provider(values)

    def _set_hotel_provider_response(self, response):
        """Extract references from a Hotel Booking v2 hotel-order response."""
        self.ensure_one()
        debug_logging = self.env['ir.config_parameter'].sudo().get_param('fusion_travel.amadeus.debug_logging', 'False') in ('True', 'true', '1')
        self._write_provider({
            'booking_response_json': json.dumps(response, indent=2, ensure_ascii=False, default=str) if debug_logging else '',
        })
        values = {'api_status': 'success'}
        data = response.get('data') if isinstance(response, dict) else None
        if isinstance(data, dict):
            values['amadeus_reference'] = data.get('id') or self.amadeus_reference
            hotel_bookings = data.get('hotelBookings') or []
            if hotel_bookings:
                first = hotel_bookings[0] or {}
                confirmation = (first.get('hotelProviderInformation') or [{}])[0].get('confirmationNumber') or first.get('id')
                if confirmation and self.hotel_stay_ids:
                    self.hotel_stay_ids.with_context(fusion_travel_provider_sync=True)[0].confirmation_number = confirmation
            if data.get('associatedRecords'):
                values['pnr'] = data.get('associatedRecords', [{}])[0].get('reference') or self.pnr
        self._write_provider(values)

    def _set_transfer_provider_response(self, response):
        """Extract references from a Transfer Booking transfer-order response."""
        self.ensure_one()
        debug_logging = self.env['ir.config_parameter'].sudo().get_param('fusion_travel.amadeus.debug_logging', 'False') in ('True', 'true', '1')
        self._write_provider({
            'booking_response_json': json.dumps(response, indent=2, ensure_ascii=False, default=str) if debug_logging else '',
        })
        values = {'api_status': 'success'}
        data = response.get('data') if isinstance(response, dict) else None
        if isinstance(data, dict):
            values['amadeus_reference'] = data.get('id') or self.amadeus_reference
            transfers = data.get('transfers') or []
            if transfers and self.car_rental_ids:
                confirmation = transfers[0].get('confirmNbr') or transfers[0].get('reference')
                if confirmation:
                    self.car_rental_ids.with_context(fusion_travel_provider_sync=True)[0].confirmation_number = confirmation
        self._write_provider(values)

    @api.constrains(
        'net_amount', 'markup_amount', 'commission_amount', 'total_amount', 'state'
    )
    def _check_booking_amounts(self):
        for booking in self:
            if (booking.net_amount or 0.0) < 0:
                raise ValidationError(_('Booking net amount cannot be negative.'))
            if (booking.commission_amount or 0.0) < 0:
                raise ValidationError(_('Agent commission cannot be negative.'))
            if booking.state in ('priced', 'pending_payment', 'booked', 'ticketed', 'confirmed'):
                if booking.currency_id.is_zero(booking.total_amount or 0.0) or booking.total_amount < 0:
                    raise ValidationError(_('A priced or confirmed booking must have a positive total amount.'))

    @api.constrains(
        'company_id', 'partner_id', 'currency_id', 'agent_id',
        'sale_order_id', 'invoice_id'
    )
    def _check_booking_relations(self):
        for booking in self:
            if booking.agent_id and booking.company_id not in booking.agent_id.company_ids:
                raise ValidationError(_('The booking agent must have access to the booking company.'))
            if booking.sale_order_id:
                if (
                    booking.sale_order_id.company_id != booking.company_id
                    or booking.sale_order_id.partner_id != booking.partner_id
                    or booking.sale_order_id.currency_id != booking.currency_id
                ):
                    raise ValidationError(_(
                        'The sales order company, customer and currency must match the booking.'
                    ))
            if booking.invoice_id:
                if (
                    booking.invoice_id.company_id != booking.company_id
                    or booking.invoice_id.partner_id != booking.partner_id
                    or booking.invoice_id.currency_id != booking.currency_id
                    or booking.invoice_id.move_type not in ('out_invoice', 'out_refund')
                ):
                    raise ValidationError(_(
                        'The customer invoice company, customer, currency and document type '
                        'must match the booking.'
                    ))

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
