from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = 'res.config.settings'

    trip_amadeus_access_mode = fields.Selection([
        ('self_service', 'Amadeus Self-Service / Legacy'),
        ('enterprise', 'Amadeus Enterprise'),
        ('aggregator', 'Travel API Aggregator'),
    ], string='Travel API Access Mode', default='self_service',
       config_parameter='fusion_travel.amadeus.access_mode')
    trip_amadeus_environment = fields.Selection([
        ('test', 'Test'),
        ('production', 'Production'),
    ], string='Amadeus Environment', default='test',
       config_parameter='fusion_travel.amadeus.environment')
    trip_amadeus_base_url = fields.Char(
        string='Amadeus / Provider Base URL Override',
        config_parameter='fusion_travel.amadeus.base_url',
        help='Leave empty to use the default Amadeus test/production URLs. Use this for Enterprise or aggregator endpoints.'
    )
    trip_amadeus_client_id = fields.Char(
        string='Client ID / API Key',
        config_parameter='fusion_travel.amadeus.client_id'
    )
    trip_amadeus_client_secret = fields.Char(
        string='Client Secret',
        config_parameter='fusion_travel.amadeus.client_secret'
    )
    trip_amadeus_token_url = fields.Char(
        string='OAuth Token URL Override',
        config_parameter='fusion_travel.amadeus.token_url',
        help='Optional. Leave empty for /v1/security/oauth2/token on the selected base URL.'
    )
    trip_amadeus_timeout = fields.Integer(
        string='API Timeout Seconds',
        default=45,
        config_parameter='fusion_travel.amadeus.timeout'
    )
    trip_amadeus_debug_logging = fields.Boolean(
        string='Store Full API Payloads',
        default=False,
        config_parameter='fusion_travel.amadeus.debug_logging',
        help='Disable in production if payloads may contain sensitive passenger information.'
    )

    trip_amadeus_queuing_office_id = fields.Char(
        string='Amadeus Queuing Office ID',
        config_parameter='fusion_travel.amadeus.queuing_office_id',
        help='Optional for Self-Service/consolidator routing. Used as queuingOfficeId in Flight Create Orders when configured.'
    )
    trip_default_country_calling_code = fields.Char(
        string='Default Passenger Phone Country Code',
        default='1',
        config_parameter='fusion_travel.default_country_calling_code',
        help='Used when passenger phone numbers are submitted without country-code parsing.'
    )
    trip_travel_agent_email = fields.Char(
        string='Travel Agent Contact Email',
        config_parameter='fusion_travel.travel_agent_email',
        help='Used as the travelAgent contact in Amadeus Hotel Booking v2 orders. Falls back to the acting user email when empty.'
    )


    fusion_travel_flight_product_id = fields.Many2one(
        "product.product", string="Flight Product",
        config_parameter="fusion_travel.flight_product_id", domain=[("type", "=", "service")],
    )
    fusion_travel_hotel_product_id = fields.Many2one(
        "product.product", string="Hotel Product",
        config_parameter="fusion_travel.hotel_product_id", domain=[("type", "=", "service")],
    )
    fusion_travel_car_product_id = fields.Many2one(
        "product.product", string="Car / Transfer Product",
        config_parameter="fusion_travel.car_product_id", domain=[("type", "=", "service")],
    )
    fusion_travel_offer_ttl_minutes = fields.Integer(
        string="Offer Lifetime (minutes)", default=20,
        config_parameter="fusion_travel.offer_ttl_minutes",
    )
