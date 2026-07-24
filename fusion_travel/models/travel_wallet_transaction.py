from odoo import api, fields, models, _
from odoo.exceptions import AccessError, ValidationError


class TripWalletTransaction(models.Model):
    _name = 'fusion.travel.wallet.transaction'
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
    booking_id = fields.Many2one('fusion.travel.booking')
    invoice_id = fields.Many2one('account.move')
    payment_reference = fields.Char()
    accounting_entry_id = fields.Many2one('account.move', string='Accounting Entry')
    state = fields.Selection([('draft', 'Draft'), ('posted', 'Posted'), ('failed', 'Failed'), ('cancelled', 'Cancelled')], default='draft')

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su:
            for vals in vals_list:
                vals['state'] = 'draft'
        return super().create(vals_list)

    def write(self, vals):
        protected = {'partner_id', 'transaction_type', 'amount', 'currency_id', 'booking_id', 'invoice_id', 'accounting_entry_id'}
        if protected.intersection(vals) and self.filtered(lambda transaction: transaction.state == 'posted'):
            raise ValidationError(_('Posted wallet transactions cannot be edited. Create a correcting adjustment instead.'))
        return super().write(vals)

    @api.constrains('amount')
    def _check_positive_amount(self):
        for transaction in self:
            if transaction.amount <= 0:
                raise ValidationError(_('Wallet transaction amount must be greater than zero.'))

    def action_post(self):
        if not self.env.su and not self.env.user.has_group('fusion_travel.group_fusion_travel_accountant'):
            raise AccessError(_('Only a Travel Accountant or Manager can post wallet transactions.'))
        for transaction in self:
            if transaction.transaction_type == 'booking_payment':
                if not transaction.booking_id or not transaction.invoice_id:
                    raise ValidationError(_('A booking payment requires its booking and customer invoice.'))
            else:
                if not transaction.accounting_entry_id or transaction.accounting_entry_id.state != 'posted':
                    raise ValidationError(_('Top-ups, refunds and adjustments require a posted accounting entry.'))
            transaction.write({'state': 'posted'})
        return True
