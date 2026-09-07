from odoo import fields, models


class ResCompany(models.Model):
    _inherit = 'res.company'

    fusion_travel_wallet_journal_id = fields.Many2one(
        'account.journal',
        string='Travel Wallet Journal',
        check_company=True,
        domain=[('type', '=', 'general')],
        help='General journal used to settle customer invoices from the Fusion Travel wallet.',
    )
    fusion_travel_wallet_liability_account_id = fields.Many2one(
        'account.account',
        string='Travel Wallet Liability Account',
        check_company=True,
        domain=[('account_type', '=', 'liability_current'), ('active', '=', True)],
        help='Current-liability account holding customer wallet balances.',
    )


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
        help='Leave empty to use the environment default. Override only for an approved Enterprise or aggregator OAuth endpoint.'
    )
    trip_amadeus_timeout = fields.Integer(
        string='Provider API Timeout Seconds',
        default=45,
        config_parameter='fusion_travel.amadeus.timeout',
        help='Applied to OAuth and provider REST requests. Values are constrained to 5–180 seconds.',
    )
    trip_amadeus_debug_logging = fields.Boolean(
        string='Store Full API Payloads',
        default=False,
        config_parameter='fusion_travel.amadeus.debug_logging',
        help='Disable in production if payloads may contain sensitive passenger information.'
    )

    trip_hosted_card_adapter_enabled = fields.Boolean(
        string='Enable Hosted Card Adapter',
        default=False,
        config_parameter='fusion_travel.hosted_card_adapter_enabled',
        help='Enable only after a PCI-compliant hosted/tokenized payment adapter and signed callback are installed and tested.',
    )

    trip_amadeus_queuing_office_id = fields.Char(
        string='Amadeus Queuing Office ID',
        config_parameter='fusion_travel.amadeus.queuing_office_id',
        help='Optional consolidator office identifier transmitted with Flight Create Orders when Amadeus has enabled multiple consolidators for the application.'
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
        'product.product', string='Flight Product',
        config_parameter='fusion_travel.flight_product_id', domain=[('type', '=', 'service')],
    )
    fusion_travel_hotel_product_id = fields.Many2one(
        'product.product', string='Hotel Product',
        config_parameter='fusion_travel.hotel_product_id', domain=[('type', '=', 'service')],
    )
    fusion_travel_car_product_id = fields.Many2one(
        'product.product', string='Car / Transfer Product',
        config_parameter='fusion_travel.car_product_id', domain=[('type', '=', 'service')],
    )

    ticket_product_id = fields.Many2one(
        'product.product', string='Ticket Accounting Product',
        config_parameter='fusion_travel.ticket_product_id', domain=[('type', '=', 'service')],
        help='Compatibility setting used by manually entered flight tickets.',
    )
    fusion_travel_default_provider_id = fields.Many2one(
        'res.partner', string='Default Travel Provider',
        config_parameter='fusion_travel.default_provider_id',
        domain=[('is_company', '=', True)],
        help='Default consolidator or supplier used when issued booking tickets are summarized for accounting.',
    )

    fusion_travel_offer_ttl_minutes = fields.Integer(
        string='Offer Lifetime (minutes)', default=20,
        config_parameter='fusion_travel.offer_ttl_minutes',
    )

    fusion_travel_wallet_journal_id = fields.Many2one(
        related='company_id.fusion_travel_wallet_journal_id',
        readonly=False,
        check_company=True,
        domain="[('company_id', '=', company_id), ('type', '=', 'general')]",
    )
    fusion_travel_wallet_liability_account_id = fields.Many2one(
        related='company_id.fusion_travel_wallet_liability_account_id',
        readonly=False,
        check_company=True,
        domain="[('company_ids', 'in', [company_id]), ('account_type', '=', 'liability_current'), ('active', '=', True)]",
    )
