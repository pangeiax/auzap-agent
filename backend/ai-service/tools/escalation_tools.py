import logging
import redis as sync_redis
from db import get_connection
from config import REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

logger = logging.getLogger("ai-service.tools.escalation")


def build_escalation_tools(company_id: int, client_id: str) -> list:
    """
    Retorna as tools de escalonamento com company_id e client_id pré-vinculados via closure.
    A LLM nunca recebe os IDs como parâmetro.
    """

    def escalate_to_human(summary: str, last_message: str) -> dict:
        """
        Pausa a IA e registra escalonamento para a equipe humana.

        Use quando: pedido explícito de humano/atendente; B2B/spam; ou assunto claramente fora do escopo
        do petshop (produtos/serviços não relacionados a pets, roleplay tipo «sou pintor», bicicletas,
        construção, papo aleatório sem vínculo com serviços da loja).
        Também: cliente **aceitou** encaminhamento humano depois de dizer que **já fez** o pré-requisito e
        quer o serviço **block_ai_schedule** (fluxo SERVIÇOS BLOQUEADOS — booking/health).

        Não use para: apenas «oi»/«olá»/«obrigado» isolados sem outro tema (responda curto e pergunte se pode ajudar com petshop).
        """
        if not summary or not summary.strip():
            return {"success": False, "message": "summary é obrigatório para o escalonamento."}
        if not last_message or not last_message.strip():
            return {"success": False, "message": "last_message é obrigatório para o escalonamento."}
        if not client_id or not str(client_id).strip():
            return {"success": False, "message": "client_id não identificado. Não é possível escalar."}

        logger.info("escalate_to_human | client_id=%s | summary=%.100r", client_id, summary)

        with get_connection() as conn:
            cur = conn.cursor()

            # 1. Pausa a IA para este cliente
            cur.execute(
                """
                UPDATE clients
                SET ai_paused = TRUE,
                    ai_paused_at = NOW(),
                    ai_pause_reason = %s
                WHERE id = %s AND company_id = %s
                RETURNING id, name, phone
                """,
                (
                    f"[ESCALONAMENTO] {summary} | Última msg: {last_message}",
                    client_id,
                    company_id,
                ),
            )
            updated = cur.fetchone()
            if not updated:
                return {"success": False, "message": "Cliente não encontrado."}

            client_name = updated["name"] or "Cliente"
            client_phone = updated["phone"]

            # 2. Busca o telefone do dono do petshop (tabela renomeada de saas_petshops → petshop_profile)
            cur.execute(
                "SELECT owner_phone FROM petshop_profile WHERE company_id = %s",
                (company_id,),
            )
            petshop_row = cur.fetchone()
            owner_phone = petshop_row["owner_phone"] if petshop_row else None

        # 3. Limpa o histórico Redis para a IA retornar do zero
        _clear_redis_history(company_id, client_phone)

        return {
            "success": True,
            "message": "Cliente encaminhado. IA pausada.",
            "summary": summary,
        }

    return [escalate_to_human]


def _clear_redis_history(company_id: int, client_phone: str) -> None:
    """Remove o histórico Redis do cliente para que a IA recomece do zero."""
    try:
        r = sync_redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
        )
        key = f"chat:{company_id}:{client_phone}"
        r.delete(key)
        r.close()
        logger.info("escalate_to_human | histórico Redis limpo | key=%s", key)
    except Exception as e:
        logger.warning("escalate_to_human | falha ao limpar Redis: %s", e)


