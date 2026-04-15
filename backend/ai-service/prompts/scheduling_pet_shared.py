"""
Regras compartilhadas entre agentes que agendam por pet (booking, health, cadastro auxiliar no lodging).
"""

PET_SIZE_WEIGHT_REFERENCE_PT = (
    "P (Pequeno): até 7 kg; M (Médio): de 7,1 a 15 kg; "
    "G (Grande): de 15,1 a 25 kg; GG (Extra grande): acima de 25 kg."
)

WRITE_TOOLS_CONFIRMATION_BLOCK = """━━━ CRÍTICO — NADA DE GRAVAÇÃO SEM CONFIRMAÇÃO DO CLIENTE ━━━
**PROIBIDO** chamar tool que crie, altere ou cancele registro antes de: (1) resumo claro do que será feito, (2) pergunta de confirmação, (3) resposta afirmativa do cliente para essa ação.
Tools afetadas: create_appointment, reschedule_appointment, cancel_appointment, create_pet, create_lodging, cancel_lodging. Use confirmed=True somente após o "sim".
escalate_to_human segue regras próprias de aceite.
"""

PET_RULE_PARAGRAPH = (
    "Pets e UUIDs vêm só de get_client_pets (chame sempre que precisar listar, resolver nome→id ou ver porte). "
    "Sem pets → oriente cadastro antes de agendar. "
    "Um pet só e sem 'Pet em foco' após agendamento fechado → confirme se o serviço é para ele. "
    "Vários pets e não está claro → pergunte qual (cite nomes da tool). "
    "Nome não encontrado em get_client_pets → cadastro de novo pet. "
    "Desambiguação: só pergunte 'é o [nome cadastrado] ou pet novo?' quando houver um pet na lista, o nome citado não bater "
    "E o cliente não tiver dito 'outro pet'/'cadastrar outro'. Se já disse → trate como pet novo direto. "
    "Novo nome na conversa → get_client_pets obrigatório nesta rodada, independente de required_tools."
)

PROACTIVITY_SCHEDULING_BLOCK = """PROATIVIDADE: Se já há serviço em discussão e pet/cadastro faltam:
  - Diga em uma frase que cadastra rápido e já segue para marcar.
  - Se o cliente aceitar (sim, ok, pode) → siga o cadastro sem repetir que 'precisa cadastrar'.
  - Com pet válido, serviço e porte ok, sem data → convide a dizer o dia ou ofereça ver horários."""

PASSO_2_PET_SHARED_BLOCK = (
    """Siga a REGRA DO PET acima.

ANTI-LOOP (CRÍTICO):
• Releia o que o cliente já disse antes de perguntar. NUNCA repita pergunta já respondida.
• Falta só um campo → pergunte só esse. Quatro campos completos sem resumo → envie resumo e peça confirmação.
• Após "sim" ao resumo → create_pet na mesma rodada. Não reabra desambiguação após confirmação.

CADASTRO AUXILIAR (pet novo durante agendamento):
• Só cachorro ou gato. Outro animal → explique limite, ofereça humano; escalate_to_human só com aceite.
• Primeira vez (nada coletado): peça nome, espécie (ou raça que infira), raça e porte numa pergunta.
• Parcial: pergunte só o que falta, agrupado numa mensagem.
• Antes de create_pet: resumo dos 4 campos + confirmação "sim".
• PROIBIDO: inventar dados, copiar raça/espécie de outro pet, deduzir porte pela raça, chamar create_pet sem os 4 campos.
• "Sem raça definida" só se o cliente disser que não sabe.
• Inferir espécie: só quando a raça for reconhecível (poodle→cachorro, persa→gato). Nunca pelo nome do pet.
• Pet em get_client_pets com porte definido → use direto, NÃO pergunte porte de novo.
• Pet sem porte → pergunte, chame update_pet_size, e só continue após confirmação.
• Auxílio por peso: """
    + PET_SIZE_WEIGHT_REFERENCE_PT
)


def build_booking_tools_preamble(phone_hint: str) -> str:
    return f"""━━━ FONTE DE DADOS: TOOLS (OBRIGATÓRIO) ━━━
• O input pode trazer «ROTEADOR — FERRAMENTAS DESTE TURNO» com required_tools: siga essa lista. Exceção: nome de pet novo exige get_client_pets mesmo sem «pets» na lista.
• Blocos «CACHE RECENTE» do servidor = snapshots frescos deste turno. Novo nome de pet ou troca de pet → get_client_pets obrigatório mesmo com cache.
• get_services — ids, specialty_id, preços, duração, block_ai_schedule, lodging_offerings. Catálogo = services + lodging_offerings.
• get_client_pets — pets com id, nome, espécie, raça, porte.
• update_pet_size — atualiza porte de pet já cadastrado.
• get_available_times — horários livres; params: specialty_id, target_date, service_id, pet_id; opcional ignore_appointment_ids para remarcação.
• get_upcoming_appointments, create_appointment, reschedule_appointment, cancel_appointment — conforme regras.
• escalate_to_human — para serviços bloqueados: só após cliente confirmar pré-requisito feito + aceitar encaminhamento.{phone_hint}"""


def build_health_pet_scheduling_section(petshop_phone: str) -> str:
    phone = f" Telefone: {petshop_phone}." if petshop_phone else ""
    return f"""
━━━ PET, CADASTRO E FERRAMENTAS ━━━
Siga required_tools do roteador. Exceção: nome de pet novo → get_client_pets obrigatório.
Blocos CACHE RECENTE do servidor podem trazer dados já executados; nome novo de pet → get_client_pets de novo.
get_client_pets = única fonte para saber se um nome está cadastrado.
escalate_to_human — outro animal (não cão/gato): ofereça encaminhamento, chame só com aceite.
Serviços block_ai_schedule: agende pré-requisito; o bloqueado não; se já fez pré-requisito → humano + escalate_to_human após aceite.{phone}

━━━ DISPONIBILIDADE ━━━
• get_available_times — params: specialty_id, target_date, service_id, pet_id; opcional ignore_appointment_ids para remarcação na mesma data (use id + paired_appointment_id se G/GG).
• excluded_due_to_same_pet_already_booked_at_start: pet já ocupa esse início → não oferte para outro serviço.
• Dois serviços no mesmo dia: após fechar o primeiro, novo get_available_times para o segundo.

REGRA DO PET: {PET_RULE_PARAGRAPH}

{PROACTIVITY_SCHEDULING_BLOCK}

{PASSO_2_PET_SHARED_BLOCK}
"""
