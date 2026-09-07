"""Backfill unified booking/ticket aliases after the 19.0.2 schema update."""

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

    if _table_exists(cr, airline_table):
        cr.execute(
            f"""
            UPDATE {airline_table}
               SET iata_code = COALESCE(NULLIF(iata_code, ''), airline_code),
                   airline_code = COALESCE(NULLIF(airline_code, ''), iata_code),
                   accounting_code = COALESCE(NULLIF(accounting_code, ''), airline_num),
                   airline_num = COALESCE(NULLIF(airline_num, ''), accounting_code)
            """
        )

    if _table_exists(cr, ticket_table):
        if _column_exists(cr, ticket_table, "partner_id"):
            cr.execute(
                f"""
                UPDATE {ticket_table}
                   SET partner_id = agent_id
                 WHERE partner_id IS NULL AND agent_id IS NOT NULL
                """
            )
        if _column_exists(cr, ticket_table, "customer_fare"):
            cr.execute(
                f"""
                UPDATE {ticket_table}
                   SET customer_fare = COALESCE(agent_amount, 0)
                 WHERE COALESCE(customer_fare, 0) = 0
                   AND COALESCE(agent_amount, 0) <> 0
                """
            )
        if _column_exists(cr, ticket_table, "operation_type"):
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

    _logger.info("Fusion Travel 19.0.2.0.0 compatibility backfill completed")
