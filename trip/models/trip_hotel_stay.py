from odoo import api, fields, models


class TripHotelStay(models.Model):
    _name = 'trip.hotel.stay'
    _description = 'Trip Hotel Stay'

    booking_id = fields.Many2one('trip.booking', required=True, ondelete='cascade')
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
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)
    confirmation_number = fields.Char()

    @api.depends('checkin_date', 'checkout_date')
    def _compute_nights(self):
        for rec in self:
            if rec.checkin_date and rec.checkout_date:
                rec.nights = max((rec.checkout_date - rec.checkin_date).days, 0)
            else:
                rec.nights = 0
