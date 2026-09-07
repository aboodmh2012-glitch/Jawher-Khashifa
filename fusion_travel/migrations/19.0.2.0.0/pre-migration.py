"""Prepare legacy Fusion Travel tables before the 19.0.2 schema update."""

import logging

_logger = logging.getLogger(__name__)


def _table_exists(cr, table):
    cr.execute("SELECT to_regclass(%s)", (table,))
    return bool(cr.fetchone()[0])


def _column_exists(cr, table, column):
    cr.execute(
        """
        SELECT 1
          FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = %s
           AND column_name = %s
        """,
        (table, column),
    )
    return bool(cr.fetchone())


def migrate(cr, version):
    ticket_table = "fusion_travel_flight_ticket"
    airline_table = "fusion_travel_airline"

    if _table_exists(cr, ticket_table):
        if not _column_exists(cr, ticket_table, "company_id"):
            cr.execute(f"ALTER TABLE {ticket_table} ADD COLUMN company_id integer")
        # Prefer the company of an already-linked accounting document, then
        # the creator's current company. Only use the first company as a last
        # resort for genuinely untraceable legacy records.
        if _table_exists(cr, 'fusion_travel_ticket_move_rel'):
            cr.execute(
                f"""
                UPDATE {ticket_table} AS ticket
                   SET company_id = source.company_id
                  FROM (
                        SELECT rel.ticket_id, MIN(move.company_id) AS company_id
                          FROM fusion_travel_ticket_move_rel AS rel
                          JOIN account_move AS move ON move.id = rel.move_id
                         GROUP BY rel.ticket_id
                        HAVING COUNT(DISTINCT move.company_id) = 1
                       ) AS source
                 WHERE ticket.id = source.ticket_id
                   AND ticket.company_id IS NULL
                """
            )
        if _column_exists(cr, ticket_table, 'create_uid'):
            cr.execute(
                f"""
                UPDATE {ticket_table} AS ticket
                   SET company_id = usr.company_id
                  FROM res_users AS usr
                 WHERE usr.id = ticket.create_uid
                   AND ticket.company_id IS NULL
                """
            )
        cr.execute(
            f"""
            UPDATE {ticket_table}
               SET company_id = company.id
              FROM (SELECT id FROM res_company ORDER BY id LIMIT 1) AS company
             WHERE company_id IS NULL
            """
        )

        if not _column_exists(cr, ticket_table, "operation_type"):
            cr.execute(f"ALTER TABLE {ticket_table} ADD COLUMN operation_type varchar")
        cr.execute(
            f"""
            UPDATE {ticket_table}
               SET operation_type = CASE item_type
                    WHEN 'EXCHANGE' THEN 'exchange'
                    WHEN 'REFUND' THEN 'refund'
                    WHEN 'VOID' THEN 'void'
                    ELSE 'issue'
               END
             WHERE operation_type IS NULL OR operation_type = ''
            """
        )

        # The unified model requires a readable traveler value.  Preserve the
        # original ticket reference when older records had no traveler name.
        if _column_exists(cr, ticket_table, "traveler_name"):
            cr.execute(
                f"""
                UPDATE {ticket_table}
                   SET traveler_name = COALESCE(NULLIF(ticket_number, ''), 'Unknown Traveler')
                 WHERE traveler_name IS NULL OR traveler_name = ''
                """
            )


    booking_table = "fusion_travel_booking"
    if _table_exists(cr, booking_table):
        if not _column_exists(cr, booking_table, "provider_order_status"):
            cr.execute(
                f"ALTER TABLE {booking_table} ADD COLUMN provider_order_status varchar"
            )
        # Existing reservations with a provider reference must never be treated
        # as safe to submit again after the upgrade. Failed records are placed in
        # manual review when their outcome cannot be inferred confidently.
        if _column_exists(cr, booking_table, "amadeus_reference"):
            cr.execute(
                f"""
                UPDATE {booking_table}
                   SET provider_order_status = 'created'
                 WHERE provider_order_status IS NULL
                   AND amadeus_reference IS NOT NULL
                   AND amadeus_reference <> ''
                """
            )
        if _column_exists(cr, booking_table, "state"):
            cr.execute(
                f"""
                UPDATE {booking_table}
                   SET provider_order_status = 'created'
                 WHERE provider_order_status IS NULL
                   AND state IN ('booked', 'ticketed', 'confirmed')
                """
            )
            cr.execute(
                f"""
                UPDATE {booking_table}
                   SET provider_order_status = 'needs_review'
                 WHERE provider_order_status IS NULL
                   AND state = 'failed'
                """
            )
        cr.execute(
            f"""
            UPDATE {booking_table}
               SET provider_order_status = 'not_started'
             WHERE provider_order_status IS NULL OR provider_order_status = ''
            """
        )

    if _table_exists(cr, airline_table):
        if not _column_exists(cr, airline_table, "iata_code"):
            cr.execute(f"ALTER TABLE {airline_table} ADD COLUMN iata_code varchar")
        if not _column_exists(cr, airline_table, "accounting_code"):
            cr.execute(f"ALTER TABLE {airline_table} ADD COLUMN accounting_code varchar")
        cr.execute(
            f"""
            UPDATE {airline_table}
               SET iata_code = COALESCE(NULLIF(iata_code, ''), airline_code),
                   accounting_code = COALESCE(NULLIF(accounting_code, ''), airline_num)
            """
        )

    _logger.info("Fusion Travel legacy tables prepared for 19.0.2.0.0")
