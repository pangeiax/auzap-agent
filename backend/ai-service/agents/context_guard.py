"""
Camada de guardrails e enxugamento de contexto.
Roda antes e depois do especialista — sem alterar nenhum prompt existente.
Todos os pontos de decisão emitem logs para facilitar debugging.
"""

from __future__ import annotations

import ast
import json
import logging
import re
import unicodedata
from difflib import SequenceMatcher

logger = logging.getLogger("ai-service.context_guard")


# ═══════════════════════════════════════════════════════════════════════════
# PRÉ-PROCESSAMENTO — chamado antes de specialist.run()
# ═══════════════════════════════════════════════════════════════════════════

def apply_guardrails(
    specialist_input: str,
    context: dict,
    router_ctx: dict,
    history: list,
    previous_agent: str | None = None,
    current_user_message: str = "",
) -> str:
    """
    Ponto de entrada dos guardrails de pré-processamento.
    Chame este método com o specialist_input montado e retorne o resultado
    para passar ao specialist.run().
    """
    stage = (router_ctx.get("stage") or "").upper()
    agent = router_ctx.get("agent", "")

    # Guardrail: cadastro de pet
    if stage == "PET_REGISTRATION" and agent == "onboarding_agent":
        specialist_input = _guardrail_pet_registration(
            specialist_input,
            context,
            history,
            router_ctx,
            current_user_message=current_user_message,
        )

    # Guardrail: booking sem pet cadastrado / confirmação pendente
    if agent == "booking_agent":
        specialist_input = _guardrail_booking(
            specialist_input, context, router_ctx, history, current_user_message
        )
        # Mesmo extrator do onboarding: sem pets o booking faz cadastro auxiliar (create_pet)
        # e o mini-modelo se perde se não vir "o que já foi dito" no prompt.
        req = set(router_ctx.get("required_tools") or [])
        if "pets" in req and not (context.get("pets") or []):
            specialist_input = _guardrail_pet_registration(
                specialist_input,
                context,
                history,
                router_ctx,
                current_user_message=current_user_message,
            )

    # Guardrail: hospedagem sem datas
    if agent == "lodging_agent":
        specialist_input = _guardrail_lodging(specialist_input, router_ctx)

    # Guardrail: transição entre agentes
    if previous_agent and previous_agent != agent:
        specialist_input = _guardrail_agent_transition(
            specialist_input, router_ctx, previous_agent, history
        )

    return specialist_input


def _guardrail_pet_registration(
    specialist_input: str,
    context: dict,
    history: list,
    router_ctx: dict,
    current_user_message: str = "",
) -> str:
    """
    Informa ao agente exatamente quais campos do pet ainda faltam.
    Evita que o modelo pergunte o mesmo campo duas vezes.
    """
    collected = _extract_pet_fields_from_history(
        history, router_ctx, current_user_message=current_user_message
    )
    all_fields = ["porte", "nome", "espécie", "raça"]
    missing = [f for f in all_fields if f not in collected]

    logger.info(
        "GUARDRAIL pet_registration | collected=%s | missing=%s",
        list(collected), missing
    )

    if not missing:
        logger.info(
            "GUARDRAIL pet_registration | todos os campos coletados — injeção anti-loop (resumo)"
        )
        lines = [
            "\n\n━━━ GUARDRAIL — CADASTRO DE PET ━━━",
            "Nome, espécie, raça e porte já constam nas mensagens do cliente (ou no foco do roteador).",
            "NÃO peça de novo os quatro dados nem reinicie o cadastro.",
            "Envie **apenas** um resumo numa linha (nome, cachorro/gato, raça, porte) e pergunte se confirma.",
            "Só após 'sim' / confirmação explícita: set_pet_size (se aplicável) e create_pet.",
        ]
        return specialist_input + "\n".join(lines)

    lines = ["\n\n━━━ GUARDRAIL — CADASTRO DE PET ━━━"]
    lines.append(f"Campos já coletados nesta conversa: {', '.join(collected) if collected else 'nenhum'}")
    lines.append(f"Campos que AINDA FALTAM: {', '.join(missing)}")
    lines.append(
        "Pergunte APENAS os campos faltantes acima — não repita os que já foram ditos. "
        "Se faltam vários, prefira **uma única pergunta** com todos; **não** abrir só com porte "
        "se ainda faltam nome, espécie ou raça."
    )

    if "raça" in missing:
        user_txt, _ = _pet_conversation_texts(history, current_user_message)
        msgs = _history_with_current_user(history, current_user_message)
        prior_asst = _prior_assistant_before_last_user(msgs) or ""
        if _extract_suggested_breed_from_assistant_text(prior_asst):
            lines.append(
                "Se o cliente **já confirmou** (sim, isso, confirmo, isso mesmo…) a raça sugerida na "
                "última pergunta do assistente, **não** peça a raça de novo: siga para o **resumo** do "
                "cadastro e só então create_pet após confirmação explícita."
            )
        elif sug := _fuzzy_suggest_breed_display(user_txt):
            lines.append(
                f"Parece haver **erro de digitação** na raça. Correspondência provável: **{sug}**. "
                f"Pergunte exatamente: «Você quis dizer '{sug}'?» "
                "Se o cliente confirmar, use **essa grafia** em create_pet e considere raça e espécie definidas."
            )

    return specialist_input + "\n".join(lines)


def _guardrail_booking(
    specialist_input: str,
    context: dict,
    router_ctx: dict,
    history: list,
    current_user_message: str = "",
) -> str:
    """
    Três casos:
    1. Sem pets cadastrados → bloquear get_services neste turno
    2. Confirmação pendente mas não recebida → bloquear create/reschedule/cancel
    3. Serviço em discussão diverge do que o router extraiu → corrigir
    """
    pets = context.get("pets") or []
    lines = []

    if not pets:
        logger.info("GUARDRAIL booking | sem pets cadastrados — bloqueando get_services")
        lines.append("\n\n━━━ GUARDRAIL — BOOKING SEM PET ━━━")
        lines.append("get_client_pets retornou vazio — cliente não tem pets cadastrados.")
        lines.append("NÃO chame get_services neste turno.")
        lines.append("Informe que precisa cadastrar um pet primeiro e oriente o processo.")

    awaiting = router_ctx.get("awaiting_confirmation", False)
    if awaiting and not _confirmation_found_in_history(history, current_user_message):
        logger.info("GUARDRAIL booking | awaiting_confirmation=True mas confirmação não encontrada no histórico")
        lines.append("\n\n━━━ GUARDRAIL — CONFIRMAÇÃO PENDENTE ━━━")
        lines.append("O resumo foi enviado mas o cliente ainda não confirmou explicitamente.")
        lines.append("NÃO execute create_appointment, reschedule_appointment nem cancel_appointment.")
        lines.append("Aguarde resposta afirmativa ('sim', 'pode', 'confirma', 'ok').")

    if not lines:
        logger.debug("GUARDRAIL booking | sem injeções necessárias")

    result = specialist_input + "\n".join(lines)

    # Consistência de serviço: evita que o router confunda o serviço quando o cliente
    # seleciona um horário após o assistente ter ofertado slots de outro serviço
    result = _guardrail_service_consistency(
        result, router_ctx, history, current_user_message
    )

    return result


