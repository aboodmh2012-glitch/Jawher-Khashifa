from odoo import http, _
from odoo.addons.portal.controllers.portal import CustomerPortal, pager as portal_pager
from odoo.http import request


class TripPortalController(CustomerPortal):
    def _prepare_home_portal_values(self, counters):
        values = super()._prepare_home_portal_values(counters)
        if 'trip_booking_count' in counters:
            values['trip_booking_count'] = request.env['trip.booking'].search_count([
                ('partner_id', '=', request.env.user.partner_id.id)
            ])
        return values

    @http.route('/my/trip/bookings', type='http', auth='user', website=True)
    def my_trip_bookings(self, page=1, **kwargs):
        domain = [('partner_id', '=', request.env.user.partner_id.id)]
        booking_env = request.env['trip.booking']
        total = booking_env.search_count(domain)
        pager = portal_pager(
            url='/my/trip/bookings',
            total=total,
            page=page,
            step=20,
        )
        bookings = booking_env.search(domain, order='id desc', limit=20, offset=pager['offset'])
        return request.render('trip.portal_my_trip_bookings', {
            'bookings': bookings,
            'page_name': 'trip_bookings',
            'pager': pager,
        })

    @http.route('/my/trip/booking/<int:booking_id>', type='http', auth='user', website=True)
    def my_trip_booking_detail(self, booking_id, **kwargs):
        booking = request.env['trip.booking'].search([
            ('id', '=', booking_id),
            ('partner_id', '=', request.env.user.partner_id.id),
        ], limit=1)
        if not booking:
            return request.redirect('/my')
        return request.render('trip.portal_my_trip_booking_detail', {
            'booking': booking,
            'page_name': 'trip_bookings',
        })
