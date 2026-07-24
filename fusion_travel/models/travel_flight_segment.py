from odoo import api, fields, models, _
from odoo.exceptions import AccessError


class TripFlightSegment(models.Model):
    _name = 'fusion.travel.flight.segment'
    _description = 'Trip Flight Segment'
    _order = 'departure_time asc'

    booking_id = fields.Many2one('fusion.travel.booking', required=True, ondelete='cascade')
    company_id = fields.Many2one('res.company', related='booking_id.company_id', store=True, readonly=True, index=True)
    airline = fields.Char()
    airline_code = fields.Char()
    flight_number = fields.Char()
    origin_airport = fields.Char()
    destination_airport = fields.Char()
    departure_time = fields.Datetime()
    arrival_time = fields.Datetime()
    duration = fields.Char()
    cabin_class = fields.Selection([
        ('economy', 'Economy'),
        ('premium_economy', 'Premium Economy'),
        ('business', 'Business'),
        ('first', 'First'),
    ])
    stops = fields.Integer()
    aircraft = fields.Char()
    fare_basis = fields.Char()
    baggage_info = fields.Text()

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su and not self.env.user.has_group(
            'fusion_travel.group_fusion_travel_accountant'
        ):
            booking_ids = {vals.get('booking_id') for vals in vals_list if vals.get('booking_id')}
            bookings = self.env['fusion.travel.booking'].browse(booking_ids).exists()
            locked = bookings.filtered(lambda booking: (
                booking.payment_status != 'unpaid'
                or booking.provider_order_status != 'not_started'
                or booking.state in ('booked', 'ticketed', 'confirmed', 'cancelled')
            ))
            if locked:
                raise AccessError(_('Only a Travel Accountant or Manager can add flight segments after payment or provider processing has started.'))
        return super().create(vals_list)

    def _check_lifecycle_edit(self):
        if self.env.su or self.env.user.has_group('fusion_travel.group_fusion_travel_accountant'):
            return
        locked = self.filtered(lambda record: (
            record.booking_id.payment_status != 'unpaid'
            or record.booking_id.provider_order_status != 'not_started'
            or record.booking_id.state in ('booked', 'ticketed', 'confirmed', 'cancelled')
        ))
        if locked:
            raise AccessError(_('Only a Travel Accountant or Manager can modify flight segments after payment or provider processing has started.'))

    def write(self, vals):
        if 'booking_id' in vals and any(record.booking_id.id != vals['booking_id'] for record in self):
            raise AccessError(_('A flight segment cannot be moved to another booking.'))
        self._check_lifecycle_edit()
        return super().write(vals)

    def unlink(self):
        self._check_lifecycle_edit()
        return super().unlink()

