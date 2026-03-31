def get_max_tokens_param(model_id: str, value: int) -> dict:
    """Retorna o parâmetro correto de limite de tokens conforme a família do modelo."""
    if str(model_id).startswith("gpt-5"):
        return {"max_completion_tokens": value}
    return {"max_tokens": value}