def _combine_recent_user_messages_for_service(
    history: list, current_user_message: str, limit: int = 6
) -> str:
    msgs = [m.get("content") or "" for m in history if m.get("role") == "user"]
    msgs = msgs[-limit:]
    cur = (current_user_message or "").strip()
    if cur and (not msgs or msgs[-1] != cur):
        msgs.append(cur)
    return " ".join(msgs).lower()


def _user_stated_booking_service_keyword(combined_lower: str) -> str | None:
    """Serviço que o cliente afirmou em texto recente (mais específico primeiro)."""
    patterns = (
        (r"\bcorte\s+de\s+unhas?\b", "corte de unha"),
        (r"\bescova\w*\s+de\s+dentes?\b", "escovação de dentes"),
        (r"\bhidrata\w*\b", "hidratação"),
        (r"\bbenho\s+e\s+tosa\s+tesoura\b", "banho e tosa tesoura"),
        (r"\bbenho\s+e\s+tosa\s+higi[eê]nica\b", "banho e tosa higiênica"),
        (r"\bbenho\s+e\s+tosa\s+m[aá]quina\b", "banho e tosa máquina"),
        (r"\bbenho\s+e\s+tosa\b", "banho e tosa"),
        (r"\bbenho\b", "banho"),
        (r"\btosa\b", "tosa"),
        (r"\bconsulta\s+veterin\w*\b", "consulta veterinária"),
        (r"\bconsulta\s+m[eé]dica\b", "consulta médica"),
        (r"\bconsulta\b", "consulta"),
        (r"\bvacina\b", "vacina"),
        (r"\badestramento\b", "adestramento"),
        (r"\bcirurgia\b", "cirurgia"),
    )
    for pat, label in patterns:
        if re.search(pat, combined_lower, re.IGNORECASE):
            return label
    return None


def _service_labels_compatible(a: str, b: str) -> bool:
    al = (a or "").lower().strip()
    bl = (b or "").lower().strip()
    if not al or not bl:
        return True
    if al == bl:
        return True
    if al in bl or bl in al:
        return True
    return False


def _guardrail_service_consistency(
    specialist_input: str,
    router_ctx: dict,
    history: list,
    current_user_message: str = "",
) -> str:
    """
    Alinha serviço ofertado nos slots com o Roteador e com correções explícitas do cliente.
    Evita voltar ao «banho» de uma remarcação antiga depois que o cliente pediu «corte de unha».
    """
    last_user = (current_user_message or "").strip()
    if not last_user:
        last_user = next(
            (m["content"] for m in reversed(history) if m.get("role") == "user"), ""
        )
    last_lower = last_user.lower()
    router_service = (router_ctx.get("service") or "").strip().lower()
    combined_user = _combine_recent_user_messages_for_service(
        history, current_user_message, limit=6
    )
    user_kw = _user_stated_booking_service_keyword(combined_user)
    active_service = _extract_active_service_from_last_slots_message(history)

    # Cliente corrigiu o serviço — não forçar banner antigo de slots (ex. banho na remarcação)
    if user_kw and active_service and not _service_labels_compatible(user_kw, active_service):
        logger.info(
            "GUARDRAIL serviço | cliente afirmou %r; banner antigo de slots era %r — não forçar banner",
            user_kw,
            active_service,
        )
        inj = [
            "\n\n━━━ GUARDRAIL — SERVIÇO PELO CLIENTE ━━━",
            f"Nas mensagens recentes o cliente deixou claro **{user_kw}**.",
            f"**Não** trate como **{active_service}** só porque isso apareceu numa oferta de horários anterior.",
        ]
        if router_service and _service_labels_compatible(router_service, user_kw):
            inj.append(
                f"O Roteador indica serviço alinhado ('{router_service}'). "
                "Use **get_services** + **get_available_times** com o **service_id** desse nome."
            )
        elif router_service and not _service_labels_compatible(router_service, user_kw):
            inj.append(
                f"Priorize o pedido do cliente (**{user_kw}**), não «{router_service}» se conflitar."
            )
        else:
            inj.append(
                "Resolva o nome exato em **get_services** e siga com esse **service_id**."
            )
        inj.append(
            "Se for **só remarcar** o mesmo compromisso já existente, use **reschedule_appointment** "
            "com o **appointment_id** desse serviço; se for **outro serviço** (novo), use **create_appointment** "
            "— não misture os dois."
        )
        return specialist_input + "\n".join(inj)

    # Turno só com horário: roteador já atualizou o serviço — não sobrescrever com banner velho
    if (
        _message_looks_like_time_selection(last_user)
        and router_service
        and active_service
        and router_service != active_service
    ):
        logger.info(
            "GUARDRAIL serviço | priorizando router_ctx.service=%r sobre banner %r (só horário)",
            router_service,
            active_service,
        )
        inj = [
            "\n\n━━━ GUARDRAIL — SERVIÇO (ROTEADOR) ━━━",
            f"Serviço vigente: **{router_service}** (Roteador).",
            f"Ignore ofertas antigas que cite só **{active_service}** se o cliente já mudou de serviço antes.",
            "Use **get_available_times** e o resumo com **esse** serviço.",
        ]
        return specialist_input + "\n".join(inj)

    if not _message_looks_like_time_selection(last_user):
        return specialist_input

    # Cliente citando dois serviços no mesmo turno — não forçar um único serviço do histórico
    if re.search(
        r"\b(e|\/)\s*(hidrata|banho|tosa|corte|unha|consulta|vacina)",
        last_lower,
    ) and last_lower.count(" às ") + last_lower.count(" as ") >= 2:
        logger.debug(
            "GUARDRAIL serviço | mensagem atual parece combinar dois serviços/horários — sem override"
        )
        return specialist_input

    # Roteador já definiu serviço e o cliente citou esse serviço na mensagem atual — confiar no router
    if router_service and router_service in last_lower:
        logger.debug(
            "GUARDRAIL serviço | router_ctx.service citado na mensagem atual — sem override"
        )
        return specialist_input
    sig_tokens = [t for t in re.split(r"[\s,]+", router_service) if len(t) > 2]
    if len(sig_tokens) >= 2 and all(t in last_lower for t in sig_tokens[:2]):
        logger.debug(
            "GUARDRAIL serviço | tokens do serviço do router na mensagem atual — sem override"
        )
        return specialist_input

    if not active_service:
        return specialist_input

    if router_service and router_service == active_service:
        logger.debug("GUARDRAIL serviço | router_ctx.service=%r coincide com histórico — sem injeção", router_service)
        return specialist_input

    if router_service and router_service != active_service:
        logger.warning(
            "GUARDRAIL serviço | divergência: router_ctx.service=%r mas histórico indica=%r — corrigindo",
            router_service, active_service
        )
    else:
        logger.info(
            "GUARDRAIL serviço | router_ctx.service vazio; histórico indica=%r — injetando",
            active_service
        )

    lines = ["\n\n━━━ GUARDRAIL — SERVIÇO EM DISCUSSÃO ━━━"]
    lines.append(f"O serviço sendo agendado/reagendado neste turno é: '{active_service}'.")
    if router_service and router_service != active_service:
        lines.append(f"O roteador extraiu '{router_service}', mas o histórico indica '{active_service}'.")
        lines.append(f"Use '{active_service}' — NÃO confirme nem reagende '{router_service}' neste turno.")
    else:
        lines.append(f"Use '{active_service}' — NÃO substitua por outro serviço.")
    return specialist_input + "\n".join(lines)


