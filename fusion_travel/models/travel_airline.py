import re

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError
from odoo.fields import Domain


class FusionTravelAirline(models.Model):
    _name = "fusion.travel.airline"
    _description = "Airline"
    _order = "name"

    # Existing Fusion Travel field names are retained for upgrade compatibility.
    name = fields.Char(string="Airline Name", required=True, translate=True)
    airline_code = fields.Char(string="Airline Code", size=2, index=True)
    airline_num = fields.Char(string="Airline Number", size=3, required=True, index=True)
    phone = fields.Char()
    email = fields.Char()
    website = fields.Char()

    # Clear aliases used by the unified booking/UI layer.
    iata_code = fields.Char(string="IATA Code", size=2, index=True)
    accounting_code = fields.Char(string="Ticketing Code", size=3, index=True)
    icao_code = fields.Char(string="ICAO Code", size=3)
    active = fields.Boolean(default=True)

    _sql_constraints = [
        ("fusion_travel_airline_num_unique", "unique(airline_num)", "The airline number must be unique."),
        ("fusion_travel_airline_code_unique", "unique(airline_code)", "The airline code must be unique."),
    ]

    @api.model
    def _normalize_values(self, vals):
        vals = dict(vals)
        if vals.get("iata_code") and not vals.get("airline_code"):
            vals["airline_code"] = vals["iata_code"]
        if vals.get("airline_code") and not vals.get("iata_code"):
            vals["iata_code"] = vals["airline_code"]
        if vals.get("accounting_code") and not vals.get("airline_num"):
            vals["airline_num"] = vals["accounting_code"]
        if vals.get("airline_num") and not vals.get("accounting_code"):
            vals["accounting_code"] = vals["airline_num"]
        for key in ("airline_code", "iata_code", "icao_code"):
            if vals.get(key):
                vals[key] = vals[key].strip().upper()
        for key in ("airline_num", "accounting_code"):
            if vals.get(key):
                vals[key] = "".join(ch for ch in str(vals[key]) if ch.isdigit()).zfill(3)
        return vals

    @api.model_create_multi
    def create(self, vals_list):
        return super().create([self._normalize_values(vals) for vals in vals_list])

    def write(self, vals):
        return super().write(self._normalize_values(vals))

    @api.constrains("airline_code", "airline_num", "iata_code", "accounting_code", "icao_code")
    def _check_codes(self):
        for airline in self:
            iata = airline.iata_code or airline.airline_code
            accounting = airline.accounting_code or airline.airline_num
            if iata and not re.fullmatch(r"[A-Z0-9]{2}", iata.upper()):
                raise ValidationError(_("IATA code must contain exactly two letters or numbers."))
            if not re.fullmatch(r"\d{3}", accounting or ""):
                raise ValidationError(_("Ticketing code must contain exactly three digits."))
            if airline.icao_code and not re.fullmatch(r"[A-Z0-9]{3}", airline.icao_code.upper()):
                raise ValidationError(_("ICAO code must contain exactly three letters or numbers."))
            if airline.airline_code and airline.iata_code and airline.airline_code != airline.iata_code:
                raise ValidationError(_("Airline Code and IATA Code must match."))
            if airline.airline_num and airline.accounting_code and airline.airline_num != airline.accounting_code:
                raise ValidationError(_("Airline Number and Ticketing Code must match."))

    @api.depends("name", "airline_code", "airline_num", "iata_code", "accounting_code")
    def _compute_display_name(self):
        for airline in self:
            codes = " / ".join(filter(None, [airline.iata_code or airline.airline_code, airline.accounting_code or airline.airline_num]))
            airline.display_name = "[%s] %s" % (codes, airline.name) if codes else airline.name

    @api.model
    def name_search(self, name="", domain=None, operator="ilike", limit=100):
        domain = Domain(domain or Domain.TRUE)
        if not name:
            return super().name_search(name=name, domain=domain, operator=operator, limit=limit)
        code = name.strip().upper()
        match_domain = Domain.OR([
            Domain("name", operator, name),
            Domain("airline_code", operator, code),
            Domain("iata_code", operator, code),
            Domain("airline_num", operator, code),
            Domain("accounting_code", operator, code),
            Domain("icao_code", operator, code),
        ])
        records = self.search(domain & match_domain, limit=limit)
        return [(record.id, record.display_name) for record in records]
