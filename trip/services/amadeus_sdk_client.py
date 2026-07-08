import json
import logging

from odoo.exceptions import UserError

try:
    from amadeus import Client, ResponseError
except ImportError:  # pragma: no cover - handled at runtime in Odoo
    Client = None
    ResponseError = Exception

_logger = logging.getLogger(__name__)


class AmadeusSDKClient:
    """Thin Odoo wrapper around the official Amadeus Python SDK.

    The SDK maps Amadeus API paths to Python resources and handles OAuth token
    creation/refresh internally. This wrapper centralizes Odoo settings,
    safe logging, and user-friendly errors.
    """

    def __init__(self, env):
        self.env = env
        self.config = env['ir.config_parameter'].sudo()
        self.environment = self.config.get_param('trip.amadeus.environment', 'test')
        self.access_mode = self.config.get_param('trip.amadeus.access_mode', 'self_service')
        self.client_id = self.config.get_param('trip.amadeus.client_id')
        self.client_secret = self.config.get_param('trip.amadeus.client_secret')
        self.timeout = int(self.config.get_param('trip.amadeus.timeout', 45) or 45)
        self.debug_logging = self.config.get_param('trip.amadeus.debug_logging', 'False') in ('True', 'true', '1')
        self.base_url = (self.config.get_param('trip.amadeus.base_url') or '').strip() or None
        self._client = None

    def get_client(self):
        if Client is None:
            raise UserError('The Amadeus Python SDK is not installed. Run: pip install -r trip/requirements.txt')
        if not self.client_id or not self.client_secret:
            raise UserError('Configure Amadeus Client ID and Client Secret in Settings > Trip.')
        if self._client:
            return self._client

        kwargs = {
            'client_id': self.client_id,
            'client_secret': self.client_secret,
            'hostname': 'production' if self.environment == 'production' else 'test',
        }
        # Keep this optional. Official Self-Service normally uses hostname only.
        # Some Enterprise/aggregator setups may supply a compatible base URL.
        kwargs['custom_app_id'] = 'odoo-trip'
        kwargs['custom_app_version'] = '1.6.2'
        if self.base_url:
            # SDK expects a host/domain value here, not a full API path.
            kwargs['host'] = self.base_url.replace('https://', '').replace('http://', '').strip('/')
        self._client = Client(**kwargs)
        return self._client

    def _endpoint_from_resource(self, resource, method_name):
        try:
            parts = []
            current = resource
            while current is not None:
                name = getattr(current, 'name', None)
                if name:
                    parts.append(str(name))
                current = getattr(current, 'parent', None)
            if parts:
                return '%s %s' % (method_name.upper(), '/'.join(reversed(parts)))
        except Exception:  # noqa: BLE001
            pass
        return method_name.upper()

    def call(self, api_name, resource, method_name='get', *args, booking=None, request_payload=None, **kwargs):
        try:
            method = getattr(resource, method_name)
            response = method(*args, **kwargs)
            result = response.result if hasattr(response, 'result') else response
            self._log_api(
                api_name=api_name,
                endpoint=self._endpoint_from_resource(resource, method_name),
                request_payload=request_payload if request_payload is not None else {'args': args, 'kwargs': kwargs},
                response_payload=result,
                status='success',
                http_status=getattr(response, 'status_code', 200) or 200,
                booking=booking,
            )
            return result
        except ResponseError as exc:
            error_payload = self._extract_error_payload(exc)
            self._log_api(
                api_name=api_name,
                endpoint=self._endpoint_from_resource(resource, method_name),
                request_payload=request_payload if request_payload is not None else {'args': args, 'kwargs': kwargs},
                response_payload=error_payload,
                status='failed',
                http_status=getattr(getattr(exc, 'response', None), 'status_code', 0) or 0,
                error_message=self._safe_error_message(error_payload),
                booking=booking,
            )
            _logger.warning('Amadeus SDK call failed: %s', error_payload)
            raise UserError('Amadeus API request failed. Check Trip > API Logs for details.') from exc
        except Exception as exc:  # noqa: BLE001
            _logger.exception('Amadeus SDK call crashed')
            self._log_api(
                api_name=api_name,
                endpoint=self._endpoint_from_resource(resource, method_name),
                request_payload=request_payload if request_payload is not None else {'args': args, 'kwargs': kwargs},
                response_payload={},
                status='failed',
                http_status=0,
                error_message=str(exc)[:500],
                booking=booking,
            )
            raise UserError('Amadeus SDK request failed. Check configuration and server logs.') from exc

    def _extract_error_payload(self, exc):
        response = getattr(exc, 'response', None)
        if response is None:
            return {'error': str(exc)}
        if hasattr(response, 'result') and response.result:
            return response.result
        body = getattr(response, 'body', None)
        if body:
            try:
                return json.loads(body)
            except Exception:  # noqa: BLE001
                return {'error': body}
        return {'error': str(exc)}

    def _safe_error_message(self, payload):
        if self.debug_logging:
            return json.dumps(payload, ensure_ascii=False, default=str)[:2000]
        if isinstance(payload, dict):
            errors = payload.get('errors') or []
            if errors and isinstance(errors, list):
                first = errors[0] or {}
                return '%s: %s' % (first.get('code') or first.get('status') or 'Amadeus', first.get('title') or first.get('detail') or 'API error')
            return str(payload.get('error') or payload.get('message') or 'Amadeus API error')[:500]
        return str(payload)[:500]

    def _log_api(self, api_name, endpoint, request_payload, response_payload, status, http_status=0, error_message='', booking=None):
        request_text = ''
        response_text = ''
        if self.debug_logging:
            request_text = json.dumps(request_payload or {}, ensure_ascii=False, default=str)[:10000]
            response_text = json.dumps(response_payload or {}, ensure_ascii=False, default=str)[:10000]
        self.env['trip.api.log'].sudo().create({
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
