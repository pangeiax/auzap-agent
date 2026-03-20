export interface Client {
  id: string
  phone: string
  manualPhone?: string
  name?: string
  email?: string
  company?: string
  source?: string
  marketing_consent?: boolean
  created_at: string
  updated_at: string
  is_active: boolean
  last_message_at?: string
  conversation_stage: string
  kanban_column?: string
  specialty_identified?: string
  professional_preference?: string
  notes?: string
  total_messages?: number
  total_appointments?: number
  total_pets?: number
  total_conversations?: number
  isActive?: boolean
  totalAppointments?: number
  totalPets?: number
  totalConversations?: number
}

export interface ClientCreate {
  phone: string
  manualPhone?: string
  name?: string
  email?: string
  company?: string
  source?: string
  session_id?: string
}

export interface ClientUpdate {
  phone?: string
  manualPhone?: string
  name?: string
  email?: string
  company?: string
  source?: string
  marketing_consent?: boolean
  conversation_stage?: string
  kanban_column?: string
  specialty_identified?: string
  professional_preference?: string
  notes?: string
  is_active?: boolean
  last_message_at?: string
}

export interface ConversationSummary {
  conversation_id: string
  message_count: number
  last_message_at: string
  stage?: string
  specialty_detected?: string
}

export interface ClientDetails {
  client: Client
  conversations: ConversationSummary[]
  recent_appointments: Array<{
    id: string
    professional_name: string
    specialty: string
    scheduled_at: string
    status: string
    price: number
  }>
}

export interface ClientContext {
  redis_context: Record<string, any>
  stage_history: Array<{
    stage: string
    timestamp: string
  }>
  ai_notes: string
  detected_sentiment: string
  urgency_level: string
}

export interface Pet {
  id: string
  name: string
  species?: string
  breed?: string
  age?: number
  birthDate?: string
  birth_date?: string
  size?: string
  weight?: number
  weightKg?: number
  weight_kg?: number
  color?: string
  notes?: string
  is_active?: boolean
  isActive?: boolean
  medical_info?:
    | string
    | {
        notes?: string
        conditions?: string[]
        medications?: string[]
        allergies?: string[]
      }
  vaccination_date?: string
  last_vet_visit?: string
  emergency_contact?: string
  photo_url?: string
  created_at?: string
  updated_at?: string
}

export interface ActivityResponse {
  id: string
  activity_type: string
  description: string
  timestamp: string
  user?: string
  metadata_json?: Record<string, any>
}

export interface ImportError {
  row: number
  message: string
  field?: string
}

export interface ImportResponse {
  imported_count: number
  skipped_count: number
  errors: ImportError[]
}
