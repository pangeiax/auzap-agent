def search_knowledge_base(company_id: int, query: str) -> dict:
    """
    Busca documentos relevantes na base de conhecimento do petshop.
    TODO: implementar busca vetorial com embeddings (RAG)

    Por enquanto retorna resposta vazia para o agente lidar com contexto base.
    """
    # Futuramente:
    # 1. Gerar embedding da query
    # 2. Buscar na tabela knowledge_base WHERE company_id = X via pgvector
    # 3. Retornar top-k documentos mais relevantes

    return {
        "found": False,
        "documents": [],
        "message": "Base de conhecimento ainda não configurada para este petshop.",
    }
