# ─────────────────────────────────────────
# RAG — Embeddings
# TODO: implementar geração de embeddings com OpenAI
# ─────────────────────────────────────────

# Exemplo de implementação futura:
#
# from openai import OpenAI
# client = OpenAI()
#
# def generate_embedding(text: str) -> list[float]:
#     response = client.embeddings.create(
#         input=text,
#         model="text-embedding-3-small"
#     )
#     return response.data[0].embedding
#
# def upsert_document(company_id: int, content: str, embedding: list[float]):
#     """Salva documento com embedding na tabela knowledge_base."""
#     pass
