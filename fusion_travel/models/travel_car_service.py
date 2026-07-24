from odoo import fields, models


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
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)
    confirmation_number = fields.Char()
