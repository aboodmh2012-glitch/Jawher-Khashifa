from odoo import api, fields, models, _
from odoo.exceptions import AccessError, ValidationError
from odoo.tools import float_is_zero


class TripWalletTransaction(models.Model):
    _name = 'fusion.travel.wallet.transaction'
    _description = 'Fusion Travel Wallet Transaction'
    _order = 'id desc'

    company_id = fields.Many2one(
        'res.company', string='Company', required=True,
        default=lambda self: self.env.company, index=True,
    )
    partner_id = fields.Many2one('res.partner', string='Customer', required=True, index=True)
    transaction_type = fields.Selection([
        ('topup', 'Top-up'),
        ('booking_payment', 'Booking Payment'),
        ('refund', 'Refund'),
        ('adjustment', 'Adjustment'),
    ], required=True, index=True)
    amount = fields.Monetary(currency_field='currency_id', required=True)
    currency_id = fields.Many2one(
        'res.currency', required=True,
        default=lambda self: self.env.company.currency_id,
    )
    booking_id = fields.Many2one('fusion.travel.booking', ondelete='restrict', index=True)
    invoice_id = fields.Many2one('account.move', ondelete='restrict')
    payment_reference = fields.Char()
    idempotency_key = fields.Char(copy=False, index=True)
    accounting_entry_id = fields.Many2one(
        'account.move', string='Accounting Entry', ondelete='restrict',
    )
    state = fields.Selection([
        ('draft', 'Draft'),
        ('posted', 'Posted'),
        ('failed', 'Failed'),
        ('cancelled', 'Cancelled'),
    ], default='draft', required=True, index=True)

    _sql_constraints = [
        (
            'fusion_travel_wallet_idempotency_unique',
            'unique(idempotency_key)',
            'The wallet transaction idempotency key must be unique.',
        ),
    ]

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su:
            for vals in vals_list:
                vals['state'] = 'draft'
        return super().create(vals_list)

    def write(self, vals):
        if 'state' in vals and not self.env.context.get('fusion_travel_wallet_state_write'):
            raise AccessError(_('Use wallet workflow actions to change transaction status.'))
        protected = {
            'partner_id', 'transaction_type', 'amount', 'currency_id',
            'booking_id', 'invoice_id', 'accounting_entry_id', 'idempotency_key',
        }
        if protected.intersection(vals) and self.filtered(lambda tx: tx.state == 'posted'):
            raise ValidationError(
                _('Posted wallet transactions cannot be edited. Create a correcting adjustment instead.')
            )
        return super().write(vals)

    def _write_state(self, state):
        return self.with_context(fusion_travel_wallet_state_write=True).write({'state': state})

    @api.constrains('amount')
    def _check_positive_amount(self):
        for transaction in self:
            if transaction.amount <= 0:
                raise ValidationError(_('Wallet transaction amount must be greater than zero.'))

    @api.constrains(
        'transaction_type', 'booking_id', 'partner_id', 'company_id',
        'currency_id', 'invoice_id',
    )
    def _check_booking_consistency(self):
        for transaction in self:
            if transaction.transaction_type != 'booking_payment':
                continue
            booking = transaction.booking_id
            if not booking:
                raise ValidationError(_('A booking payment requires a booking.'))
            if transaction.partner_id != booking.partner_id:
                raise ValidationError(_('Wallet customer must match the booking customer.'))
            if transaction.company_id != booking.company_id:
                raise ValidationError(_('Wallet company must match the booking company.'))
            if transaction.currency_id != booking.currency_id:
                raise ValidationError(_('Wallet currency must match the booking currency.'))
            if transaction.invoice_id and transaction.invoice_id != booking.invoice_id:
                raise ValidationError(_('Wallet invoice must match the booking invoice.'))
            if not float_is_zero(
                (transaction.amount or 0.0) - (booking.total_amount or 0.0),
                precision_rounding=transaction.currency_id.rounding,
            ):
                raise ValidationError(_('Wallet payment amount must equal the booking total.'))

    def action_post(self):
        if not self.env.su and not self.env.user.has_group(
            'fusion_travel.group_fusion_travel_accountant'
        ):
            raise AccessError(_('Only a Travel Accountant or Manager can post wallet transactions.'))
        for transaction in self:
            if transaction.state != 'draft':
                raise ValidationError(_('Only draft wallet transactions can be posted.'))
            if transaction.accounting_entry_id:
                if transaction.accounting_entry_id.company_id != transaction.company_id:
                    raise ValidationError(_('The accounting entry must belong to the wallet transaction company.'))
                if transaction.accounting_entry_id.state != 'posted':
                    raise ValidationError(_('The linked accounting entry must be posted.'))
            if transaction.transaction_type == 'booking_payment':
                if not transaction.booking_id or not transaction.invoice_id:
                    raise ValidationError(
                        _('A booking payment requires its booking and customer invoice.')
                    )
                if not transaction.idempotency_key:
                    raise ValidationError(_('A booking payment requires an idempotency key.'))
                if (
                    transaction.invoice_id.company_id != transaction.company_id
                    or transaction.invoice_id.partner_id != transaction.partner_id
                    or transaction.invoice_id.currency_id != transaction.currency_id
                ):
                    raise ValidationError(_(
                        'The wallet invoice company, customer and currency must match the transaction.'
                    ))
                if (
                    not transaction.accounting_entry_id
                    or transaction.accounting_entry_id.state != 'posted'
                ):
                    raise ValidationError(_(
                        'A booking payment requires the posted wallet settlement journal entry.'
                    ))
                transaction.invoice_id.invalidate_recordset(['payment_state'])
                if transaction.invoice_id.payment_state not in ('paid', 'in_payment'):
                    raise ValidationError(_(
                        'The linked customer invoice must be fully reconciled before posting the wallet debit.'
                    ))
            else:
                if (
                    not transaction.accounting_entry_id
                    or transaction.accounting_entry_id.state != 'posted'
                ):
                    raise ValidationError(
                        _('Top-ups, refunds and adjustments require a posted accounting entry.')
                    )
            transaction._write_state('posted')
        return True

    def action_cancel(self):
        if not self.env.su and not self.env.user.has_group(
            'fusion_travel.group_fusion_travel_manager'
        ):
            raise AccessError(_('Only a Travel Manager can cancel wallet transactions.'))
        for transaction in self:
            if transaction.state == 'posted':
                raise ValidationError(
                    _('Posted wallet transactions cannot be cancelled. Create a correcting entry.')
                )
            transaction._write_state('cancelled')
        return True