def _guardrail_lodging(specialist_input: str, router_ctx: dict) -> str:
    """
    Bloqueia cálculo de valor e confirmação de disponibilidade sem as duas datas.
    """
    checkin = router_ctx.get("checkin_mentioned")
    checkout = router_ctx.get("checkout_mentioned")
    lines = []

    if not checkin or not checkout:
        logger.info(
            "GUARDRAIL lodging | datas incompletas | checkin=%s checkout=%s",
            checkin, checkout
        )
        lines.append("\n\n━━━ GUARDRAIL — HOSPEDAGEM ━━━")
        lines.append("check-in e/ou check-out ainda não definidos neste turno.")
        lines.append("NÃO calcule valor total de diárias.")
        lines.append("NÃO confirme disponibilidade — pergunte as datas primeiro.")
    else:
        logger.debug("GUARDRAIL lodging | datas presentes — sem injeção")

    return specialist_input + "\n".join(lines)


def _guardrail_agent_transition(
    specialist_input: str,
    router_ctx: dict,
    previous_agent: str,
    history: list,
) -> str:
    """
    Quando o router troca de agente, injeta contexto da transição para
    que o novo agente saiba o que estava acontecendo antes.
    """
    current_agent = router_ctx.get("agent", "")
    transition_ctx = []

    logger.info(
        "GUARDRAIL agent_transition | %s → %s",
        previous_agent, current_agent
    )

    # onboarding → booking: passar pet recém cadastrado
    if previous_agent == "onboarding_agent" and current_agent == "booking_agent":
        pet_name = _extract_last_created_pet(history)
        if pet_name:
            logger.info("GUARDRAIL agent_transition | pet recém cadastrado detectado: %s", pet_name)
            transition_ctx.append(
                f"CONTEXTO DE TRANSIÇÃO: o cliente acabou de cadastrar o pet '{pet_name}' "
                f"com o agente anterior. Use get_client_pets para obter o UUID e prosseguir."
            )

    # booking → onboarding: pet novo detectado
    if previous_agent == "booking_agent" and current_agent == "onboarding_agent":
        logger.info("GUARDRAIL agent_transition | booking → onboarding: pet novo")
        transition_ctx.append(
            "CONTEXTO DE TRANSIÇÃO: o agente de agendamento identificou que o pet não existe. "
            "Inicie o cadastro: **uma pergunta** com nome, espécie (ou raça que defina), raça e porte "
            "(ou só o que faltar); depois **resumo + sim** antes de create_pet."
        )

    # qualquer → health após conversa informativa
    if previous_agent in ("faq_agent", "sales_agent") and current_agent == "health_agent":
        logger.info("GUARDRAIL agent_transition | faq/sales → health_agent")
        transition_ctx.append(
            "CONTEXTO DE TRANSIÇÃO: cliente estava em conversa informativa e agora quer agendar "
            "serviço de saúde. Verifique pets e serviços antes de buscar disponibilidade."
        )

    if transition_ctx:
        specialist_input += "\n\n━━━ TRANSIÇÃO DE AGENTE ━━━\n" + "\n".join(transition_ctx)

    return specialist_input


# ═══════════════════════════════════════════════════════════════════════════
# PÓS-PROCESSAMENTO — chamado após specialist.run()
# ═══════════════════════════════════════════════════════════════════════════

def check_post_guardrails(
    reply: str,
    run_output,
    agent_name: str,
    router_ctx: dict,
    history: list,
    current_user_message: str = "",
) -> tuple[bool, str]:
    """
    Ponto de entrada dos guardrails de pós-processamento.
    Retorna (deve_reprocessar: bool, motivo: str).
    Integrar no loop de reprocessamento existente em router.py.
    """

    # Guardrail: agendamento criado sem confirmação explícita
    if agent_name == "booking_agent":
        if _appointment_created_without_confirmation(
            run_output, router_ctx, history, current_user_message
        ):
            logger.warning(
                "GUARDRAIL pós | create/reschedule_appointment chamado sem confirmação explícita | agent=%s",
                agent_name
            )
            return True, (
                "\n\n━━━ REPROCESSAMENTO — AGENDAMENTO SEM CONFIRMAÇÃO ━━━\n"
                "Você chamou create_appointment ou reschedule_appointment sem receber confirmação explícita do cliente.\n"
                "NÃO refaça nem reagende. Envie o resumo ao cliente e aguarde 'sim', 'pode' ou 'confirma'.\n"
                "Formato: '[serviço] para o [pet] no dia [data] às [hora] — R$[X]. Confirma?'"
            )
        if _booking_success_claim_without_success(reply, run_output):
            logger.warning(
                "GUARDRAIL pós | resposta de sucesso sem create/reschedule success=true | agent=%s",
                agent_name
            )
            return True, (
                "\n\n━━━ REPROCESSAMENTO — SUCESSO SEM TOOL OK ━━━\n"
                "Você falou como se o agendamento/remarcação já estivesse confirmado, mas nesta rodada "
                "não houve create_appointment ou reschedule_appointment com success=true.\n"
                "NÃO diga 'fechado', 'agendado', 'confirmado' ou equivalente.\n"
                "Se ainda falta gravar, execute a tool correta e só confirme usando os dados retornados por ela.\n"
                "Se a tool falhou, explique o próximo passo real ao cliente sem fingir sucesso."
            )

    # Guardrail: create_pet chamado sem confirmação explícita do cliente
    if agent_name in (
        "onboarding_agent",
        "booking_agent",
        "health_agent",
        "lodging_agent",
    ):
        if _pet_created_without_confirmation(
            run_output, history, current_user_message
        ):
            logger.warning(
                "GUARDRAIL pós | create_pet chamado sem confirmação explícita | agent=%s",
                agent_name
            )
            return True, (
                "\n\n━━━ REPROCESSAMENTO — CADASTRO SEM CONFIRMAÇÃO ━━━\n"
                "Você chamou create_pet sem receber confirmação explícita do cliente.\n"
                "NÃO recadastre. Envie o resumo do pet ao cliente e aguarde 'sim', 'pode' ou 'confirma'.\n"
                "Formato: 'Vou cadastrar [nome], [espécie], [raça], porte [P/M/G/GG]. Confirma?'"
            )

    # Guardrail: pet afirmado como cadastrado sem verificar via get_client_pets
    if _pet_existence_claimed_without_verification(reply, run_output):
        logger.warning(
            "GUARDRAIL pós | pet afirmado como cadastrado sem get_client_pets | agent=%s reply=%.100s",
            agent_name, reply
        )
        return True, (
            "\n\n━━━ REPROCESSAMENTO — PET NÃO VERIFICADO ━━━\n"
            "Você afirmou que um pet está cadastrado sem ter chamado get_client_pets.\n"
            "Chame get_client_pets agora e responda com base no resultado real.\n"
            "Se o pet não aparecer na lista → informe que não está cadastrado e inicie o cadastro."
        )

    return False, ""


