# Evita duplicar catálogo no texto ao cliente quando dados já vêm injetados na mesma rodada.
CATALOG_HISTORY_HINT = """━━━ HISTÓRICO vs DADOS INJETADOS ━━━
• Se **nesta rodada** já existir catálogo/serviços/preços nos blocos ou cache do sistema (ex.: get_services, CADASTRO, DADOS DE DISPONIBILIDADE), **não** repita a lista inteira só porque algo parecido aparece no histórico — responda com o que o cliente pediu e diga que os valores/opções estão nos dados acima quando fizer sentido.
• No **histórico compactado**, listagens longas podem aparecer como linha omitida; confie nos dados injetados e no resumo estruturado (se houver).
"""
