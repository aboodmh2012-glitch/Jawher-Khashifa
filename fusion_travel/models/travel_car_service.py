from odoo import api, fields, models, _
from odoo.exceptions import AccessError


class TripCarRental(models.Model):
    _name = 'fusion.travel.car.service'
    _description = 'Trip Car Rental'

    booking_id = fields.Many2one('fusion.travel.booking', required=True, ondelete='cascade')
    company_id = fields.Many2one('res.company', related='booking_id.company_id', store=True, readonly=True, index=True)
    provider = fields.Char()
    vehicle_type = fields.Char()
    pickup_location = fields.Char(required=True)
    dropoff_location = fields.Char(required=True)
    pickup_datetime = fields.Datetime()
    dropoff_datetime = fields.Datetime()
    driver_name = fields.Char()
    driver_age = fields.Integer()
    rate_plan = fields.Char()
    insurance_info = fields.Text()
    total_amount = fields.Monetary(currency_field='currency_id')
    currency_id = fields.Many2one(
        'res.currency', related='booking_id.currency_id', store=True,
        readonly=True, required=True,
    )
    confirmation_number = fields.Char()

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
                raise AccessError(_('Only a Travel Accountant or Manager can add a vehicle service after payment or provider processing has started.'))
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
            raise AccessError(_('Only a Travel Accountant or Manager can modify a vehicle service after payment or provider processing has started.'))

    def write(self, vals):
        if 'booking_id' in vals and any(record.booking_id.id != vals['booking_id'] for record in self):
            raise AccessError(_('A vehicle service cannot be moved to another booking.'))
        self._check_lifecycle_edit()
        return super().write(vals)

    def unlink(self):
        self._check_lifecycle_edit()
        return super().unlink()

