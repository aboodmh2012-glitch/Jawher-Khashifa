from odoo import api, fields, models, _
from odoo.exceptions import AccessError, ValidationError


class TripPassenger(models.Model):
    _name = 'fusion.travel.passenger'
    _description = 'Trip Passenger'

    booking_id = fields.Many2one('fusion.travel.booking', required=True, ondelete='cascade')
    company_id = fields.Many2one('res.company', related='booking_id.company_id', store=True, readonly=True, index=True)
    passenger_type = fields.Selection([('adult', 'Adult'), ('child', 'Child'), ('infant', 'Infant')], required=True, default='adult')
    first_name = fields.Char(required=True)
    last_name = fields.Char(required=True)
    date_of_birth = fields.Date()
    gender = fields.Selection([('male', 'Male'), ('female', 'Female')])
    nationality_id = fields.Many2one('res.country', string='Nationality')
    passport_number = fields.Char()
    passport_expiry = fields.Date()
    email = fields.Char()
    phone = fields.Char()
    ticket_number = fields.Char(string='Issued E-ticket Number', copy=False, index=True)


    @api.constrains('passport_expiry')
    def _check_passport_expiry(self):
        for passenger in self:
            if passenger.passport_expiry and passenger.booking_id.flight_segment_ids:
                first_departure = passenger.booking_id.flight_segment_ids.sorted('departure_time')[:1].departure_time
                if first_departure and passenger.passport_expiry < first_departure.date():
                    raise ValidationError(_('Passport expiry cannot be before the first flight departure date.'))

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
                raise AccessError(_('Only a Travel Accountant or Manager can add passengers after payment or provider processing has started.'))
        return super().create(vals_list)

    def _check_lifecycle_edit(self, vals=None):
        if self.env.su:
            return
        vals = vals or {}
        locked = self.filtered(lambda passenger: (
            passenger.booking_id.payment_status != 'unpaid'
            or passenger.booking_id.provider_order_status != 'not_started'
            or passenger.booking_id.state in ('booked', 'ticketed', 'confirmed', 'cancelled')
        ))
        if not locked:
            return
        if set(vals) <= {'ticket_number'} and self.env.user.has_group(
            'fusion_travel.group_fusion_travel_accountant'
        ):
            return
        if not self.env.user.has_group('fusion_travel.group_fusion_travel_manager'):
            raise AccessError(_(
                'Only a Travel Manager can change passenger identity data after '
                'payment or provider processing has started.'
            ))

    def write(self, vals):
        if 'booking_id' in vals and any(passenger.booking_id.id != vals['booking_id'] for passenger in self):
            raise AccessError(_('A passenger cannot be moved to another booking.'))
        self._check_lifecycle_edit(vals)
        return super().write(vals)

    def unlink(self):
        self._check_lifecycle_edit()
        return super().unlink()