def _router_awaits_booking_confirmation(router_ctx: dict) -> bool:
    """Roteador às vezes manda stage=AWAITING_CONFIRMATION com awaiting_confirmation=False."""
    if router_ctx.get("awaiting_confirmation"):
        return True
    return str(router_ctx.get("stage") or "").upper() == "AWAITING_CONFIRMATION"


def _appointment_created_without_confirmation(
    run_output, router_ctx: dict, history: list, current_user_message: str = ""
) -> bool:
    """
    True se create_appointment ou reschedule_appointment foi chamado mas não havia
    confirmação explícita na última mensagem do cliente.
    """
    tools_called = [
        getattr(t, "tool_name", None)
        for t in (getattr(run_output, "tools", None) or [])
    ]
    action_tools = {"create_appointment", "reschedule_appointment"}
    if not action_tools.intersection(tools_called):
        return False

    # Já gravou com sucesso — não reprocessar: o cliente veria «Confirma?» ou «falta gravar» com DB ok
    if _appointment_write_succeeded(run_output):
        logger.debug(
            "GUARDRAIL pós | create/reschedule com success=true — ignorando checagem de confirmação"
        )
        return False

    waits = _router_awaits_booking_confirmation(router_ctx)
    if waits and _confirmation_found_in_history(history, current_user_message):
        return False

    # Sem flag de espera mas tentativa de escrita sem sucesso — pode ser reprocesso útil
    if not waits:
        logger.debug(
            "GUARDRAIL pós | create/reschedule sem awaiting_confirmation/stage — sem success=true"
        )
        return True

    return False


def _booking_success_claim_without_success(reply: str, run_output) -> bool:
    """
    True se a resposta fala como sucesso concluído sem create/reschedule_appointment
    bem-sucedido nesta rodada.
    """
    if not _reply_claims_booking_success(reply):
        return False

    return not _appointment_write_succeeded(run_output)


def _reply_claims_booking_success(reply: str) -> bool:
    stripped = (reply or "").strip()
    # Resumo pedindo confirmação ("… Confirma?" / "… Confirma") — não é afirmação de que já gravou
    if re.search(r"\bconfirma\??\s*$", stripped, re.IGNORECASE):
        return False
    normalized = reply.lower()
    # Ainda não gravou / convite para fechar — não disparar «sucesso sem tool»
    if re.search(
        r"\b(falta\s+(eu\s+)?gravar|ainda\s+não\s+gravei|não\s+gravei\s+ainda|"
        r"só\s+falta\s+eu\s+gravar|posso\s+(já\s+)?confirmar\s+agora\s+no\s+sistema)\b",
        normalized,
    ):
        return False
    patterns = [
        r"\bfechado\b",
        r"\bficou agendad",
        r"\bestá agendad",
        r"\besta agendad",
        r"\bconfirmad[oa]\b",
        r"\bmarquei\b",
        r"\bjá marquei\b",
        r"\bagendei\b",
        r"\bremarquei\b",
        r"\bvai ficar no\b",
        r"\bno dia \d{1,2}/\d{1,2}(?:/\d{2,4})? às \d{1,2}:\d{2}\b",
    ]
    return any(re.search(pattern, normalized, re.IGNORECASE) for pattern in patterns)


def _appointment_write_succeeded(run_output) -> bool:
    for t in (getattr(run_output, "tools", None) or []):
        tool_name = getattr(t, "tool_name", None)
        if tool_name not in {"create_appointment", "reschedule_appointment"}:
            continue
        if getattr(t, "tool_call_error", False):
            continue
        data = parse_tool_result_dict(getattr(t, "result", None))
        if data.get("success") is True:
            return True
    return False


def parse_tool_result_dict(result) -> dict:
    """
    Normaliza o retorno de tools no RunOutput do Agno.
    O Agno grava o output de funções Python com str(dict) (aspas simples) — não é JSON válido;
    sem isso, guardrails acham que create_appointment não teve success=true e forçam reprocessamento
    (segundo create → use_reschedule_instead → fila de cancelamentos).
    """
    if result is None:
        return {}
    if isinstance(result, dict):
        return result
    if isinstance(result, str):
        s = result.strip()
        if not s:
            return {}
        try:
            parsed = json.loads(s)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            pass
        try:
            parsed = ast.literal_eval(s)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    try:
        text = json.dumps(result, default=str)
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _tool_result_as_dict(result) -> dict:
    return parse_tool_result_dict(result)


def _pet_existence_claimed_without_verification(reply: str, run_output) -> bool:
    """
    True se a resposta afirma que um pet está cadastrado sem get_client_pets ter sido chamado.
    """
    tools_called = [
        getattr(t, "tool_name", None)
        for t in (getattr(run_output, "tools", None) or [])
    ]
    if "get_client_pets" in tools_called:
        return False  # verificou — ok

    patterns = [
        r"já está cadastrado",
        r"já temos o .{2,30} aqui",
        r"encontrei o .{2,30} no sistema",
        r"o .{2,30} já está no sistema",
        r"tenho o .{2,30} cadastrado",
    ]
    for p in patterns:
        if re.search(p, reply, re.IGNORECASE):
            logger.debug("GUARDRAIL pós | padrão de afirmação de pet detectado: %s", p)
            return True

    return False


