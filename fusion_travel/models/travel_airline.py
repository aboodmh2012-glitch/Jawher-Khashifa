import re

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError
from odoo.osv import expression


class FusionTravelAirline(models.Model):
    _name = "fusion.travel.airline"
    _description = "Airline"
    _order = "name"

    name = fields.Char(required=True, translate=True)
    iata_code = fields.Char(string="IATA Code", size=2, index=True)
    accounting_code = fields.Char(string="Ticketing Code", size=3, required=True, index=True)
    icao_code = fields.Char(string="ICAO Code", size=3)
    website = fields.Char()
    active = fields.Boolean(default=True)

    _airline_accounting_code_unique = models.Constraint(
        "UNIQUE(accounting_code)",
        "The ticketing code must be unique.",
    )
    _airline_iata_code_unique = models.Constraint(
        "UNIQUE(iata_code)",
        "The IATA code must be unique.",
    )

    @api.constrains("iata_code", "accounting_code", "icao_code")
    def _check_codes(self):
        for airline in self:
            if airline.iata_code and not re.fullmatch(r"[A-Z0-9]{2}", airline.iata_code.upper()):
                raise ValidationError(_("IATA code must contain exactly two letters or numbers."))
            if not re.fullmatch(r"\d{3}", airline.accounting_code or ""):
                raise ValidationError(_("Ticketing code must contain exactly three digits."))
            if airline.icao_code and not re.fullmatch(r"[A-Z0-9]{3}", airline.icao_code.upper()):
                raise ValidationError(_("ICAO code must contain exactly three letters or numbers."))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            for key in ("iata_code", "icao_code"):
                if vals.get(key):
                    vals[key] = vals[key].strip().upper()
            if vals.get("accounting_code"):
                vals["accounting_code"] = vals["accounting_code"].strip().zfill(3)
        return super().create(vals_list)

    def write(self, vals):
        vals = dict(vals)
        for key in ("iata_code", "icao_code"):
            if vals.get(key):
                vals[key] = vals[key].strip().upper()
        if vals.get("accounting_code"):
            vals["accounting_code"] = vals["accounting_code"].strip().zfill(3)
        return super().write(vals)

    @api.depends("name", "iata_code", "accounting_code")
    def _compute_display_name(self):
        for airline in self:
            codes = " / ".join(filter(None, [airline.iata_code, airline.accounting_code]))
            airline.display_name = "[%s] %s" % (codes, airline.name) if codes else airline.name

    @api.model
    def name_search(self, name="", domain=None, operator="ilike", limit=100):
        domain = list(domain or [])
        if not name:
            return super().name_search(name=name, domain=domain, operator=operator, limit=limit)
        code = name.strip().upper()
        match_domain = expression.OR([
            [("name", operator, name)],
            [("iata_code", operator, code)],
            [("accounting_code", operator, code)],
            [("icao_code", operator, code)],
        ])
        records = self.search(expression.AND([domain, match_domain]), limit=limit)
        return [(record.id, record.display_name) for record in records]
