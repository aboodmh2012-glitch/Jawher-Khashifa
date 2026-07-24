from odoo import http, _
from odoo.addons.portal.controllers.portal import CustomerPortal, pager as portal_pager
from odoo.http import request


class FusionTravelPortalController(CustomerPortal):
    def _prepare_home_portal_values(self, counters):
        values = super()._prepare_home_portal_values(counters)
        if 'fusion_travel_booking_count' in counters:
            values['fusion_travel_booking_count'] = request.env['fusion.travel.booking'].search_count([
                ('partner_id', '=', request.env.user.partner_id.id)
            ])
        return values

    @http.route('/my/travel/bookings', type='http', auth='user', website=True)
    def my_trip_bookings(self, page=1, **kwargs):
        domain = [('partner_id', '=', request.env.user.partner_id.id)]
        booking_env = request.env['fusion.travel.booking']
        total = booking_env.search_count(domain)
        pager = portal_pager(
            url='/my/travel/bookings',
            total=total,
            page=page,
            step=20,
        )
        bookings = booking_env.search(domain, order='id desc', limit=20, offset=pager['offset'])
        return request.render('fusion_travel.portal_my_trip_bookings', {
            'bookings': bookings,
            'page_name': 'fusion_travel_bookings',
            'pager': pager,
        })

    @http.route('/my/travel/booking/<int:booking_id>', type='http', auth='user', website=True)
    def my_trip_booking_detail(self, booking_id, **kwargs):
        booking = request.env['fusion.travel.booking'].search([
            ('id', '=', booking_id),
            ('partner_id', '=', request.env.user.partner_id.id),
        ], limit=1)
        if not booking:
            return request.redirect('/my')
        return request.render('fusion_travel.portal_my_trip_booking_detail', {
            'booking': booking,
            'page_name': 'fusion_travel_bookings',
        })