# ═══════════════════════════════════════════════════════════════════════════
# ENXUGAMENTO DE CONTEXTO — chamado antes de specialist.run()
# ═══════════════════════════════════════════════════════════════════════════

def trim_specialist_input(specialist_input: str, router_ctx: dict) -> str:
    """
    Remove blocos do input do especialista irrelevantes para este turno.
    Baseado no required_tools do router — se o router disse que não precisa,
    o código remove o bloco para não inflar o contexto e o custo.
    """
    required = set(router_ctx.get("required_tools") or [])
    original_len = len(specialist_input)

    # Turno de conversa pura — remover blocos de cache e disponibilidade
    if required == {"none"}:
        specialist_input = _keep_only_conversation(specialist_input)
        logger.info(
            "TRIM | required_tools=none | %d → %d chars (-%d%%)",
            original_len, len(specialist_input),
            int((1 - len(specialist_input) / max(original_len, 1)) * 100)
        )
        return specialist_input

    # Remover bloco de disponibilidade se não precisa de slots
    if "slots" not in required:
        before = len(specialist_input)
        specialist_input = _remove_block(specialist_input, "DADOS DE DISPONIBILIDADE")
        if len(specialist_input) < before:
            logger.debug("TRIM | removeu DADOS DE DISPONIBILIDADE | slots não requerido")

    if router_ctx.get("awaiting_confirmation"):
        before = len(specialist_input)
        specialist_input = _remove_block(specialist_input, "DADOS DE DISPONIBILIDADE")
        if len(specialist_input) < before:
            logger.debug("TRIM | removeu DADOS DE DISPONIBILIDADE | awaiting_confirmation")

    if "services" not in required:
        before = len(specialist_input)
        specialist_input = _remove_block(specialist_input, "CADASTRO DO PETSHOP — SERVIÇOS")
        if len(specialist_input) < before:
            logger.debug("TRIM | removeu bloco SERVIÇOS | services não requerido")

    # Remover bloco de hospedagem se não precisa de lodging
    if "lodging" not in required:
        before = len(specialist_input)
        specialist_input = _remove_block(specialist_input, "CADASTRO DO PETSHOP — HOSPEDAGEM")
        if len(specialist_input) < before:
            logger.debug("TRIM | removeu bloco HOSPEDAGEM | lodging não requerido")

    final_len = len(specialist_input)
    if final_len < original_len:
        logger.info(
            "TRIM | required_tools=%s | %d → %d chars (-%d%%)",
            list(required), original_len, final_len,
            int((1 - final_len / max(original_len, 1)) * 100)
        )

    return specialist_input


def _keep_only_conversation(specialist_input: str) -> str:
    """
    Para turnos none — mantém apenas histórico e mensagem atual.
    Remove blocos de cache, disponibilidade e ferramentas.
    """
    lines = specialist_input.split("\n")
    kept = []
    skip_block = False

    SKIP_MARKERS = [
        "CACHE RECENTE",
        "DADOS DE DISPONIBILIDADE",
        "ROTEADOR — FERRAMENTAS DESTE TURNO",
        "required_tools:",
    ]

    for line in lines:
        if any(marker in line for marker in SKIP_MARKERS):
            skip_block = True

        if skip_block and line.strip() == "":
            skip_block = False
            continue

        if not skip_block:
            kept.append(line)

    return "\n".join(kept)


def _remove_block(text: str, block_marker: str) -> str:
    """
    Remove um bloco delimitado por ━━━ que contém o marker fornecido.
    """
    pattern = rf"━+[^━\n]*{re.escape(block_marker)}[^━\n]*━+[\s\S]*?(?=━━━|$)"
    result = re.sub(pattern, "", text, flags=re.DOTALL).strip()
    return result


# ═══════════════════════════════════════════════════════════════════════════
# UTILITÁRIOS
# ═══════════════════════════════════════════════════════════════════════════

# Nomes curtos que não devem ser tratados como nome de pet vindos do roteador
_ACTIVE_PET_IGNORE = frozenset(
    {
        "sim",
        "não",
        "nao",
        "ok",
        "null",
        "none",
        "pet",
        "banho",
        "tosa",
    }
)

# Palavras que não são nome quando capturadas por padrões tipo "Fulano, já te falei"
_NAME_CANDIDATE_IGNORE = frozenset(
    {
        "sim",
        "não",
        "nao",
        "ok",
        "oi",
        "olá",
        "ola",
        "um",
        "uma",
        "o",
        "a",
        "ele",
        "ela",
        "isso",
    }
)

# Token após «cachorro, …» / «um … grande» que não é raça (evita falso positivo)
_BREED_TOKEN_STOPWORDS = frozenset(
    {
        "grande",
        "pequeno",
        "pequena",
        "médio",
        "medio",
        "gigante",
        "cachorro",
        "cachorra",
        "cachorrinho",
        "gato",
        "gata",
        "gatinho",
        "cão",
        "filhote",
        "macho",
        "fêmea",
        "femea",
        "nome",
        "ele",
        "ela",
        "tipo",
        "mesmo",
        "mesma",
        "sorte",
        "lindo",
        "linda",
        "bonito",
        "bonita",
        "vira",
        "lata",
        "srd",
        "sem",
        "raça",
        "raca",
        "anos",
        "meses",
        "mês",
        "mes",
        "ano",
    }
)

# Regex de raças conhecidas (reutilizado no extrator e na sugestão fuzzy).
_PET_KNOWN_BREEDS_RE = re.compile(
    r"\b("
    r"golden|labrador|poodle|pitbull|pit\s*bull|pitbul|"
    r"rottweiler|bulldog|lhasa|shih\s*tzu|"
    r"persa|siam[eê]s|angor[aá]|husky|pastor\s*alem[aã]o|pinscher|vira.?lata|sem\s*ra[cç]a|srd|"
    r"dobbleman|do[b]{1,2}er+man[n]?|"
    r"beagle|chihuahua|malt[eê]s|yorkshire|york|spitz|schnauzer|boxer|"
    r"d[aá]lmata|weimaraner|cockapoo|maltipoo|jack\s*russell|border\s*collie|"
    r"akita|chow\s*chow|samoiedo|mastiff|dogue|fila\s*brasileir[oa]?|terrier|collie|"
    r"bernese\s*mountain|golden\s*retriever|labrador\s*retriever|corgi|papillon|pug"
    r")\b",
    re.IGNORECASE,
)

