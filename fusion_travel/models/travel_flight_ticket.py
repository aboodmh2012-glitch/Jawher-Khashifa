from odoo import api, fields, models, _
from odoo.exceptions import AccessError, ValidationError


class FusionTravelFlightTicket(models.Model):
    _name = "fusion.travel.flight.ticket"
    _description = "Flight Ticket"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "issue_date desc, id desc"

    name = fields.Char(compute="_compute_name", store=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    booking_id = fields.Many2one("fusion.travel.booking", ondelete="restrict", index=True, tracking=True)
    partner_id = fields.Many2one("res.partner", string="Customer", required=True, tracking=True)
    provider_id = fields.Many2one("res.partner", string="Provider", domain=[("is_company", "=", True)])
    agent_id = fields.Many2one("res.users", string="Agent", tracking=True)
    airline_id = fields.Many2one("fusion.travel.airline", ondelete="restrict", index=True)
    airline_number = fields.Char(related="airline_id.accounting_code", store=True, readonly=True)
    ticket_number = fields.Char(required=True, index=True)
    pnr = fields.Char(index=True)
    traveler_name = fields.Char(required=True)
    issue_date = fields.Date(required=True, default=fields.Date.context_today, index=True)
    operation_type = fields.Selection([
        ("issue", "Issue"), ("exchange", "Exchange"), ("refund", "Refund"), ("void", "Void")
    ], required=True, default="issue", tracking=True)
    original_ticket_id = fields.Many2one("fusion.travel.flight.ticket", string="Original Ticket", ondelete="restrict")
    currency_id = fields.Many2one("res.currency", required=True, default=lambda self: self.env.company.currency_id)
    supplier_fare = fields.Monetary(currency_field="currency_id")
    supplier_tax = fields.Monetary(currency_field="currency_id")
    supplier_commission = fields.Monetary(currency_field="currency_id")
    supplier_net = fields.Monetary(currency_field="currency_id", compute="_compute_amounts", store=True)
    customer_fare = fields.Monetary(currency_field="currency_id")
    customer_tax = fields.Monetary(currency_field="currency_id")
    service_fee = fields.Monetary(currency_field="currency_id")
    penalty_amount = fields.Monetary(currency_field="currency_id")
    customer_total = fields.Monetary(currency_field="currency_id", compute="_compute_amounts", store=True)
    gross_profit = fields.Monetary(currency_field="currency_id", compute="_compute_amounts", store=True)
    invoice_id = fields.Many2one("account.move", readonly=True)
    state = fields.Selection([("draft", "Draft"), ("confirmed", "Confirmed"), ("cancelled", "Cancelled")], default="draft", tracking=True)

    _sql_constraints = [(
        "ticket_operation_unique",
        "unique(company_id, operation_type, ticket_number)",
        "The ticket number already exists for this operation and company.",
    )]

    @api.depends("airline_number", "ticket_number", "pnr")
    def _compute_name(self):
        for ticket in self:
            base = "-".join(filter(None, [ticket.airline_number, ticket.ticket_number])) or _("New")
            ticket.name = "%s/%s" % (base, ticket.pnr) if ticket.pnr else base

    @api.depends(
        "supplier_fare", "supplier_tax", "supplier_commission",
        "customer_fare", "customer_tax", "service_fee", "penalty_amount", "operation_type"
    )
    def _compute_amounts(self):
        for ticket in self:
            supplier_total = (ticket.supplier_fare or 0.0) + (ticket.supplier_tax or 0.0)
            customer_total = (ticket.customer_fare or 0.0) + (ticket.customer_tax or 0.0) + (ticket.service_fee or 0.0) + (ticket.penalty_amount or 0.0)
            if ticket.operation_type == "void":
                supplier_total = 0.0
            ticket.supplier_net = supplier_total - (ticket.supplier_commission or 0.0)
            ticket.customer_total = customer_total
            ticket.gross_profit = customer_total - ticket.supplier_net

    @api.constrains("operation_type", "original_ticket_id")
    def _check_original_ticket(self):
        for ticket in self:
            if ticket.operation_type in ("exchange", "refund", "void") and not ticket.original_ticket_id:
                raise ValidationError(_("Exchange, refund and void operations must reference the original ticket."))
            if ticket.original_ticket_id == ticket:
                raise ValidationError(_("A ticket cannot reference itself as the original ticket."))

    def action_confirm(self):
        if not self.env.su and not self.env.user.has_group('fusion_travel.group_fusion_travel_accountant'):
            raise AccessError(_('Only a Travel Accountant or Manager can confirm tickets.'))
        for ticket in self:
            if ticket.state != "draft":
                continue
            if ticket.invoice_id and ticket.invoice_id.state != "cancel":
                raise ValidationError(_("This ticket already has an active invoice."))
            ticket.state = "confirmed"
        return True

    def action_cancel(self):
        if not self.env.su and not self.env.user.has_group('fusion_travel.group_fusion_travel_manager'):
            raise AccessError(_('Only a Travel Manager can cancel tickets.'))
        for ticket in self:
            if ticket.invoice_id and ticket.invoice_id.state == "posted":
                raise ValidationError(_("Reverse or cancel the invoice before cancelling the ticket."))
            ticket.state = "cancelled"
        return True

    def unlink(self):
        if self.filtered(lambda rec: rec.state != "draft" or rec.invoice_id):
            raise ValidationError(_("Only draft tickets without accounting documents can be deleted."))
        return super().unlink()
