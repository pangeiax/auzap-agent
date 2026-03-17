const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000'

interface AgentRequest {
  company_id: number
  client_phone: string
  message: string
  image_base64?: string
}

interface AgentResponse {
  reply: string
  agent_used: string
  stage?: string
}

export async function runAgent(
  companyId: number,
  clientPhone: string,
  message: string,
  imageBase64?: string
): Promise<AgentResponse> {
  const body: AgentRequest = {
    company_id: companyId,
    client_phone: clientPhone,
    message,
    ...(imageBase64 ? { image_base64: imageBase64 } : {}),
  }

  const response = await fetch(`${AI_SERVICE_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`[AgentService] Erro ao chamar ai-service: ${error}`)
  }

  return response.json() as Promise<AgentResponse>
}
