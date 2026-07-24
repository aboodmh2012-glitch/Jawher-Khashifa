from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class TripPassenger(models.Model):
    _name = 'trip.passenger'
    _description = 'Trip Passenger'

    booking_id = fields.Many2one('trip.booking', required=True, ondelete='cascade')
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
    is_lead = fields.Boolean(string='Lead Passenger')
    ticket_number = fields.Char(string='Ticket Number')
    seat_number = fields.Char(string='Seat')


    @api.constrains('passport_expiry')
    def _check_passport_expiry(self):
        for passenger in self:
            if passenger.passport_expiry and passenger.booking_id.flight_segment_ids:
                first_departure = passenger.booking_id.flight_segment_ids.sorted('departure_time')[:1].departure_time
                if first_departure and passenger.passport_expiry < first_departure.date():
                    raise ValidationError(_('Passport expiry cannot be before the first flight departure date.'))
