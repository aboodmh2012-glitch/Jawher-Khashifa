from odoo import fields, models


class TripPricingRule(models.Model):
    _name = 'trip.pricing.rule'
    _description = 'Trip Pricing Rule'
    _order = 'priority asc, id desc'

    name = fields.Char(required=True)
    company_id = fields.Many2one('res.company', string='Company', required=True, default=lambda self: self.env.company, index=True)
    service_type = fields.Selection([('flight', 'Flight'), ('hotel', 'Hotel'), ('car', 'Car')], required=True)
    airline_code = fields.Char()
    city = fields.Char(string='City / Location')
    provider = fields.Char()
    cabin_class = fields.Char()
    fixed_markup = fields.Monetary(currency_field='currency_id')
    percentage_markup = fields.Float(string='Percentage Markup')
    currency_id = fields.Many2one('res.currency', default=lambda self: self.env.company.currency_id)
    priority = fields.Integer(default=10)
    active = fields.Boolean(default=True)

    def compute_markup(self, net_amount):
        self.ensure_one()
        markup = self.fixed_markup or 0.0
        if self.percentage_markup:
            markup += net_amount * self.percentage_markup / 100.0
        return markup
