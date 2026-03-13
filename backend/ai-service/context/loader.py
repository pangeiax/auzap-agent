import os
import psycopg2
import psycopg2.extras
from typing import Optional


def get_connection():
    return psycopg2.connect(
        os.getenv("DATABASE_URL"), cursor_factory=psycopg2.extras.RealDictCursor
    )


async def load_context(company_id: int, client_phone: str) -> dict:
    """
    Carrega tudo que o agente precisa saber antes de responder:
    - dados da company
    - perfil do petshop (nome do assistente, horários, serviços)
    - dados do cliente e seus pets
    """
    conn = get_connection()
    cur = conn.cursor()

    try:
        # ── Company + Petshop ─────────────────────
        cur.execute(
            """
            SELECT
                c.id            AS company_id,
                c.name          AS company_name,
                c.plan,
                p.assistant_name,
                p.phone         AS petshop_phone,
                p.business_hours,
                p.default_capacity_per_hour,
                p.features
            FROM saas_companies c
            JOIN saas_petshops p ON p.company_id = c.id
            WHERE c.id = %s AND c.is_active = TRUE
        """,
            (company_id,),
        )
        company = cur.fetchone()

        if not company:
            raise ValueError(f"Company {company_id} não encontrada ou inativa.")

        # ── Serviços ativos ───────────────────────
        cur.execute(
            """
            SELECT
                id,
                name,
                description,
                duration_min,
                price,
                price_by_size,
                duration_multiplier_large
            FROM petshop_services
            WHERE company_id = %s AND is_active = TRUE
            ORDER BY name
        """,
            (company_id,),
        )
        services = cur.fetchall()

        # ── Cliente ───────────────────────────────
        cur.execute(
            """
            SELECT
                id,
                name,
                phone,
                conversation_stage,
                ai_paused,
                kanban_column
            FROM clients
            WHERE company_id = %s AND phone = %s
        """,
            (company_id, client_phone),
        )
        client = cur.fetchone()

        # ── Pets do cliente ───────────────────────
        pets = []
        if client:
            cur.execute(
                """
                SELECT id, name, species, breed, size, weight_kg, gender
                FROM petshop_pets
                WHERE company_id = %s AND client_id = %s AND is_active = TRUE
            """,
                (company_id, client["id"]),
            )
            pets = cur.fetchall()

        # ── Monta contexto final ──────────────────
        return {
            "company_id": company["company_id"],
            "company_name": company["company_name"],
            "assistant_name": company["assistant_name"] or "Assistente",
            "petshop_phone": company["petshop_phone"],
            "business_hours": company["business_hours"] or {},
            "default_capacity_per_hour": company["default_capacity_per_hour"],
            "features": company["features"] or {},
            "services": [dict(s) for s in services],
            "client": dict(client) if client else None,
            "pets": [dict(p) for p in pets],
        }

    finally:
        cur.close()
        conn.close()
