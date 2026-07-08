import json
import logging
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from odoo.exceptions import UserError

_logger = logging.getLogger(__name__)


class AmadeusClient:
    """HTTP client for Amadeus-compatible travel APIs.

    Supports Amadeus Enterprise, a travel API aggregator, and legacy Self-Service
    credentials through configurable base/token URLs.
    """

    def __init__(self, env):
        self.env = env
        self.config = env['ir.config_parameter'].sudo()
        self.access_mode = self.config.get_param('trip.amadeus.access_mode', 'enterprise')
        self.environment = self.config.get_param('trip.amadeus.environment', 'test')
        self.client_id = self.config.get_param('trip.amadeus.client_id')
        self.client_secret = self.config.get_param('trip.amadeus.client_secret')
        self.timeout = int(self.config.get_param('trip.amadeus.timeout', 45) or 45)
        self.debug_logging = self.config.get_param('trip.amadeus.debug_logging', 'False') in ('True', 'true', '1')
        self.base_url = self._get_base_url().rstrip('/')
        self.token_url = self._get_token_url()
        self.session = self._make_session()

    def _make_session(self):
        retry = Retry(
            total=3,
            connect=3,
            read=3,
            status=3,
            backoff_factor=0.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry)
        session = requests.Session()
        session.mount('https://', adapter)
        session.mount('http://', adapter)
        return session

    def _get_base_url(self):
        override = self.config.get_param('trip.amadeus.base_url')
        if override:
            return override
        return 'https://api.amadeus.com' if self.environment == 'production' else 'https://test.api.amadeus.com'

    def _get_token_url(self):
        override = self.config.get_param('trip.amadeus.token_url')
        if override:
            return override
        return f'{self.base_url}/v1/security/oauth2/token'

    def _cache_key(self, suffix):
        return f'trip.amadeus.{self.environment}.{self.access_mode}.{suffix}'

    def get_token(self):
        if not self.client_id or not self.client_secret:
            raise UserError('Configure the travel API Client ID and Client Secret in Settings > Trip.')

        now = int(time.time())
        cached_token = self.config.get_param(self._cache_key('access_token'))
        cached_expiry = int(self.config.get_param(self._cache_key('access_token_expiry'), 0) or 0)
        if cached_token and cached_expiry > now + 60:
            return cached_token

        try:
            response = self.session.post(self.token_url, data={
                'grant_type': 'client_credentials',
                'client_id': self.client_id,
                'client_secret': self.client_secret,
            }, timeout=self.timeout)
        except requests.RequestException as exc:
            _logger.exception('Travel API authentication network error')
            raise UserError('Travel API authentication failed. Please try again later.') from exc

        if not response.ok:
            self._log_api('OAuth Token', self.token_url, None, None, response, None)
            raise UserError('Travel API authentication failed. Check credentials, environment, and token URL.')

        try:
            data = response.json()
        except ValueError as exc:
            raise UserError('Travel API authentication returned an invalid response.') from exc

        token = data.get('access_token')
        expires_in = int(data.get('expires_in') or 1800)
        if not token:
            raise UserError('Travel API did not return an access token.')

        self.config.set_param(self._cache_key('access_token'), token)
        self.config.set_param(self._cache_key('access_token_expiry'), now + expires_in)
        return token

    def request(self, method, endpoint, params=None, payload=None, booking=None, api_name='Travel API', headers=None):
        token = self.get_token()
        url = endpoint if endpoint.startswith('http') else f'{self.base_url}{endpoint}'
        request_headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }
        if headers:
            request_headers.update(headers)
        try:
            response = self.session.request(
                method, url, headers=request_headers, params=params, json=payload, timeout=self.timeout
            )
        except requests.RequestException as exc:
            _logger.exception('Travel API network error: %s %s', method, url)
            raise UserError('Travel API request failed. Please try again later.') from exc

        self._log_api(api_name, url, params, payload, response, booking)
        if not response.ok:
            _logger.warning('Travel API failed: %s %s -> %s', method, url, response.status_code)
            raise UserError('Travel API request failed. Check the API log for details.')
        try:
            return response.json() if response.content else {}
        except ValueError as exc:
            raise UserError('Travel API returned an invalid JSON response.') from exc

    def _log_api(self, api_name, url, params, payload, response, booking=None):
        request_payload = ''
        response_payload = ''
        if self.debug_logging:
            request_payload = json.dumps({'params': params, 'payload': payload}, default=str)
            response_payload = response.text
        self.env['trip.api.log'].sudo().create({
            'api_name': api_name,
            'company_id': self.env.company.id,
            'endpoint': url,
            'environment': self.environment,
            'access_mode': self.access_mode,
            'request_payload': request_payload,
            'response_payload': response_payload,
            'status': 'success' if response.ok else 'failed',
            'http_status': response.status_code,
            'error_message': '' if response.ok else self._safe_error_message(response),
            'booking_id': booking.id if booking else False,
        })

    def _safe_error_message(self, response):
        if self.debug_logging:
            return (response.text or '')[:2000]
        status = response.status_code or 0
        try:
            data = response.json()
        except ValueError:
            data = {}
        if isinstance(data, dict):
            errors = data.get('errors') or []
            if errors and isinstance(errors, list):
                first = errors[0] or {}
                code = first.get('code') or first.get('status') or status
                title = first.get('title') or first.get('detail') or 'Travel API error'
                return f'{code}: {title}'[:500]
            message = data.get('message') or data.get('error_description') or data.get('error')
            if message:
                return f'{status}: {message}'[:500]
        return f'Travel API error. HTTP status: {status}'
