from odoo import fields, models


class TripFlightSegment(models.Model):
    _name = 'fusion.travel.flight.segment'
    _description = 'Trip Flight Segment'
    _order = 'departure_time asc'

    booking_id = fields.Many2one('fusion.travel.booking', required=True, ondelete='cascade')
    company_id = fields.Many2one('res.company', related='booking_id.company_id', store=True, readonly=True, index=True)
    airline = fields.Char()
    airline_code = fields.Char()
    flight_number = fields.Char()
    origin_airport = fields.Char()
    destination_airport = fields.Char()
    departure_time = fields.Datetime()
    arrival_time = fields.Datetime()
    duration = fields.Char()
    cabin_class = fields.Selection([
        ('economy', 'Economy'),
        ('premium_economy', 'Premium Economy'),
        ('business', 'Business'),
        ('first', 'First'),
    ])
    stops = fields.Integer()
    aircraft = fields.Char()
    fare_basis = fields.Char()
    baggage_info = fields.Text()
