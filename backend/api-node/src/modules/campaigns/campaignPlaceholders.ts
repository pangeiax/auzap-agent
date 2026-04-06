/**
 * Substitui tokens legados no texto (campanhas antigas). Novos rascunhos não devem usar placeholders;
 * o nome do tutor já entra aqui se ainda houver token antigo no template.
 */
export function applyCampaignTemplate(text: string, nomeCliente: string): string {
  const nm = nomeCliente.trim() || 'Cliente'
  return text
    .replace(/\{\{\s*nome_cliente\s*\}\}/gi, nm)
    .replace(/\{\{\s*nome\s*\}\}/gi, nm)
}
