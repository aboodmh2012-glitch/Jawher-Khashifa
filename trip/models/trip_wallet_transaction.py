from odoo import fields, models


class TripWalletTransaction(models.Model):
    _name = 'trip.wallet.transaction'
    _description = 'Trip Wallet Transaction'
    _order = 'id desc'

    company_id = fields.Many2one('res.company', string='Company', required=True, default=lambda self: self.env.company, index=True)
    partner_id = fields.Many2one('res.partner', string='Customer', required=True)
    transaction_type = fields.Selection([
        ('topup', 'Top-up'),
        ('booking_payment', 'Booking Payment'),
        ('refund', 'Refund'),
        ('adjustment', 'Adjustment'),
    ], required=True)
    amount = fields.Monetary(currency_field='currency_id', required=True)
    currency_id = fields.Many2one('res.currency', required=True, default=lambda self: self.env.company.currency_id)
    booking_id = fields.Many2one('trip.booking')
    invoice_id = fields.Many2one('account.move')
    payment_reference = fields.Char()
    accounting_entry_id = fields.Many2one('account.move', string='Accounting Entry')
    state = fields.Selection([('draft', 'Draft'), ('posted', 'Posted'), ('failed', 'Failed'), ('cancelled', 'Cancelled')], default='draft')

    def action_post(self):
        self.write({'state': 'posted'})
