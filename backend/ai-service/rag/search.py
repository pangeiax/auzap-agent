# ─────────────────────────────────────────
# RAG — Busca vetorial
# TODO: implementar busca com pgvector no Supabase
# ─────────────────────────────────────────

# Exemplo de implementação futura:
#
# def search_documents(company_id: int, query_embedding: list[float], top_k: int = 3) -> list:
#     """
#     Busca os documentos mais relevantes para uma query
#     usando similaridade de cosseno via pgvector.
#
#     SELECT content, 1 - (embedding <=> %s::vector) AS similarity
#     FROM knowledge_base
#     WHERE company_id = %s
#     ORDER BY embedding <=> %s::vector
#     LIMIT %s
#     """
#     pass
