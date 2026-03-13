import os
import psycopg2
import psycopg2.extras


def get_connection():
    return psycopg2.connect(
        os.getenv("DATABASE_URL"), cursor_factory=psycopg2.extras.RealDictCursor
    )


def get_client(company_id: int, phone: str) -> dict:
    """
    Retorna dados do cliente pelo telefone.
    """
    conn = get_connection()
    cur = conn.cursor()

    try:
        cur.execute(
            """
            SELECT id, name, phone, email, conversation_stage, kanban_column, ai_paused
            FROM clients
            WHERE company_id = %s AND phone = %s
        """,
            (company_id, phone),
        )

        client = cur.fetchone()
        return dict(client) if client else {}

    finally:
        cur.close()
        conn.close()


def get_pets(company_id: int, client_id: str) -> list:
    """
    Retorna todos os pets ativos de um cliente.
    """
    conn = get_connection()
    cur = conn.cursor()

    try:
        cur.execute(
            """
            SELECT id, name, species, breed, size, weight_kg, gender, birth_date
            FROM petshop_pets
            WHERE company_id = %s AND client_id = %s AND is_active = TRUE
            ORDER BY name
        """,
            (company_id, client_id),
        )

        pets = cur.fetchall()
        return [dict(p) for p in pets]

    finally:
        cur.close()
        conn.close()


def get_upcoming_appointments(company_id: int, client_id: str) -> list:
    """
    Retorna os próximos agendamentos do cliente (status pending ou confirmed).
    """
    conn = get_connection()
    cur = conn.cursor()

    try:
        cur.execute(
            """
            SELECT
                a.id,
                a.scheduled_date,
                a.status,
                sch.start_time,
                svc.name AS service_name,
                p.name   AS pet_name
            FROM petshop_appointments a
            JOIN petshop_schedules sch ON sch.id = a.schedule_id
            JOIN petshop_services  svc ON svc.id = a.service_id
            JOIN petshop_pets      p   ON p.id   = a.pet_id
            WHERE a.company_id = %s
              AND a.client_id  = %s
              AND a.status IN ('pending', 'confirmed')
              AND a.scheduled_date >= CURRENT_DATE
            ORDER BY a.scheduled_date, sch.start_time
        """,
            (company_id, client_id),
        )

        rows = cur.fetchall()
        return [dict(r) for r in rows]

    finally:
        cur.close()
        conn.close()
