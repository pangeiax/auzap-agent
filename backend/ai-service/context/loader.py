from db import get_connection


async def load_context(company_id: int, client_phone: str) -> dict:
    with get_connection() as conn:
        cur = conn.cursor()

        cur.execute(
            """
            SELECT
                c.id            AS company_id,
                c.name          AS company_name,
                c.plan,
                p.assistant_name,
                p.phone         AS petshop_phone,
                p.address       AS petshop_address,
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

        cur.execute(
            """
            SELECT id, name, description, duration_min, price, price_by_size, duration_multiplier_large
            FROM petshop_services
            WHERE company_id = %s AND is_active = TRUE
            ORDER BY name
        """,
            (company_id,),
        )
        services = cur.fetchall()

        cur.execute(
            """
            SELECT id, name, phone, conversation_stage, ai_paused, kanban_column
            FROM clients
            WHERE company_id = %s AND phone = %s
        """,
            (company_id, client_phone),
        )
        client = cur.fetchone()

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

        return {
            "company_id": company["company_id"],
            "company_name": company["company_name"],
            "assistant_name": company["assistant_name"] or "Assistente",
            "petshop_phone": company["petshop_phone"],
            "petshop_address": company["petshop_address"],
            "business_hours": company["business_hours"] or {},
            "default_capacity_per_hour": company["default_capacity_per_hour"],
            "features": company["features"] or {},
            "services": [dict(s) for s in services],
            "client": dict(client) if client else None,
            "pets": [dict(p) for p in pets],
        }
