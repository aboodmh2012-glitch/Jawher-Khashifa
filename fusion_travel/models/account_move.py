from odoo import fields, models


class AccountMove(models.Model):
    _inherit = "account.move"

    fusion_travel_booking_ids = fields.One2many("fusion.travel.booking", "invoice_id", string="Travel Bookings", readonly=True)
    fusion_travel_ticket_ids = fields.One2many("fusion.travel.flight.ticket", "invoice_id", string="Flight Tickets", readonly=True)
