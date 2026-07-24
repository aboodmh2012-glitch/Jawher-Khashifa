from odoo import api, fields, models, _


class TripOperation(models.Model):
    """A single operation on a booking/ticket, whether performed online by the
    module or captured manually from an external source (Amadeus/GDS, airline
    portal, ARC, office booking...).

    This is the operational ledger behind the Manual Operations and Operation
    reports: every booking, ticket issue, payment, void, refund and exchange
    is recorded here and linked to a customer, agent, invoice and booking.
    """

    _name = 'trip.operation'
    _description = 'Trip Operation'
    _order = 'operation_date desc, id desc'
    _inherit = ['mail.thread']

    name = fields.Char(string='Reference', required=True, copy=False, readonly=True, default='New')
    booking_id = fields.Many2one('trip.booking', string='Booking', ondelete='cascade', index=True)
    company_id = fields.Many2one('res.company', string='Company', required=True,
                                 default=lambda self: self.env.company, index=True)
    partner_id = fields.Many2one('res.partner', string='Customer', index=True)
    agent_id = fields.Many2one('res.users', string='Agent', default=lambda self: self.env.user, index=True)
    user_id = fields.Many2one('res.users', string='Recorded By', default=lambda self: self.env.user, readonly=True)

    operation_type = fields.Selection([
        ('booking', 'Manual Booking'),
        ('ticket_issue', 'Ticket Issue'),
        ('payment', 'Payment'),
        ('void', 'Void'),
        ('refund', 'Refund'),
        ('exchange', 'Exchange / Reissue'),
    ], string='Operation', required=True, default='booking', index=True, tracking=True)
    is_manual = fields.Boolean(string='Manual', default=True, index=True)
    source_system = fields.Selection([
        ('app', 'Online / App'),
        ('amadeus_gds', 'Amadeus / GDS'),
        ('airline_portal', 'Airline Portal'),
        ('arc_external', 'ARC / External System'),
        ('office_booking', 'Office Booking'),
        ('other', 'Other External Source'),
    ], string='Source System', default='other')
    operation_date = fields.Datetime(string='Date', default=fields.Datetime.now, index=True)

    # Ticket references (useful for standalone manual operations)
    booking_type = fields.Selection(related='booking_id.booking_type', store=True, string='Type')
    airline = fields.Char(string='Airline')
    pnr = fields.Char(string='PNR', index=True)
    ticket_number = fields.Char(string='Ticket Number', index=True)

    # Financials
    currency_id = fields.Many2one('res.currency', string='Currency',
                                  default=lambda self: self.env.company.currency_id)
    amount = fields.Monetary(currency_field='currency_id', string='Amount')

    # Payment
    payment_method = fields.Selection([
        ('cash', 'Cash'),
        ('card', 'Card'),
        ('bank_transfer', 'Bank Transfer'),
        ('wallet', 'Wallet'),
        ('amadeus_card', 'Card via Amadeus'),
        ('other', 'Other'),
    ], string='Payment Method')
    payment_status = fields.Selection([
        ('unpaid', 'Unpaid'),
        ('paid', 'Paid'),
        ('partial', 'Partial'),
        ('refunded', 'Refunded'),
    ], string='Payment Status')
    payment_reference = fields.Char(string='Payment Reference')
    invoice_id = fields.Many2one('account.move', string='Invoice')

    description = fields.Text(string='Notes')
    state = fields.Selection([
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('cancelled', 'Cancelled'),
    ], default='draft', required=True, tracking=True)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('name', 'New') == 'New':
                vals['name'] = self.env['ir.sequence'].next_by_code('trip.operation') or 'New'
        return super().create(vals_list)

    @api.onchange('booking_id')
    def _onchange_booking_id(self):
        if self.booking_id:
            self.partner_id = self.booking_id.partner_id
            self.agent_id = self.booking_id.agent_id
            self.currency_id = self.booking_id.currency_id
            self.pnr = self.booking_id.pnr
            self.ticket_number = self.booking_id.ticket_number
            self.airline = self.booking_id.airline
            if self.source_system == 'other':
                self.source_system = self.booking_id.source_system

    def action_confirm(self):
        self.write({'state': 'confirmed'})

    def action_cancel(self):
        self.write({'state': 'cancelled'})

    def action_draft(self):
        self.write({'state': 'draft'})
