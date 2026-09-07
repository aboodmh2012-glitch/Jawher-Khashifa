import json
import logging
import threading
import time
from urllib.parse import urljoin

import requests

from odoo import _
from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)

_TOKEN_CACHE = {}
_TOKEN_LOCK = threading.RLock()


class AmadeusSDKClient:
    """Odoo-safe direct REST client for Amadeus Self-Service APIs.

    The historical ``amadeus`` Python SDK repository was archived in July 2026.
    This client therefore uses the documented REST endpoints directly while
    retaining the old wrapper class name so existing service imports remain
    compatible. OAuth tokens are cached only in worker memory and are never
    written to business records or logs.
    """

    def __init__(self, env):
        self.env = env
        self.config = env['ir.config_parameter'].sudo()
        self.environment = self.config.get_param(
            'fusion_travel.amadeus.environment', 'test'
        )
        self.access_mode = self.config.get_param(
            'fusion_travel.amadeus.access_mode', 'self_service'
        )
        self.client_id = self.config.get_param('fusion_travel.amadeus.client_id')
        self.client_secret = self.config.get_param(
            'fusion_travel.amadeus.client_secret'
        )
        self.timeout = self._bounded_timeout(
            self.config.get_param('fusion_travel.amadeus.timeout', 45)
        )
        self.debug_logging = self.config.get_param(
            'fusion_travel.amadeus.debug_logging', 'False'
        ) in ('True', 'true', '1')
        configured_base = (
            self.config.get_param('fusion_travel.amadeus.base_url') or ''
        ).strip()
        default_base = (
            'https://api.amadeus.com'
            if self.environment == 'production'
            else 'https://test.api.amadeus.com'
        )
        self.base_url = (configured_base or default_base).rstrip('/')
        token_override = (
            self.config.get_param('fusion_travel.amadeus.token_url') or ''
        ).strip()
        self.token_url = token_override or '%s/v1/security/oauth2/token' % self.base_url

    def _bounded_timeout(self, raw):
        try:
            value = int(raw or 45)
        except (TypeError, ValueError):
            value = 45
        return min(max(value, 5), 180)

    def _check_configuration(self):
        if not self.client_id or not self.client_secret:
            raise UserError(_(
                'Configure the Amadeus Client ID and Client Secret in '
                'Settings > Fusion Travel.'
            ))
        allowed_schemes = ('https://',) if self.environment == 'production' else ('https://', 'http://')
        if not self.base_url.startswith(allowed_schemes):
            raise UserError(_('The provider base URL must use HTTPS in production.'))
        if not self.token_url.startswith(allowed_schemes):
            raise UserError(_('The OAuth token URL must use HTTPS in production.'))

    def _cache_key(self):
        return (
            self.env.cr.dbname,
            self.env.company.id,
            self.client_id,
            self.token_url,
        )

    def _get_access_token(self):
        self._check_configuration()
        key = self._cache_key()
        now = time.time()
        with _TOKEN_LOCK:
            cached = _TOKEN_CACHE.get(key) or {}
            if cached.get('token') and cached.get('expires_at', 0) > now + 60:
                return cached['token']

            try:
                response = requests.post(
                    self.token_url,
                    data={
                        'grant_type': 'client_credentials',
                        'client_id': self.client_id,
                        'client_secret': self.client_secret,
                    },
                    headers={
                        'Accept': 'application/json',
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                _logger.exception('Amadeus OAuth request failed')
                raise UserError(_(
                    'The travel provider authentication service could not be reached.'
                )) from exc

            payload = self._response_payload(response)
            if not response.ok or not isinstance(payload, dict) or not payload.get('access_token'):
                message = self._safe_error_message(payload)
                _logger.warning(
                    'Amadeus OAuth failed with HTTP %s: %s',
                    response.status_code,
                    message,
                )
                raise UserError(_(
                    'Travel provider authentication failed. Check the API credentials and environment.'
                ))

            expires_in = payload.get('expires_in') or 1800
            try:
                expires_in = max(int(expires_in), 60)
            except (TypeError, ValueError):
                expires_in = 1800
            _TOKEN_CACHE[key] = {
                'token': payload['access_token'],
                'expires_at': now + expires_in,
            }
            return payload['access_token']

    def get(self, api_name, path, params=None, booking=None, request_payload=None):
        return self._request(
            'GET', api_name, path, params=params, booking=booking,
            request_payload=request_payload if request_payload is not None else params,
        )

    def post(self, api_name, path, body, params=None, booking=None, request_payload=None):
        return self._request(
            'POST', api_name, path, params=params, json_body=body, booking=booking,
            request_payload=request_payload if request_payload is not None else body,
        )

    def delete(self, api_name, path, params=None, booking=None, request_payload=None):
        return self._request(
            'DELETE', api_name, path, params=params, booking=booking,
            request_payload=request_payload if request_payload is not None else params,
        )

    def _request(
        self,
        method,
        api_name,
        path,
        params=None,
        json_body=None,
        booking=None,
        request_payload=None,
    ):
        token = self._get_access_token()
        if not path or not str(path).startswith('/'):
            raise UserError(_('Provider API paths must start with /.'))
        url = urljoin('%s/' % self.base_url, str(path).lstrip('/'))
        headers = {
            'Authorization': 'Bearer %s' % token,
            'Accept': 'application/vnd.amadeus+json, application/json',
            'User-Agent': 'odoo-fusion-travel/19.0.2.4.0',
        }
        if json_body is not None:
            headers['Content-Type'] = 'application/vnd.amadeus+json'

        try:
            response = requests.request(
                method,
                url,
                params=params or None,
                json=json_body,
                headers=headers,
                timeout=self.timeout,
            )
            payload = self._response_payload(response)
        except requests.Timeout as exc:
            self._log_api(
                api_name=api_name,
                endpoint='%s %s' % (method, path),
                request_payload=request_payload,
                response_payload={},
                status='failed',
                http_status=0,
                error_message='Provider request timed out after %s seconds.' % self.timeout,
                booking=booking,
            )
            raise UserError(_(
                'The provider request timed out. Its external outcome may be uncertain; '
                'review the booking before retrying.'
            )) from exc
        except requests.RequestException as exc:
            self._log_api(
                api_name=api_name,
                endpoint='%s %s' % (method, path),
                request_payload=request_payload,
                response_payload={},
                status='failed',
                http_status=0,
                error_message=str(exc)[:500],
                booking=booking,
            )
            _logger.exception('Amadeus REST request failed')
            raise UserError(_(
                'The travel provider could not be reached. Review API logs and connectivity.'
            )) from exc

        if response.ok:
            self._log_api(
                api_name=api_name,
                endpoint='%s %s' % (method, path),
                request_payload=request_payload,
                response_payload=payload,
                status='success',
                http_status=response.status_code,
                booking=booking,
            )
            return payload

        message = self._safe_error_message(payload)
        self._log_api(
            api_name=api_name,
            endpoint='%s %s' % (method, path),
            request_payload=request_payload,
            response_payload=payload,
            status='failed',
            http_status=response.status_code,
            error_message=message,
            booking=booking,
        )
        _logger.warning(
            'Amadeus REST call %s %s failed with HTTP %s: %s',
            method,
            path,
            response.status_code,
            message,
        )
        raise UserError(_(
            'The travel provider rejected the request. Check Fusion Travel > API Logs.'
        ))

    def _response_payload(self, response):
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError:
            return {'raw': response.text[:2000]}

    def _safe_error_message(self, payload):
        if isinstance(payload, dict):
            errors = payload.get('errors') or []
            if errors and isinstance(errors, list):
                first = errors[0] or {}
                return '%s: %s' % (
                    first.get('code') or first.get('status') or 'Amadeus',
                    first.get('title') or first.get('detail') or 'API error',
                )
            return str(
                payload.get('error_description')
                or payload.get('error')
                or payload.get('message')
                or 'Amadeus API error'
            )[:500]
        return str(payload)[:500]

    def _redact_payload(self, value):
        sensitive_keys = {
            'access_token', 'client_secret', 'clientsecret', 'authorization',
            'cardnumber', 'card_number', 'securitycode', 'security_code',
            'cvv', 'cryptogram', 'paymenttoken', 'payment_token',
        }
        if isinstance(value, dict):
            result = {}
            for key, item in value.items():
                normalized = str(key).replace('-', '_').lower()
                result[key] = '[REDACTED]' if normalized in sensitive_keys else self._redact_payload(item)
            return result
        if isinstance(value, list):
            return [self._redact_payload(item) for item in value]
        return value

    def _log_api(
        self,
        api_name,
        endpoint,
        request_payload,
        response_payload,
        status,
        http_status=0,
        error_message='',
        booking=None,
    ):
        request_text = ''
        response_text = ''
        if self.debug_logging:
            request_text = json.dumps(
                self._redact_payload(request_payload or {}), ensure_ascii=False, default=str
            )[:10000]
            response_text = json.dumps(
                self._redact_payload(response_payload or {}), ensure_ascii=False, default=str
            )[:10000]
        self.env['fusion.travel.api.log'].sudo().create({
            'api_name': api_name,
            'company_id': self.env.company.id,
            'endpoint': endpoint,
            'environment': self.environment,
            'access_mode': self.access_mode,
            'request_payload': request_text,
            'response_payload': response_text,
            'status': status,
            'http_status': http_status or 0,
            'error_message': error_message or '',
            'booking_id': booking.id if booking else False,
        })
