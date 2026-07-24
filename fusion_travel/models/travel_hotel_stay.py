from odoo import api, fields, models, _
from odoo.exceptions import AccessError


class TripHotelStay(models.Model):
    _name = 'fusion.travel.hotel.stay'
    _description = 'Trip Hotel Stay'

    booking_id = fields.Many2one('fusion.travel.booking', required=True, ondelete='cascade')
    company_id = fields.Many2one('res.company', related='booking_id.company_id', store=True, readonly=True, index=True)
    hotel_name = fields.Char(required=True)
    hotel_code = fields.Char()
    city = fields.Char()
    country_id = fields.Many2one('res.country')
    checkin_date = fields.Date()
    checkout_date = fields.Date()
    nights = fields.Integer(compute='_compute_nights', store=True)
    room_type = fields.Char()
    guests_count = fields.Integer(default=1)
    rate_plan = fields.Char()
    meal_plan = fields.Char()
    cancellation_policy = fields.Text()
    total_amount = fields.Monetary(currency_field='currency_id')
    currency_id = fields.Many2one(
        'res.currency', related='booking_id.currency_id', store=True,
        readonly=True, required=True,
    )
    confirmation_number = fields.Char()

    @api.depends('checkin_date', 'checkout_date')
    def _compute_nights(self):
        for rec in self:
            if rec.checkin_date and rec.checkout_date:
                rec.nights = max((rec.checkout_date - rec.checkin_date).days, 0)
            else:
                rec.nights = 0

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
                raise AccessError(_('Only a Travel Accountant or Manager can add a hotel stay after payment or provider processing has started.'))
        return super().create(vals_list)

    def _check_lifecycle_edit(self):
        if (
            self.env.su
            or self.env.context.get('fusion_travel_provider_sync')
            or self.env.user.has_group('fusion_travel.group_fusion_travel_accountant')
        ):
            return
        locked = self.filtered(lambda record: (
            record.booking_id.payment_status != 'unpaid'
            or record.booking_id.provider_order_status != 'not_started'
            or record.booking_id.state in ('booked', 'ticketed', 'confirmed', 'cancelled')
        ))
        if locked:
            raise AccessError(_('Only a Travel Accountant or Manager can modify a hotel stay after payment or provider processing has started.'))

    def write(self, vals):
        if 'booking_id' in vals and any(record.booking_id.id != vals['booking_id'] for record in self):
            raise AccessError(_('A hotel stay cannot be moved to another booking.'))
        self._check_lifecycle_edit()
        return super().write(vals)

    def unlink(self):
        self._check_lifecycle_edit()
        return super().unlink()

