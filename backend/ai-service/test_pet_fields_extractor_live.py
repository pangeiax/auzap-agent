"""
Teste live do extrator LLM de campos do pet em context_guard.
Reproduz o caso real da Kira: "Porte P 5kg" estava passando batido pelo regex.
"""

from __future__ import annotations

import asyncio

from agents.context_guard import _llm_extract_pet_fields


CASES = [
    # (descrição, history, current_user_message, router_ctx, expected_subset)
    (
        "Kira — nome + espécie + porte na primeira mensagem (P e 5kg)",
        [{"role": "assistant", "content": "Qual o nome, espécie, raça e porte do seu pet?"}],
        "Nome: kira\nCachorro \nPorte P 5kg",
        None,
        {"nome", "espécie", "porte"},
    ),
    (
        "Kira — completa com SRD, agora tem todos os campos",
        [
            {"role": "assistant", "content": "Qual o nome, espécie, raça e porte?"},
            {"role": "user", "content": "Nome: kira\nCachorro\nPorte P 5kg"},
            {"role": "assistant", "content": "Certo — falta só a raça do seu cachorro kira. Qual é a raça? Se não souber, pode responder 'Sem raça definida'."},
        ],
        "Srd",
        None,
        {"nome", "espécie", "raça", "porte"},
    ),
    (
        "Shih tzu porte M — raça implica espécie",
        [{"role": "assistant", "content": "Qual o pet?"}],
        "Shih Tzu, porte M, chamado Thor, 10kg",
        None,
        {"nome", "espécie", "raça", "porte"},
    ),
    (
        "Só nome",
        [{"role": "assistant", "content": "Nome?"}],
        "Joca",
        None,
        {"nome"},
    ),
    (
        "Apenas peso implica porte",
        [{"role": "assistant", "content": "Qual o porte?"}],
        "12kg",
        None,
        {"porte"},
    ),
    (
        "Porte GG",
        [{"role": "assistant", "content": "Qual o porte?"}],
        "GG",
        None,
        {"porte"},
    ),
    (
        "Nada ainda — só saudação",
        [{"role": "assistant", "content": "Olá!"}],
        "oi tudo bem?",
        None,
        set(),
    ),
]


async def main() -> int:
    failures = 0
    for desc, history, current, router_ctx, expected in CASES:
        got = await _llm_extract_pet_fields(
            history=history,
            current_user_message=current,
            router_ctx=router_ctx,
            company_id=None,
        )
        ok = got is not None and expected.issubset(got)
        # Para conjuntos esperados vazios, exigimos exato.
        if not expected:
            ok = got == set()
        failures += 0 if ok else 1
        status = "OK" if ok else "FAIL"
        print(f"[{status}] {desc}")
        print(f"    expected(subset)={expected} got={got}")

    total = len(CASES)
    print(f"\n{total - failures}/{total} passaram | {failures} falhas")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
