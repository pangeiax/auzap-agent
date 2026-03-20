from db import get_connection

BH_DAY_KEYS = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
]


def _business_hours_from_rows(rows: list) -> dict:
    """Monta dict legível para prompts a partir de petshop_business_hours."""
    by_dow = {int(r["day_of_week"]): r for r in rows}
    out: dict = {}
    for dow in range(7):
        key = BH_DAY_KEYS[dow]
        r = by_dow.get(dow)
        if not r or r.get("is_closed") or not r.get("open_time") or not r.get("close_time"):
            out[key] = "fechado"
        else:
            o = str(r["open_time"])[:5]
            c = str(r["close_time"])[:5]
            out[key] = f"{o}-{c}"
    return out


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
                p.features
            FROM saas_companies c
            JOIN petshop_profile p ON p.company_id = c.id
            WHERE c.id = %s AND c.is_active = TRUE
        """,
            (company_id,),
        )
        company = cur.fetchone()

        if not company:
            raise ValueError(f"Company {company_id} não encontrada ou inativa.")

        cur.execute(
            """
            SELECT day_of_week, open_time, close_time, is_closed
            FROM petshop_business_hours
            WHERE company_id = %s
            """,
            (company_id,),
        )
        bh_rows = cur.fetchall()
        business_hours = _business_hours_from_rows(bh_rows)

        cur.execute(
            """
            SELECT id, name, description, duration_min, price, price_by_size, duration_multiplier_large,
                   specialty_id::text AS specialty_id
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

        # Especialidades ativas
        cur.execute(
            """
            SELECT id, name, description, color
            FROM petshop_specialties
            WHERE company_id = %s AND is_active = TRUE
            ORDER BY name
        """,
            (company_id,),
        )
        specialties = cur.fetchall()

        # Configuração de hospedagem
        cur.execute(
            """
            SELECT hotel_enabled, hotel_daily_rate, hotel_checkin_time, hotel_checkout_time,
                   daycare_enabled, daycare_daily_rate, daycare_checkin_time, daycare_checkout_time
            FROM petshop_lodging_config
            WHERE company_id = %s
        """,
            (company_id,),
        )
        lodging_config = cur.fetchone()

        # Converte datetime.time → "HH:MM" string para evitar erros de subscript
        # em qualquer prompt que faça lodging_config.get("...time")[:5]
        def _fmt_time(t) -> str | None:
            if t is None:
                return None
            # psycopg2 retorna datetime.time; str() dá "HH:MM:SS"
            return str(t)[:5]

        lodging_dict: dict = {}
        if lodging_config:
            lodging_dict = dict(lodging_config)
            for field in (
                "hotel_checkin_time",
                "hotel_checkout_time",
                "daycare_checkin_time",
                "daycare_checkout_time",
            ):
                lodging_dict[field] = _fmt_time(lodging_dict.get(field))

        return {
            "company_id": company["company_id"],
            "company_name": company["company_name"],
            "assistant_name": company["assistant_name"] or "Assistente",
            "petshop_phone": company["petshop_phone"],
            "petshop_address": company["petshop_address"],
            "business_hours": business_hours,
            "features": company["features"] or {},
            "services": [dict(s) for s in services],
            "client": dict(client) if client else None,
            "pets": [dict(p) for p in pets],
            "specialties": [dict(s) for s in specialties],
            "lodging_config": lodging_dict,
        }
