from odoo import fields, models


class AccountMove(models.Model):
    _inherit = "account.move"

    fusion_travel_booking_ids = fields.One2many(
        "fusion.travel.booking", "invoice_id", string="Travel Bookings", readonly=True
    )
    # Existing relation name retained from the current Fusion Travel module.
    flight_ticket_ids = fields.Many2many(
        "fusion.travel.flight.ticket",
        "fusion_travel_ticket_move_rel",
        "move_id",
        "ticket_id",
        string="Flight Tickets",
        readonly=True,
    )
    fusion_travel_ticket_invoice_ids = fields.One2many(
        "fusion.travel.flight.ticket", "invoice_id", string="Customer Flight Tickets", readonly=True
    )

    def action_view_flight_tickets(self):
        self.ensure_one()
        action = self.env["ir.actions.act_window"]._for_xml_id(
            "fusion_travel.action_fusion_travel_flight_ticket"
        )
        action.update({
            "domain": [("id", "in", self.flight_ticket_ids.ids)],
            "context": {"create": False},
        })
        return action
