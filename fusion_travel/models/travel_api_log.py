from odoo import fields, models


class TripApiLog(models.Model):
    _name = 'fusion.travel.api.log'
    _description = 'Trip API Log'
    _order = 'id desc'

    date = fields.Datetime(default=fields.Datetime.now, readonly=True)
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company, index=True, readonly=True)
    api_name = fields.Char(required=True)
    endpoint = fields.Char()
    environment = fields.Selection([('test', 'Test'), ('production', 'Production')], default='test')
    access_mode = fields.Selection([
        ('self_service', 'Self-Service / Legacy'),
        ('enterprise', 'Enterprise'),
        ('aggregator', 'Aggregator'),
    ], default='enterprise', readonly=True)
    request_payload = fields.Text(readonly=True)
    response_payload = fields.Text(readonly=True)
    status = fields.Selection([('success', 'Success'), ('failed', 'Failed')], readonly=True)
    http_status = fields.Integer(readonly=True)
    error_message = fields.Text(readonly=True)
    booking_id = fields.Many2one('fusion.travel.booking')
    user_id = fields.Many2one('res.users', default=lambda self: self.env.user)
