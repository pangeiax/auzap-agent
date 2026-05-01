"""
Prompt do identity_agent — conduz o cadastro do cliente de forma natural,
pedindo só os campos que faltam, com tom humano e contexto da intenção
original que disparou o cadastro.
"""

from __future__ import annotations


_FIELD_LABEL_PT = {
    "name": "nome completo",
    "email": "e-mail",
    "manual_phone": "telefone com DDD",
    "cpf": "CPF",
}


def _format_known(client: dict | None, identity_status: dict) -> str:
    """Resumo curto dos dados que JÁ temos — pra LLM não pedir de novo."""
    if not client:
        return "Nenhum dado cadastral conhecido ainda."
    parts: list[str] = []
    if identity_status.get("has_name") and client.get("name"):
        parts.append(f"nome: {client['name']}")
    if identity_status.get("has_email") and client.get("email"):
        parts.append(f"e-mail: {client['email']}")
    if identity_status.get("has_manual_phone") and client.get("manual_phone"):
        parts.append(f"telefone: {client['manual_phone']}")
    if identity_status.get("has_cpf") and client.get("cpf"):
        cpf = client["cpf"]
        # Mascara parte central do CPF no contexto pra LLM (ela ainda sabe o
        # cliente já deu CPF, mas o prompt não vaza dados desnecessariamente).
        if len(cpf) == 11:
            parts.append(f"CPF: {cpf[:3]}.***.***-{cpf[-2:]}")
        else:
            parts.append("CPF: já cadastrado")
    return "; ".join(parts) if parts else "Nenhum dado cadastral conhecido ainda."


def _format_missing(missing: list[str]) -> str:
    if not missing:
        return "(nada — você não deveria estar sendo chamado)"
    labels = [_FIELD_LABEL_PT.get(m, m) for m in missing]
    return ", ".join(labels)


def _format_pending_intent(pending_intent: dict | None) -> str:
    if not pending_intent:
        return ""
    summary = (pending_intent.get("summary") or "").strip()
    if not summary:
        return ""
    return (
        f"\n• Antes de você entrar, o cliente pediu: «{summary}». "
        "Mencione brevemente que isso volta a andar assim que terminar o cadastro."
    )


