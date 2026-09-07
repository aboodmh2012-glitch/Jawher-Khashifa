import json
import secrets
from datetime import timedelta

from odoo import api, fields, models, _
from odoo.exceptions import ValidationError


class FusionTravelSearchSession(models.Model):
    _name = "fusion.travel.search.session"
    _description = "Fusion Travel Search Session"
    _order = "id desc"

    @api.model
    def _default_expires_at(self):
        raw = self.env['ir.config_parameter'].sudo().get_param(
            'fusion_travel.offer_ttl_minutes', '20'
        )
        try:
            minutes = min(max(int(raw or 20), 5), 240)
        except (TypeError, ValueError):
            minutes = 20
        return fields.Datetime.now() + timedelta(minutes=minutes + 10)

    token = fields.Char(required=True, copy=False, default=lambda self: secrets.token_urlsafe(24), index=True)
    service_type = fields.Selection([("flight", "Flight"), ("hotel", "Hotel"), ("car", "Car / Transfer")], required=True, index=True)
    search_json = fields.Text(required=True)
    company_id = fields.Many2one("res.company", required=True, default=lambda self: self.env.company, index=True)
    partner_id = fields.Many2one("res.partner", index=True)
    expires_at = fields.Datetime(required=True, default=_default_expires_at, index=True)
    offer_ids = fields.One2many("fusion.travel.offer", "session_id")

    _sql_constraints = [("search_session_token_unique", "unique(token)", "Search session token must be unique.")]

    @api.model
    def _create_from_values(self, service_type, values, partner=False):
        return self.sudo().create({
            "service_type": service_type,
            "search_json": json.dumps(values or {}, ensure_ascii=False, default=str),
            "partner_id": partner.id if partner else False,
            "company_id": self.env.company.id,
        })

    def _get_search_values(self):
        self.ensure_one()
        if self.expires_at and self.expires_at < fields.Datetime.now():
            raise ValidationError(_("This search has expired. Please search again."))
        try:
            return json.loads(self.search_json or "{}")
        except (TypeError, ValueError) as exc:
            raise ValidationError(_("Stored search data is invalid.")) from exc


    @api.model
    def _cron_cleanup_expired(self):
        expired = self.sudo().search([('expires_at', '<', fields.Datetime.now())], limit=5000)
        if expired:
            expired.unlink()
        return True


class FusionTravelOffer(models.Model):
    _name = "fusion.travel.offer"
    _description = "Fusion Travel Provider Offer"
    _order = "id asc"

    @api.model
    def _default_expires_at(self):
        raw = self.env['ir.config_parameter'].sudo().get_param(
            'fusion_travel.offer_ttl_minutes', '20'
        )
        try:
            minutes = min(max(int(raw or 20), 5), 240)
        except (TypeError, ValueError):
            minutes = 20
        return fields.Datetime.now() + timedelta(minutes=minutes)

    token = fields.Char(required=True, copy=False, default=lambda self: secrets.token_urlsafe(32), index=True)
    session_id = fields.Many2one("fusion.travel.search.session", required=True, ondelete="cascade", index=True)
    service_type = fields.Selection(related="session_id.service_type", store=True, index=True)
    company_id = fields.Many2one(related="session_id.company_id", store=True, index=True)
    provider = fields.Char(default="amadeus")
    provider_offer_id = fields.Char(index=True)
    offer_json = fields.Text(required=True)
    currency_id = fields.Many2one("res.currency")
    amount = fields.Monetary(currency_field="currency_id")
    expires_at = fields.Datetime(required=True, default=_default_expires_at, index=True)
    consumed = fields.Boolean(default=False, index=True)

    _sql_constraints = [("offer_token_unique", "unique(token)", "Offer token must be unique.")]

    @api.model
    def _store_offer(self, session, offer, amount=0.0, currency=False, provider="amadeus"):
        provider_offer_id = (offer or {}).get("id") if isinstance(offer, dict) else False
        return self.sudo().create({
            "session_id": session.id,
            "provider": provider,
            "provider_offer_id": provider_offer_id,
            "offer_json": json.dumps(offer or {}, ensure_ascii=False, default=str),
            "currency_id": currency.id if currency else False,
            "amount": amount or 0.0,
        })

    def _read_offer(self, consume=False):
        self.ensure_one()
        now = fields.Datetime.now()
        if consume:
            # Claim the short-lived offer atomically. The website controller wraps
            # claim + booking creation in a database savepoint, so failures release
            # the claim rather than leaving the customer with a consumed offer.
            self.env.cr.execute(
                """
                UPDATE fusion_travel_offer
                   SET consumed = TRUE,
                       write_uid = %s,
                       write_date = NOW() AT TIME ZONE 'UTC'
                 WHERE id = %s
                   AND consumed = FALSE
                   AND (expires_at IS NULL OR expires_at >= %s)
                RETURNING id
                """,
                (self.env.uid, self.id, now),
            )
            if not self.env.cr.fetchone():
                self.invalidate_recordset(["consumed", "expires_at"])
                if self.expires_at and self.expires_at < now:
                    raise ValidationError(_("This offer has expired. Please search again."))
                raise ValidationError(_("This offer has already been selected."))
            self.invalidate_recordset(["consumed", "write_date", "write_uid"])
        else:
            if self.expires_at and self.expires_at < now:
                raise ValidationError(_("This offer has expired. Please search again."))
            if self.consumed:
                raise ValidationError(_("This offer has already been selected."))
        try:
            return json.loads(self.offer_json or "{}")
        except (TypeError, ValueError) as exc:
            raise ValidationError(_("Stored offer data is invalid.")) from exc