# Nomes canônicos para sugestão «Você quis dizer '…'?» e fuzzy match.
_KNOWN_BREED_DISPLAY: tuple[str, ...] = (
    "Pitbull",
    "Golden Retriever",
    "Labrador Retriever",
    "Labrador",
    "Poodle",
    "Rottweiler",
    "Bulldog",
    "Lhasa Apso",
    "Shih Tzu",
    "Persa",
    "Siamês",
    "Angorá",
    "Husky Siberiano",
    "Husky",
    "Pastor Alemão",
    "Pinscher",
    "Vira-lata",
    "SRD",
    "Doberman",
    "Beagle",
    "Chihuahua",
    "Maltês",
    "Yorkshire",
    "Spitz Alemão",
    "Spitz",
    "Schnauzer",
    "Boxer",
    "Dálmata",
    "Weimaraner",
    "Cockapoo",
    "Maltipoo",
    "Jack Russell",
    "Border Collie",
    "Akita",
    "Chow Chow",
    "Samoiedo",
    "Mastiff",
    "Dogue Alemão",
    "Fila Brasileiro",
    "Terrier",
    "Collie",
    "Bernese Mountain Dog",
    "Corgi",
    "Papillon",
    "Pug",
    "Maine Coon",
    "Sphynx",
)


def _strip_accents(s: str) -> str:
    return "".join(
        c
        for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def _breed_compare_key(display: str) -> str:
    return _strip_accents(display.lower()).replace(" ", "").replace("-", "")


# Grafias muito comuns → canônico (chaves normalizadas com _breed_compare_key).
_EXPLICIT_BREED_TYPOS: dict[str, str] = {
    _breed_compare_key(k): v
    for k, v in (
        ("pitbul", "Pitbull"),
        ("pit bool", "Pitbull"),
        ("pitbool", "Pitbull"),
        ("pitboll", "Pitbull"),
        ("dobbleman", "Doberman"),
        ("dobermann", "Doberman"),
        ("pastor alemão", "Pastor Alemão"),
        ("pastor alemao", "Pastor Alemão"),
        ("golden", "Golden Retriever"),
        ("labrador", "Labrador Retriever"),
    )
}


_BREED_FUZZY_KEYS: list[tuple[str, str]] = [
    (d, _breed_compare_key(d)) for d in _KNOWN_BREED_DISPLAY
]


def _pet_conversation_texts(
    history: list, current_user_message: str = ""
) -> tuple[str, str]:
    user_chunks = [
        m["content"].lower()
        for m in history
        if m.get("role") == "user"
    ]
    cur = (current_user_message or "").strip().lower()
    if cur and (not user_chunks or user_chunks[-1] != cur):
        user_chunks.append(cur)
    user_text = " ".join(user_chunks)
    assistant_text = " ".join(
        m["content"].lower()
        for m in history
        if m.get("role") == "assistant"
    )
    return user_text, assistant_text


def _history_with_current_user(history: list, current_user_message: str) -> list:
    cur = (current_user_message or "").strip()
    if not cur:
        return list(history)
    out: list = []
    for m in history:
        out.append(m)
    if not out or out[-1].get("role") != "user" or (out[-1].get("content") or "").strip() != cur:
        out.append({"role": "user", "content": cur})
    return out


def _prior_assistant_before_last_user(msgs: list) -> str | None:
    if len(msgs) < 2 or msgs[-1].get("role") != "user":
        return None
    for i in range(len(msgs) - 2, -1, -1):
        if msgs[i].get("role") == "assistant":
            return msgs[i].get("content") or ""
    return None


def _extract_suggested_breed_from_assistant_text(assistant_text: str) -> str | None:
    if not assistant_text:
        return None
    patterns = (
        r"quis\s+dizer\s*['\"\u201c\u201d]?\s*([^'\"\u201c\u201d\n?]+?)\s*['\"\u201c\u201d]?\s*\?",
        r"quis\s+dizer\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-]{1,42})\?",
        r"seria\s+['\"\u201c\u201d]?\s*([^'\"\u201c\u201d\n?]+?)\s*['\"\u201c\u201d]?\s*\?",
    )
    for p in patterns:
        m = re.search(p, assistant_text, re.IGNORECASE)
        if m:
            frag = (m.group(1) or "").strip()
            if len(frag) >= 2:
                return frag
    return None


def _canonicalize_breed_fragment(fragment: str) -> str | None:
    raw = fragment.strip()
    if not raw:
        return None
    cand_key = _breed_compare_key(raw)
    if len(cand_key) < 2:
        return None
    if cand_key in _EXPLICIT_BREED_TYPOS:
        return _EXPLICIT_BREED_TYPOS[cand_key]
    best_display: str | None = None
    best = 0.0
    if len(cand_key) < 3:
        return None
    for display, bkey in _BREED_FUZZY_KEYS:
        if abs(len(cand_key) - len(bkey)) > max(4, len(bkey) // 2):
            continue
        r = SequenceMatcher(None, cand_key, bkey).ratio()
        if r > best:
            best = r
            best_display = display
    if best >= 0.86 and best_display:
        return best_display
    return None


def _iter_breed_typo_candidates(user_text: str) -> list[str]:
    low = user_text.lower()
    found: list[str] = []
    seen: set[str] = set()

    def add(s: str) -> None:
        t = s.strip().lower()
        if len(t) < 4 or t in seen:
            return
        seen.add(t)
        found.append(t)

    for m in re.finditer(
        r"\b(cachorro|cachorrinho|cão|gato|gatinho)\s*,\s*([a-záéíóúãõâêîôûç]{3,32})\b",
        low,
        re.IGNORECASE,
    ):
        add(m.group(2))
    for m in re.finditer(
        r"\bum\s+([a-záéíóúãõâêîôûç]+(?:\s+[a-záéíóúãõâêîôûç]+){0,2})\s+"
        r"(?:grande|pequeno|pequena|médio|medio|gigante|gg)\b",
        low,
        re.IGNORECASE,
    ):
        frag = m.group(1).strip().lower()
        parts = frag.split()
        if parts and parts[0] in (
            "cachorro",
            "cachorra",
            "gato",
            "gata",
            "cão",
            "cadela",
        ):
            continue
        add(frag.replace(" ", ""))
        add(frag)
    for m in re.finditer(r"\b[a-záéíóúãõâêîôûç]{4,24}\b", low):
        w = m.group(0)
        if w in _BREED_TOKEN_STOPWORDS or w in _NAME_CANDIDATE_IGNORE:
            continue
        add(w)
    return found


def _fuzzy_suggest_breed_display(user_text: str) -> str | None:
    if not user_text or _PET_KNOWN_BREEDS_RE.search(user_text):
        return None
    best_cand: str | None = None
    best_display: str | None = None
    best_score = 0.0
    for cand in _iter_breed_typo_candidates(user_text):
        ck = _breed_compare_key(cand)
        if len(ck) < 4:
            continue
        if ck in _EXPLICIT_BREED_TYPOS:
            return _EXPLICIT_BREED_TYPOS[ck]
        for display, bkey in _BREED_FUZZY_KEYS:
            if abs(len(ck) - len(bkey)) > max(4, len(bkey) // 2):
                continue
            r = SequenceMatcher(None, ck, bkey).ratio()
            if r > best_score:
                best_score = r
                best_display = display
                best_cand = ck
    if (
        best_score >= 0.88
        and best_display
        and best_cand
        and best_cand != _breed_compare_key(best_display)
    ):
        return best_display
    return None


_REJECT_BREED_SUGGESTION_RE = re.compile(
    r"\b(não|nao|nunca|errad|negativo|outra\s+ra[cç]a|outra\s+raca|"
    r"não\s+é|nao\s+é|não\s+e|nao\s+e)\b",
    re.IGNORECASE,
)


def _user_rejects_breed_suggestion(text: str) -> bool:
    return bool(_REJECT_BREED_SUGGESTION_RE.search(text or ""))


def _breed_suggestion_confirmed(
    history: list, current_user_message: str = ""
) -> str | None:
    msgs = _history_with_current_user(history, current_user_message)
    asst = _prior_assistant_before_last_user(msgs)
    if not asst:
        return None
    raw = _extract_suggested_breed_from_assistant_text(asst)
    if not raw:
        return None
    canon = _canonicalize_breed_fragment(raw)
    if not canon:
        return None
    last_u = (msgs[-1].get("content") or "").strip()
    if _user_rejects_breed_suggestion(last_u):
        return None
    if not _text_implies_confirmation(last_u):
        return None
    return canon


def _router_active_pet_is_pet_name(router_ctx: dict | None) -> bool:
    ap = (router_ctx or {}).get("active_pet")
    if not ap or not str(ap).strip():
        return False
    t = str(ap).strip()
    if len(t) < 2 or len(t) > 40:
        return False
    return t.lower() not in _ACTIVE_PET_IGNORE


def _extract_pet_name_from_user_messages(history: list) -> bool:
    """
    Detecta nome/apelido dito pelo cliente (ex.: «É o Joca, um pastor alemão», «Joca, já te falei»).
    """
    user_text = " ".join(
        m["content"].lower()
        for m in history
        if m.get("role") == "user"
    )
    # é o joca, / é o joca um / é o thor.
    if re.search(
        r"é\s+o\s+([a-záéíóúãõâêîôûç]{2,25})(?:\s*[,.]|\s+um\s+|\s+uma\s+|\s+é\s+|\s*$)",
        user_text,
    ):
        return True
    if re.search(
        r"é\s+a\s+([a-záéíóúãõâêîôûç]{2,25})(?:\s*[,.]|\s+uma\s+|\s*$)",
        user_text,
    ):
        return True
    if re.search(
        r"(?:se\s+chama|chama-se|nome\s+(?:é|dele|dela))\s+([a-záéíóúãõâêîôûç]{2,25})\b",
        user_text,
    ):
        return True
    # Mensagem começando com Nome, … (maiúscula ou minúscula)
    for m in history:
        if m.get("role") != "user":
            continue
        raw = (m.get("content") or "").strip()
        if not raw:
            continue
        lead = re.match(
            r"^([A-Za-zÁÉÍÓÚÃÕÂÊÎÔÛÇáéíóúãõâêîôûç]{2,25})\s*,",
            raw,
        )
        if lead:
            cand = lead.group(1).lower()
            if cand not in _NAME_CANDIDATE_IGNORE:
                return True
    return False


def _extract_pet_fields_from_history(
    history: list,
    router_ctx: dict | None = None,
    current_user_message: str = "",
) -> set:
    """
    Lê o histórico (e o contexto do roteador) e detecta quais campos do pet já foram fornecidos.

    Em /run o Redis já gravou a mensagem atual, mas a lista `history` costuma ser a capturada
    *antes* desse save — sem incluir `current_user_message` o extrator ignora o turno atual
    (ex.: «É o Léo, um pastor alemão grande») e só vê nome vindo do active_pet do router.
    """
    collected = set()
    user_text, assistant_text = _pet_conversation_texts(history, current_user_message)

    # Nome — assistente ecoou o apelido (evita depender só do regex das mensagens do cliente)
    if re.search(
        r"\bjá\s+tenho\s+o\s+nome\s+do\s+([a-záéíóúãõâêîôûç]{2,25})\b",
        assistant_text,
    ):
        collected.add("nome")

    # Porte
    if re.search(r"\b(pequen\w*|médi\w*|medio|grand\w*|gg|extra\s*grand\w*)\b", user_text):
        collected.add("porte")

    # Espécie — pelo texto do cliente
    if re.search(r"\b(cachorro|cachorrinho|cão|gato|gatinho)\b", user_text):
        collected.add("espécie")

    # Raça conhecida implica espécie (inclui grafias comuns erradas, ex.: dobberman, dobbleman, pitbul)
    if _PET_KNOWN_BREEDS_RE.search(user_text):
        collected.add("raça")
        collected.add("espécie")

    # Heurística: «cachorro/gato, token» — o token costuma ser a raça (não exige grafia de dicionário)
    if "raça" not in collected:
        for m in re.finditer(
            r"\b(cachorro|cachorrinho|cão|gato|gatinho)\s*,\s*([a-záéíóúãõâêîôûç]{3,32})\b",
            user_text,
            re.IGNORECASE,
        ):
            tok = m.group(2).lower()
            if tok not in _BREED_TOKEN_STOPWORDS:
                collected.add("raça")
                break

    # Heurística: «um doberman grande» / «um pastor alemão médio» (nome da raça entre um e porte)
    if "raça" not in collected:
        for m in re.finditer(
            r"\bum\s+([a-záéíóúãõâêîôûç]+(?:\s+[a-záéíóúãõâêîôûç]+){0,2})\s+"
            r"(?:grande|pequeno|pequena|médio|medio|gigante|gg)\b",
            user_text,
            re.IGNORECASE,
        ):
            frag = m.group(1).lower().strip()
            parts = [p for p in frag.split() if p]
            if not parts:
                continue
            if parts[0] in ("cachorro", "cachorra", "gato", "gata", "cão", "cadela"):
                continue
            if all(p not in _BREED_TOKEN_STOPWORDS for p in parts):
                collected.add("raça")
                break

    # Cliente confirmou raça após sugestão «Você quis dizer '…'?»
    if "raça" not in collected and _breed_suggestion_confirmed(
        history, current_user_message
    ):
        collected.add("raça")
        collected.add("espécie")

    # Nome — roteador já extraiu pet em foco (ex.: Joca)
    if _router_active_pet_is_pet_name(router_ctx):
        collected.add("nome")

    # Nome — texto explícito do cliente
    if _extract_pet_name_from_user_messages(history):
        collected.add("nome")

    # Nome — se o assistente confirmou o nome em alguma mensagem
    if re.search(r"\b(porte .{2,20} confirmado|o nome do pet|qual\s+[eé]\s+o\s+nome)\b", assistant_text):
        pass  # assistente ainda estava perguntando
    if re.search(r"\b(cadastrad\w+|registrad\w+|create_pet)\b", assistant_text):
        collected.update(["porte", "nome", "espécie", "raça"])

    # Nome — heurística: se o assistente usou um nome próprio para o pet em confirmação
    name_confirm = re.search(
        r"\b(?:o|a)\s+([A-Z][a-záéíóúãõâêîôûç]{2,})\s+(?:foi|está|ficou)\s+cadastrad",
        " ".join(m["content"] for m in history if m.get("role") == "assistant"),
        re.IGNORECASE
    )
    if name_confirm:
        collected.add("nome")

    return collected


# Frases multi-palavra antes do regex de palavras soltas (evita "s" em "pastor" ou "sim" em "assim").
_CONFIRMATION_PHRASES = (
    "pode ser", "tá bom", "ta bom", "isso mesmo", "pode sim",
)
_CONFIRMATION_WORDS_RE = re.compile(
    r"\b(sim|pode|confirma|isso|ok|yes|confirmo|perfeito|"
    r"ótimo|otimo|fechado|fecha|bora)\b",
    re.IGNORECASE,
)


def _text_implies_confirmation(text: str) -> bool:
    last = (text or "").lower().strip()
    if not last:
        return False
    for phrase in _CONFIRMATION_PHRASES:
        if phrase in last:
            return True
    return bool(_CONFIRMATION_WORDS_RE.search(last))


def _confirmation_found_in_history(
    history: list, current_user_message: str = ""
) -> bool:
    """
    Verifica se a mensagem atual do usuário (se houver) ou a última do histórico
    contém confirmação explícita. O histórico do /run muitas vezes **não** inclui
    a mensagem do turno atual.
    """
    if current_user_message and _text_implies_confirmation(current_user_message):
        logger.debug(
            "GUARDRAIL | _confirmation_found_in_history | current_user confirms | found=True"
        )
        return True
    user_msgs = [m for m in history if m.get("role") == "user"]
    if not user_msgs:
        return False
    last = user_msgs[-1]["content"].lower().strip()
    result = _text_implies_confirmation(last)
    logger.debug(
        "GUARDRAIL | _confirmation_found_in_history | last_msg='%s' | found=%s",
        last, result,
    )
    return result


def _pet_created_without_confirmation(
    run_output, history: list, current_user_message: str = ""
) -> bool:
    """
    True se create_pet foi chamado mas não havia confirmação explícita
    na mensagem atual do cliente ou na última mensagem de usuário no histórico.
    """
    tools_called = [
        getattr(t, "tool_name", None)
        for t in (getattr(run_output, "tools", None) or [])
    ]
    if "create_pet" not in tools_called:
        return False

    if _confirmation_found_in_history(history, current_user_message):
        return False

    logger.debug("GUARDRAIL pós | create_pet chamado sem confirmação explícita no histórico")
    return True


def _message_looks_like_time_selection(message: str) -> bool:
    """
    True se a mensagem do usuário parece ser uma seleção de horário (ex.: 'às 9h', '14h', 'pode ser às 10').
    Não deve disparar em perguntas genéricas de confirmação.
    """
    m = (message or "").strip().lower()
    if not m:
        return False
    if re.search(r"\b\d{1,2}\s*h\b", m):
        return True
    if re.search(r"às\s*\d|as\s+\d", m):
        return True
    return False


def _extract_active_service_from_last_slots_message(history: list) -> str | None:
    """
    Percorre as mensagens do assistente do mais recente para o mais antigo e extrai
    o serviço que estava sendo ofertado nos slots de horário apresentados.
    Retorna None se não encontrar evidência clara.
    """
    service_patterns = [
        (r"\b(corte\s+de\s+unhas?)\b", 1),
        (r"\b(escova\w*\s+de\s+dentes?)\b", 1),
        # "para a hidratação", "para o banho", "para a tosa", etc.
        (r"\bpara\s+(?:a|o)\s+(hidrata\w+|banho|tosa\w*|consulta\w*|vacina\w*|castração\w*|castrac\w*)", 1),
        # "horários para hidratação", "horários para banho"
        (r"\bhor[aá]rios?\s+para\s+(?:a?\s*)?(hidrata\w+|banho|tosa\w*|consulta\w*|vacina\w*|castração\w*|castrac\w*|corte\s+de\s+unhas?)", 1),
        # "da hidratação", "do banho" (quando fala de reagendar)
        (r"\b(?:da|do)\s+(hidrata\w+|banho|tosa\w*|consulta\w*|vacina\w*|castração\w*|castrac\w*|corte\s+de\s+unhas?)\b", 1),
        # "a hidratação foi remarcada", "o banho ficou para"
        (r"\b(?:a|o)\s+(hidrata\w+|banho|tosa\w*|consulta\w*|vacina\w*|castração\w*|castrac\w*|corte\s+de\s+unhas?)\s+(?:foi|ficou|está)", 1),
    ]

    for msg in reversed(history):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content", "")
        for pattern, group in service_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                return match.group(group).strip().lower()

    return None


def _extract_last_created_pet(history: list) -> str | None:
    """
    Extrai o nome do pet que foi cadastrado com sucesso nas mensagens do assistente.
    """
    for msg in reversed(history):
        if msg.get("role") != "assistant":
            continue
        match = re.search(
            r"(?:cadastrad|registrad)\w{0,2}\s+(?:com\s+sucesso\s+)?[!\.]?\s*"
            r"(?:o|a)?\s*([A-ZÁÉÍÓÚÃÕ][a-záéíóúãõâêîôûç]{1,20})",
            msg["content"],
            re.IGNORECASE
        )
        if match:
            return match.group(1)
    return None