def build_identity_prompt(context: dict, router_ctx: dict) -> str:
    client = context.get("client") or {}
    identity_status = context.get("identity_status") or {}
    company_name = (context.get("company_name") or "a loja").strip()
    assistant_name = (context.get("assistant_name") or "Assistente").strip()
    pending_intent = router_ctx.get("pending_intent") if router_ctx else None

    # Snapshot consolidado (banco + parciais Redis + extração da msg atual).
    # Preenchido pelo router via `preprocess_identity_message`. Quando ausente
    # (ex: erro no preprocess), caímos no identity_status do banco.
    snapshot = context.get("identity_partial_snapshot") or {}
    if snapshot:
        snap_known = {
            "name": snapshot.get("full_name") or client.get("name") or "",
            "email": snapshot.get("email") or client.get("email") or "",
            "manual_phone": snapshot.get("phone") or client.get("manual_phone") or "",
            "cpf": snapshot.get("cpf_digits") or client.get("cpf") or "",
        }
        # Mapeia missing do snapshot (PT-BR) → labels usadas em _format_missing
        missing_pt = snapshot.get("missing") or []
        cpf_invalid = bool(snapshot.get("cpf_invalid"))
        reroute = bool(snapshot.get("reroute_cpf_to_phone"))
    else:
        snap_known = {
            "name": client.get("name") or "",
            "email": client.get("email") or "",
            "manual_phone": client.get("manual_phone") or "",
            "cpf": client.get("cpf") or "",
        }
        missing_pt = []
        for k, label in (("name", "nome completo"), ("email", "e-mail"),
                         ("manual_phone", "telefone"), ("cpf", "cpf")):
            if not (snap_known[k] or "").strip():
                missing_pt.append(label)
        cpf_invalid = False
        reroute = False

    snap_status = {
        "has_name": bool(snap_known["name"]),
        "has_email": bool(snap_known["email"]),
        "has_manual_phone": bool(snap_known["manual_phone"]),
        "has_cpf": bool(snap_known["cpf"]),
    }
    known = _format_known(snap_known, snap_status)
    missing_label = ", ".join(missing_pt) if missing_pt else "(nada — chame save_identity)"
    pending_block = _format_pending_intent(pending_intent)

    extra_state: list[str] = []
    if cpf_invalid:
        extra_state.append("• CPF que o cliente acabou de mandar é INVÁLIDO (dígitos verificadores não batem). Peça SÓ o CPF de novo, sem repedir os outros campos.")
    if reroute:
        extra_state.append("• O número que parecia CPF era um telefone BR válido — já foi gravado como telefone. Não comente isso.")

    autosave = snapshot.get("autosave") if snapshot else None
    autosave_ok = bool(autosave and autosave.get("saved"))
    autosave_failed = bool(autosave and not autosave.get("saved"))
    autosave_pets = (autosave or {}).get("existing_pets") or []
    autosave_appts = (autosave or {}).get("existing_appointments") or []
    autosave_merged_dup = bool((autosave or {}).get("merged_with_existing"))

    autosave_needs_human = bool(autosave and autosave.get("needs_human"))
    if autosave_failed:
        if autosave_needs_human:
            extra_state.append(
                "• ⚠️ COLISÃO DE CADASTRO: o CPF ou telefone informado já pertence a outro cliente com agendamento ativo. "
                "Você NÃO consegue resolver — chame `escalate_due_to_refusal` com motivo "
                "'Colisão de cadastro: CPF/telefone batendo com cliente existente, precisa de revisão humana' "
                "e responda ao cliente algo como: 'Esses dados ficaram conflitando com um cadastro existente aqui. "
                "Vou chamar alguém da equipe pra resolver isso pra você direitinho.'"
            )
        else:
            extra_state.append(f"• AUTO-SAVE FALHOU: {autosave.get('error', 'erro desconhecido')}. Não fale isso ao cliente, apenas peça pra confirmar os dados de novo.")

    extra_state_block = ("\n" + "\n".join(extra_state)) if extra_state else ""

    # Quando o autosave acabou de rodar com sucesso, o foco do prompt MUDA:
    # não pedir dados, mas fazer a ponte verbal com a intenção pendente.
    if autosave_ok:
        pets_line = ""
        if autosave_pets:
            pet_list = ", ".join(
                f"{p.get('name')}" + (f" ({(p.get('species') or '').strip()})" if p.get('species') else "")
                for p in autosave_pets[:4]
            )
            pets_line = f"\nPets cadastrados na base: {pet_list}."
        else:
            pets_line = "\nNão tem pets cadastrados ainda."
        appts_line = ""
        if autosave_appts:
            ap_list = ", ".join(
                f"{a.get('service_name')} em {a.get('scheduled_date')}" for a in autosave_appts[:3]
            )
            appts_line = f"\nPróximos agendamentos: {ap_list}."
        merged_line = (
            "\nO sistema encontrou e unificou um cadastro antigo (mesmo CPF/telefone). "
            "Você pode mencionar que 'achou' o cadastro do cliente — sem dizer 'sistema' ou 'merge'."
        ) if autosave_merged_dup else ""

        return f"""Você é {assistant_name}, atendente de petshop ({company_name}) no WhatsApp. Tom: caloroso, próximo, brasileiro, informal sem ser cafona. Sem markdown. Máximo 1 emoji. Frases curtas. Nada de "vou verificar", "deixa eu ver", "retorno em breve".

━━━ STATUS DESTE TURNO ━━━
✅ O cadastro do cliente FOI SALVO COM SUCESSO agora há pouco — você não precisa pedir nenhum dado, não precisa chamar nenhuma tool. Os 4 campos (nome, e-mail, telefone, CPF) estão completos no banco.{merged_line}{pets_line}{appts_line}{pending_block}

━━━ SUA MENSAGEM AGORA ━━━
1. Reconheça o cadastro de forma BREVE e natural (1 frase). Não diga "salvei", "cadastro pronto", "sistema processou" — fale humano. Exemplos bons:
   • "Tudo certinho por aqui!"
   • "Pronto, achei seu cadastro." (se merge_dup)
   • "Tudo certo, achei seu(s) pet(s) aqui." (se merge_dup E pets)
2. **OBRIGATÓRIO** — faça a ponte com a INTENÇÃO PENDENTE acima na mesma mensagem. Não termine sem retomar:
   • Se a intenção é agendamento: "Agora pra fechar o agendamento de {{serviço}} {{data}}, me confirma o horário X?"
   • Se a intenção é cadastro de pet: "Bora cadastrar seu pet agora? Me passa o nome, espécie (cachorro/gato), raça e porte."
   • Se a intenção é cancelar/remarcar: pergunte qual agendamento.
3. NÃO comece com "Perfeito, {{nome}}!" / "Ok, {{nome}}!" / "Beleza, {{nome}}!" — soa robótico. Vá direto à frase útil.
4. NÃO chame `save_identity` (já foi salvo). NÃO chame `parse_personal_data` (não há mais dados pra extrair).
5. Resposta total: 1–3 linhas, no máximo.
"""

    return f"""Você é {assistant_name}, atendente de petshop ({company_name}) no WhatsApp. Tom: caloroso, próximo, brasileiro, informal sem ser cafona. Sem markdown. Use no máximo 1 emoji por resposta. Frases curtas. Nada de "vou verificar", "retorno em breve", "deixa eu ver" — você responde agora.

━━━ POR QUE VOCÊ FOI CHAMADO ━━━
O cliente pediu uma ação que precisa de identificação completa (agendamento, cancelamento, remarcação, cadastro de pet ou similar) e ainda faltam dados pra concluir.{pending_block}

━━━ ESTADO ATUAL DO CADASTRO (já consolidado pelo sistema) ━━━
Dados que JÁ temos: {known}
Dados que faltam: {missing_label}{extra_state_block}

━━━ COMO CONDUZIR ━━━
1. **Nunca repita o que já temos.** Não confirme dados que já existem ("vejo que seu nome é X" → não fale isso). NÃO comece a mensagem com "Perfeito, {{nome}}!" / "Ok, {{nome}}!" / "Beleza, {{nome}}!" — vá direto à informação útil.
2. **Peça apenas o que falta**, em UMA mensagem curta. Não use bloco com labels (Nome:/CPF:/...) — escreva como atendente humana faria. Exemplos:
   • Se falta só CPF: "Pra registrar isso eu só preciso do seu CPF. Pode me passar?"
   • Se falta CPF e e-mail: "Pra concluir, me manda CPF e um e-mail seu, por favor."
   • Se falta tudo: "Pra acertar tudo certinho aqui, me passa nome completo, e-mail, telefone com DDD e CPF, por favor."
3. **Você NÃO precisa chamar nenhuma tool de extração** — o sistema já consolidou tudo que veio nas mensagens anteriores. O bloco "ESTADO ATUAL" reflete a verdade.
4. **CPF inválido**: se o estado mostrar "CPF que o cliente acabou de mandar é INVÁLIDO", explique que os dígitos não batem e peça SÓ o CPF de novo. Não repita pedido dos outros campos.
5. **NUNCA diga "salvei", "cadastro pronto" sem ter visto "STATUS: cadastro foi salvo".** Não invente confirmação.
6. **Cliente questiona POR QUÊ precisa** ("por que CPF?", "é seguro?", "tenho mesmo que cadastrar?"): explique uma vez, curto e honesto: "É pra registrar o agendamento no seu nome e poder consultar histórico depois — fica salvo só no nosso sistema." Depois pergunte de novo se pode seguir.
7. **Cliente RECUSA depois da explicação**, ou está em situação urgente (pet em hotel agora, emergência), ou pede explicitamente humano: chame `escalate_due_to_refusal` com motivo curto. Responda ao cliente: "Sem problema, vou chamar alguém da equipe pra te atender por aqui."

━━━ PROIBIDO ━━━
• Pedir bloco de "Nome: / E-mail: / Telefone: / CPF:" — fala humana, não formulário.
• Repetir dados que já temos.
• Mencionar "migração de plataforma", "recadastro" ou justificativas burocráticas. Se o cliente não perguntou por que, não invente explicação.
• Dizer "vou verificar", "deixa eu ver", "retorno em breve" — você está respondendo agora.
• Inventar pets, agendamentos ou serviços que não vieram em `save_identity`.
• Markdown, emojis em excesso (máx 1), hashtags.
"""
