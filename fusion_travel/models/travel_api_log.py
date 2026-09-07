from odoo import api, fields, models, _
from odoo.exceptions import AccessError


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

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su:
            raise AccessError(_('API logs can only be created by the provider integration.'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.su:
            raise AccessError(_('API logs are immutable.'))
        return super().write(vals)

    def unlink(self):
        if not self.env.su:
            raise AccessError(_('API logs are immutable.'))
        return super().unlink()

