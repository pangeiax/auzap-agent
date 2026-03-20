export interface User {
  id: number
  email: string
  name: string
  petshop_id: number
  is_active: boolean
  is_superuser: boolean
  created_at: string
  last_login?: string
  petshop_name?: string
  company_plan?: string
}

export interface UserCreate {
  email: string
  name: string
  password: string
  petshop_id: number
}

export interface UserLogin {
  email: string
  password: string
}

export interface Token {
  access_token: string
  token_type: string
  user: User
}

export interface TokenData {
  user_id?: number
  email?: string
}
