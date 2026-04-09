import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../../lib/prisma'
import type { JwtPayload } from '../../middleware/authMiddleware'
import {
  assertValidCpfOrThrow,
  parseOptionalCpf,
} from '../../lib/cpf'

const JWT_SECRET = process.env.JWT_SECRET || 'secret'
const JWT_EXPIRES = '7d'

function generateToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES })
}

function formatUser(user: any, companyId: number, companyName?: string, companyPlan?: string | null) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    cpf: user.cpf ?? undefined,
    petshop_id: companyId,
    is_active: user.isActive ?? true,
    is_superuser: user.isSuperuser ?? false,
    created_at: user.createdAt?.toISOString() ?? new Date().toISOString(),
    last_login: user.lastLogin?.toISOString() ?? null,
    petshop_name: companyName,
    company_plan: companyPlan ?? 'free',
  }
}

// POST /auth/login
export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' })
    }

    const user = await prisma.saasUser.findUnique({ where: { email } })
    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' })
    }

    const valid = await bcrypt.compare(password, user.hashedPassword)
    if (!valid) {
      return res.status(401).json({ error: 'Credenciais inválidas' })
    }

    await prisma.saasUser.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    })

    const company = await prisma.saasCompany.findUnique({ where: { id: user.companyId } })

    const payload: JwtPayload = {
      userId: user.id,
      companyId: user.companyId,
      email: user.email,
      role: user.role || 'staff',
    }

    const access_token = generateToken(payload)

    return res.json({
      access_token,
      token_type: 'bearer',
      user: formatUser(user, user.companyId, company?.name, company?.plan),
    })
  } catch (err) {
    console.error('[Auth] Erro no login:', err)
    return res.status(500).json({ error: 'Erro interno do servidor' })
  }
}

// POST /auth/register
export async function register(req: Request, res: Response) {
  try {
    const { email, name, password, company_name, cpf: cpfBody } = req.body
    if (!email || !name || !password) {
      return res.status(400).json({ error: 'Email, nome e senha são obrigatórios' })
    }

    let cpfDigits: string | null = null
    if (cpfBody !== undefined && cpfBody !== null && String(cpfBody).trim() !== '') {
      cpfDigits = parseOptionalCpf(cpfBody)
      if (!cpfDigits) {
        return res.status(400).json({ error: 'CPF inválido' })
      }
      try {
        assertValidCpfOrThrow(cpfDigits)
      } catch {
        return res.status(400).json({ error: 'CPF inválido' })
      }
    }

    const existing = await prisma.saasUser.findUnique({ where: { email } })
    if (existing) {
      return res.status(409).json({ error: 'Email já cadastrado' })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const slug =
      (company_name || name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 80) +
      '-' +
      Date.now()

    const result = await prisma.$transaction(async (tx) => {
      const company = await tx.saasCompany.create({
        data: { name: company_name || name, slug, plan: 'free' },
      })

      if (cpfDigits) {
        const dup = await tx.saasUser.findFirst({
          where: { companyId: company.id, cpf: cpfDigits },
        })
        if (dup) {
          throw Object.assign(new Error('CPF já cadastrado nesta empresa'), {
            code: 'CPF_DUPLICATE',
          })
        }
      }

      const user = await tx.saasUser.create({
        data: {
          companyId: company.id,
          email,
          name,
          hashedPassword,
          role: 'owner',
          ...(cpfDigits ? { cpf: cpfDigits } : {}),
        },
      })

      await tx.petshopProfile.create({
        data: { companyId: company.id, phone: '', assistantName: 'Assistente' },
      })

      return { user, company }
    })

    return res.status(201).json(formatUser(result.user, result.company.id, result.company.name, result.company.plan))
  } catch (err: any) {
    console.error('[Auth] Erro no registro:', err)
    if (err?.code === 'CPF_DUPLICATE') {
      return res.status(409).json({ error: 'CPF já cadastrado nesta empresa' })
    }
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: 'CPF já cadastrado nesta empresa' })
    }
    return res.status(500).json({ error: 'Erro interno do servidor' })
  }
}

// GET /auth/me
export async function me(req: Request, res: Response) {
  try {
    const user = await prisma.saasUser.findUnique({ where: { id: req.user!.userId } })
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' })

    const company = await prisma.saasCompany.findUnique({ where: { id: user.companyId } })

    return res.json(formatUser(user, user.companyId, company?.name, company?.plan))
  } catch (err) {
    console.error('[Auth] Erro ao buscar usuário:', err)
    return res.status(500).json({ error: 'Erro interno do servidor' })
  }
}

// POST /auth/refresh
export async function refreshToken(req: Request, res: Response) {
  try {
    const { userId, companyId, email, role } = req.user!
    const access_token = generateToken({ userId, companyId, email, role })

    const user = await prisma.saasUser.findUnique({ where: { id: userId } })
    const company = user
      ? await prisma.saasCompany.findUnique({ where: { id: companyId } })
      : null

    return res.json({
      access_token,
      token_type: 'bearer',
      user: user ? formatUser(user, companyId, company?.name, company?.plan) : null,
    })
  } catch (err) {
    return res.status(500).json({ error: 'Erro interno do servidor' })
  }
}
