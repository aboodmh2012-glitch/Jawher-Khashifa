import base64
import json

from odoo import Command, api, fields, models, _
from odoo.exceptions import AccessError, ValidationError
from odoo.tools import float_is_zero


class FusionTravelFlightTicket(models.Model):
    _name = "fusion.travel.flight.ticket"
    _description = "Flight Ticket"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "issue_date desc, id desc"

    OPERATION_TO_ITEM = {
        "issue": "TICKET",
        "exchange": "EXCHANGE",
        "refund": "REFUND",
        "void": "VOID",
    }
    ITEM_TO_OPERATION = {value: key for key, value in OPERATION_TO_ITEM.items()}

    name = fields.Char(string="Reference", compute="_compute_name", store=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    booking_id = fields.Many2one("fusion.travel.booking", ondelete="restrict", index=True, tracking=True)
    partner_id = fields.Many2one("res.partner", string="Customer", tracking=True)

    # Existing Fusion Travel fields retained.
    provider_id = fields.Many2one("res.partner", string="Provider", domain=[("is_company", "=", True)])
    ticket_product_id = fields.Many2one(
        "product.product",
        string="Ticket Product",
        domain=[("sale_ok", "=", True)],
        default=lambda self: self._get_default_ticket_product_id(),
    )
    agent_id = fields.Many2one("res.partner", string="Issuing Agent")
    agent_user_id = fields.Many2one("res.users", string="Booking User", related="booking_id.agent_id", store=True, readonly=True)
    airline_num = fields.Char(string="Airline Number", index=True)
    airline_id = fields.Many2one("fusion.travel.airline", ondelete="restrict", index=True)
    airline_number = fields.Char(compute="_compute_airline_number", store=True, readonly=True)
    ticket_number = fields.Char(required=True, index=True)
    pnr = fields.Char(index=True)
    issue_date = fields.Date(required=True, default=fields.Date.context_today, index=True)
    sign_user = fields.Char(string="Signed By")
    item_type = fields.Selection(
        [("TICKET", "Ticket"), ("REFUND", "Refund"), ("EXCHANGE", "Exchange"), ("VOID", "Void")],
        required=True,
        default="TICKET",
        tracking=True,
    )
    operation_type = fields.Selection(
        [("issue", "Issue"), ("exchange", "Exchange"), ("refund", "Refund"), ("void", "Void")],
        required=True,
        default="issue",
        tracking=True,
    )
    original_ticket_id = fields.Many2one("fusion.travel.flight.ticket", string="Original Ticket", ondelete="restrict")
    traveler_name = fields.Char(required=True)
    currency_id = fields.Many2one("res.currency", required=True, default=lambda self: self.env.company.currency_id)

    # Existing supplier-side amounts.
    fare_amount = fields.Monetary(string="Fare", currency_field="currency_id")
    tax_amount = fields.Monetary(string="Taxes", currency_field="currency_id")
    total_amount = fields.Monetary(string="Supplier Total", currency_field="currency_id", compute="_compute_legacy_amounts", store=True)
    commission_amount = fields.Monetary(string="Supplier Commission", currency_field="currency_id")
    net_remit_amount = fields.Monetary(string="Supplier Net", currency_field="currency_id", compute="_compute_legacy_amounts", store=True)
    agent_amount = fields.Monetary(string="Customer Amount (Legacy)", currency_field="currency_id")
    void_fee = fields.Monetary(string="Void Fee", currency_field="currency_id")

    # Unified supplier/customer reporting aliases.  These are computed/inverse
    # fields rather than same-model ``related`` aliases, which keeps upgrades
    # predictable and makes the legacy and unified field names stay in sync.
    supplier_fare = fields.Monetary(
        compute="_compute_supplier_aliases", inverse="_inverse_supplier_fare",
        store=True, currency_field="currency_id",
    )
    supplier_tax = fields.Monetary(
        compute="_compute_supplier_aliases", inverse="_inverse_supplier_tax",
        store=True, currency_field="currency_id",
    )
    supplier_commission = fields.Monetary(
        compute="_compute_supplier_aliases", inverse="_inverse_supplier_commission",
        store=True, currency_field="currency_id",
    )
    supplier_net = fields.Monetary(
        compute="_compute_supplier_aliases", store=True, readonly=True,
        currency_field="currency_id",
    )
    customer_fare = fields.Monetary(
        currency_field="currency_id",
        help="For issue/exchange enter the amount charged; for refund enter the positive amount returned to the customer.",
    )
    customer_tax = fields.Monetary(currency_field="currency_id")
    service_fee = fields.Monetary(currency_field="currency_id")
    penalty_amount = fields.Monetary(
        currency_field="currency_id",
        help="Change, cancellation, or refund penalty charged to the customer.",
    )
    customer_total = fields.Monetary(currency_field="currency_id", compute="_compute_customer_amounts", store=True)
    gross_profit = fields.Monetary(currency_field="currency_id", compute="_compute_customer_amounts", store=True)

    move_ids = fields.Many2many(
        "account.move",
        "fusion_travel_ticket_move_rel",
        "ticket_id",
        "move_id",
        string="Accounting Documents",
        readonly=True,
    )
    invoice_id = fields.Many2one(
        "account.move", string="Customer Invoice", readonly=True,
        domain="[('move_type', 'in', ('out_invoice', 'out_refund')), ('company_id', '=', company_id)]",
    )
    provider_metadata = fields.Json(string="Provider Metadata")
    attachment_ids = fields.Many2many(
        "ir.attachment",
        "fusion_travel_ticket_ir_attachment_rel",
        "ticket_id",
        "attachment_id",
        string="Attachments",
    )
    state = fields.Selection(
        [("draft", "Draft"), ("posted", "Posted"), ("cancelled", "Cancelled")],
        default="draft",
        tracking=True,
    )

    # Keep the legacy database constraint name and shape so an existing
    # ``fusion_travel`` database can be upgraded without replacing its
    # established uniqueness rule during registry initialization.
    _sql_constraints = [(
        "ticket_provider_unique",
        "unique(item_type, pnr, airline_num, ticket_number)",
        "Each ticket must be unique per item type, PNR, airline and ticket number.",
    )]

    @api.model
    def _get_default_ticket_product_id(self):
        params = self.env["ir.config_parameter"].sudo()
        value = (
            params.get_param("fusion_travel.ticket_product_id")
            or params.get_param("fusion_travel.flight_product_id")
        )
        return int(value) if value and str(value).isdigit() else False

    @api.model
    def _prepare_compatibility_vals(self, vals):
        vals = dict(vals)
        if "operation_type" in vals and "item_type" not in vals:
            vals["item_type"] = self.OPERATION_TO_ITEM.get(vals["operation_type"], "TICKET")
        if "item_type" in vals and "operation_type" not in vals:
            vals["operation_type"] = self.ITEM_TO_OPERATION.get(vals["item_type"], "issue")
        if vals.get("airline_id"):
            airline = self.env["fusion.travel.airline"].browse(vals["airline_id"]).exists()
            if airline:
                vals["airline_num"] = airline.accounting_code or airline.airline_num
        alias_map = {
            "supplier_fare": "fare_amount",
            "supplier_tax": "tax_amount",
            "supplier_commission": "commission_amount",
        }
        for alias, legacy in alias_map.items():
            if alias in vals:
                vals.setdefault(legacy, vals[alias])
                vals.pop(alias, None)
        if "customer_fare" not in vals and vals.get("agent_amount") is not None:
            vals["customer_fare"] = vals.get("agent_amount") or 0.0
        return vals

    @api.model_create_multi
    def create(self, vals_list):
        return super().create([self._prepare_compatibility_vals(vals) for vals in vals_list])

    def write(self, vals):
        vals = self._prepare_compatibility_vals(vals)
        if "state" in vals and not self.env.context.get("allowed_ticket_write"):
            raise AccessError(_("Use the ticket workflow actions to change the ticket status."))
        if (
            not self.env.context.get("allowed_ticket_write")
            and self.filtered(lambda ticket: ticket.state == "posted")
        ):
            allowed = {"state", "move_ids", "invoice_id", "attachment_ids"}
            if set(vals) - allowed:
                raise ValidationError(_("Posted tickets cannot be edited. Create an exchange, refund or void operation instead."))
        return super().write(vals)

    @api.depends("airline_id.accounting_code", "airline_id.airline_num", "airline_num")
    def _compute_airline_number(self):
        for ticket in self:
            ticket.airline_number = ticket.airline_id.accounting_code or ticket.airline_id.airline_num or ticket.airline_num

    @api.depends("airline_number", "ticket_number", "pnr")
    def _compute_name(self):
        for ticket in self:
            base = "-".join(filter(None, [ticket.airline_number, ticket.ticket_number])) or _("New")
            ticket.name = "%s/%s" % (base, ticket.pnr) if ticket.pnr else base

    @api.depends("fare_amount", "tax_amount", "commission_amount", "net_remit_amount")
    def _compute_supplier_aliases(self):
        for ticket in self:
            ticket.supplier_fare = ticket.fare_amount
            ticket.supplier_tax = ticket.tax_amount
            ticket.supplier_commission = ticket.commission_amount
            ticket.supplier_net = ticket.net_remit_amount

    def _inverse_supplier_fare(self):
        for ticket in self:
            ticket.fare_amount = ticket.supplier_fare

    def _inverse_supplier_tax(self):
        for ticket in self:
            ticket.tax_amount = ticket.supplier_tax

    def _inverse_supplier_commission(self):
        for ticket in self:
            ticket.commission_amount = ticket.supplier_commission

    @api.depends("fare_amount", "tax_amount", "commission_amount", "operation_type")
    def _compute_legacy_amounts(self):
        for ticket in self:
            supplier_total = (ticket.fare_amount or 0.0) + (ticket.tax_amount or 0.0)
            if ticket.operation_type == "void":
                supplier_total = 0.0
            ticket.total_amount = supplier_total
            ticket.net_remit_amount = supplier_total - (ticket.commission_amount or 0.0)

    @api.depends(
        "customer_fare", "customer_tax", "service_fee", "penalty_amount", "void_fee",
        "agent_amount", "supplier_net", "operation_type",
    )
    def _compute_customer_amounts(self):
        for ticket in self:
            customer_fare = ticket.customer_fare or 0.0
            customer_tax = ticket.customer_tax or 0.0
            service_fee = ticket.service_fee or 0.0
            penalty = ticket.penalty_amount or 0.0

            if ticket.operation_type == "refund":
                # Refund fields are entered as positive values. Service fees and
                # penalties are amounts retained by the agency, so they reduce the
                # credit returned to the customer rather than increasing it.
                explicit = max(customer_fare + customer_tax - service_fee - penalty, 0.0)
            elif ticket.operation_type == "void":
                explicit = ticket.void_fee or 0.0
            else:
                explicit = customer_fare + customer_tax + service_fee + penalty

            has_explicit_customer_values = any((value or 0.0) != 0.0 for value in (
                ticket.customer_fare, ticket.customer_tax, ticket.service_fee,
                ticket.penalty_amount, ticket.void_fee,
            ))
            ticket.customer_total = (
                explicit if has_explicit_customer_values else (ticket.agent_amount or 0.0)
            )
            if ticket.operation_type == "refund":
                # Supplier credit received less the amount actually returned to
                # the customer equals retained refund revenue.
                ticket.gross_profit = (ticket.supplier_net or 0.0) - ticket.customer_total
            else:
                ticket.gross_profit = ticket.customer_total - (ticket.supplier_net or 0.0)

    @api.constrains(
        "fare_amount", "tax_amount", "commission_amount", "agent_amount",
        "void_fee", "customer_fare", "customer_tax", "service_fee", "penalty_amount",
    )
    def _check_non_negative_amounts(self):
        amount_fields = (
            "fare_amount", "tax_amount", "commission_amount", "agent_amount",
            "void_fee", "customer_fare", "customer_tax", "service_fee", "penalty_amount",
        )
        for ticket in self:
            negative = [field for field in amount_fields if (ticket[field] or 0.0) < 0.0]
            if negative:
                raise ValidationError(_(
                    "Ticket amounts must be entered as positive values. Negative fields: %s"
                ) % ", ".join(negative))
            supplier_total = (ticket.fare_amount or 0.0) + (ticket.tax_amount or 0.0)
            if (ticket.commission_amount or 0.0) > supplier_total:
                raise ValidationError(_(
                    "Supplier commission cannot exceed supplier fare plus tax."
                ))

    @api.constrains("company_id", "operation_type", "ticket_number")
    def _check_company_operation_ticket_unique(self):
        for ticket in self.filtered("ticket_number"):
            duplicate = self.search_count([
                ("id", "!=", ticket.id),
                ("company_id", "=", ticket.company_id.id),
                ("operation_type", "=", ticket.operation_type),
                ("ticket_number", "=", ticket.ticket_number),
            ])
            if duplicate:
                raise ValidationError(
                    _("The ticket number already exists for this operation and company.")
                )

    @api.constrains(
        "company_id", "booking_id", "partner_id", "currency_id", "invoice_id"
    )
    def _check_ticket_relations(self):
        for ticket in self:
            if ticket.booking_id and (
                ticket.booking_id.company_id != ticket.company_id
                or ticket.booking_id.partner_id != ticket.partner_id
                or ticket.booking_id.currency_id != ticket.currency_id
            ):
                raise ValidationError(_(
                    "Ticket company, customer and currency must match the linked booking."
                ))
            if ticket.invoice_id and (
                ticket.invoice_id.company_id != ticket.company_id
                or ticket.invoice_id.partner_id != (ticket.partner_id or ticket.agent_id)
                or ticket.invoice_id.currency_id != ticket.currency_id
                or ticket.invoice_id.move_type not in ("out_invoice", "out_refund")
            ):
                raise ValidationError(_(
                    "The linked customer invoice company, customer, currency and type must match the ticket."
                ))

    @api.constrains("operation_type", "item_type", "original_ticket_id")
    def _check_operation(self):
        for ticket in self:
            if self.OPERATION_TO_ITEM.get(ticket.operation_type) != ticket.item_type:
                raise ValidationError(_("Item Type and Operation Type must describe the same operation."))
            if ticket.operation_type in ("exchange", "refund", "void") and not ticket.original_ticket_id:
                raise ValidationError(_("Exchange, refund and void operations must reference the original ticket."))
            if ticket.original_ticket_id == ticket:
                raise ValidationError(_("A ticket cannot reference itself as the original ticket."))
            if (
                ticket.original_ticket_id
                and ticket.original_ticket_id.company_id != ticket.company_id
            ):
                raise ValidationError(_("The original ticket must belong to the same company."))
            if (
                ticket.original_ticket_id
                and ticket.original_ticket_id.currency_id != ticket.currency_id
            ):
                raise ValidationError(_("The original ticket and operation must use the same currency."))

    def _require_accountant(self):
        if not self.env.su and not self.env.user.has_group("fusion_travel.group_fusion_travel_accountant"):
            raise AccessError(_("Only a Travel Accountant or Manager can post tickets."))

    def _require_manager(self):
        if not self.env.su and not self.env.user.has_group("fusion_travel.group_fusion_travel_manager"):
            raise AccessError(_("Only a Travel Manager can cancel tickets."))

    def _prepare_move_vals(self, partner, move_type, amount, label):
        self.ensure_one()
        if (amount or 0.0) < 0.0:
            raise ValidationError(_("Accounting document amount cannot be negative."))
        if float_is_zero(amount or 0.0, precision_rounding=self.currency_id.rounding):
            return False
        if not partner:
            role = _("customer") if move_type in ("out_invoice", "out_refund") else _("provider")
            raise ValidationError(
                _("Set a %s before posting ticket %s.") % (role, self.display_name)
            )
        if not self.ticket_product_id:
            raise ValidationError(_("Configure a ticket product before posting ticket %s.") % self.display_name)
        return {
            "move_type": move_type,
            "partner_id": partner.id,
            "company_id": self.company_id.id,
            "currency_id": self.currency_id.id,
            "invoice_date": self.issue_date,
            "date": self.issue_date,
            "invoice_origin": self.name,
            "ref": self.name,
            "invoice_line_ids": [Command.create({
                "product_id": self.ticket_product_id.id,
                "name": label,
                "quantity": 1.0,
                "price_unit": abs(amount or 0.0),
            })],
        }

    def action_post(self):
        self._require_accountant()
        Move = self.env["account.move"]
        for ticket in self:
            if ticket.state != "draft":
                raise ValidationError(_("Only draft tickets can be posted."))

            linked_customer_move = ticket.invoice_id.exists().filtered(
                lambda move: (
                    move.state != "cancel"
                    and move.move_type in ("out_invoice", "out_refund")
                    and move.company_id == ticket.company_id
                    and move.partner_id == (ticket.partner_id or ticket.agent_id)
                )
            )
            if ticket.invoice_id and not linked_customer_move:
                raise ValidationError(
                    _("The linked customer invoice has the wrong company, customer, type, or is cancelled.")
                )
            other_active_moves = ticket.move_ids.filtered(
                lambda move: move != linked_customer_move and move.state != "cancel"
            )
            if other_active_moves:
                raise ValidationError(_("This ticket already has active supplier accounting documents."))

            customer = ticket.partner_id or ticket.agent_id
            new_vals = []
            if ticket.operation_type != "void":
                provider_type = "in_refund" if ticket.operation_type == "refund" else "in_invoice"
                provider_vals = ticket._prepare_move_vals(
                    ticket.provider_id, provider_type, ticket.supplier_net,
                    _("Supplier ticket %s") % ticket.name,
                )
                if provider_vals:
                    new_vals.append(provider_vals)

            # Website/API bookings already have one booking-level customer invoice.
            # Reuse it rather than creating a second invoice for every passenger
            # ticket. Manually entered tickets still create their own invoice.
            if not linked_customer_move:
                customer_type = "out_refund" if ticket.operation_type == "refund" else "out_invoice"
                customer_vals = ticket._prepare_move_vals(
                    customer, customer_type, ticket.customer_total,
                    _("Customer ticket %s") % ticket.name,
                )
                if customer_vals:
                    new_vals.append(customer_vals)

            new_moves = Move.create(new_vals) if new_vals else Move
            if new_moves:
                new_moves.action_post()

            if linked_customer_move and linked_customer_move.state == "draft":
                linked_customer_move.action_post()

            all_moves = linked_customer_move | new_moves
            if not all_moves:
                raise ValidationError(_("No supplier or customer accounting document is available to post."))

            customer_moves = all_moves.filtered(
                lambda move: move.move_type in ("out_invoice", "out_refund")
            )
            ticket.with_context(allowed_ticket_write=True).write({
                "move_ids": [Command.set(all_moves.ids)],
                "invoice_id": (linked_customer_move or customer_moves[:1]).id,
                "state": "posted",
            })
            ticket._copy_attachments_and_metadata(new_moves)
        return True

    def action_confirm(self):
        return self.action_post()

    def action_cancel(self):
        self._require_manager()
        for ticket in self:
            if ticket.move_ids.filtered(lambda move: move.state == "posted"):
                raise ValidationError(_("Reverse or cancel the posted accounting documents before cancelling this ticket."))
            ticket.with_context(allowed_ticket_write=True).state = "cancelled"
        return True

    def action_reset_to_draft(self):
        self._require_manager()
        for ticket in self:
            if ticket.move_ids.filtered(lambda move: move.state == "posted"):
                raise ValidationError(_("Posted accounting documents prevent resetting this ticket to draft."))
            ticket.with_context(allowed_ticket_write=True).state = "draft"
        return True

    def _copy_attachments_and_metadata(self, moves):
        for ticket in self:
            for move in moves:
                for attachment in ticket.attachment_ids:
                    attachment.copy({"res_model": "account.move", "res_id": move.id})
                if ticket.provider_metadata:
                    payload = json.dumps(ticket.provider_metadata, indent=2, sort_keys=True, default=str).encode()
                    self.env["ir.attachment"].create({
                        "name": "%s_metadata.json" % (ticket.ticket_number or ticket.id),
                        "res_model": "account.move",
                        "res_id": move.id,
                        "type": "binary",
                        "datas": base64.b64encode(payload),
                        "mimetype": "application/json",
                    })

    def unlink(self):
        if self.filtered(lambda ticket: ticket.state != "draft" or ticket.move_ids):
            raise ValidationError(_("Only draft tickets without accounting documents can be deleted."))
        return super().unlink()
