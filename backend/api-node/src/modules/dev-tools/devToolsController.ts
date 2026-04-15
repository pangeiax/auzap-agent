import { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'
import { sendDevToolsEmail } from './devToolsEmail'

// ─────────────────────────────────────────
// GET /dev-tools/petshops — Lista todos os petshops + usuários
// ─────────────────────────────────────────
export async function listPetshops(_req: Request, res: Response) {
  try {
    const companies = await prisma.saasCompany.findMany({
      orderBy: { id: 'desc' },
      include: {
        users: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            createdAt: true,
            lastLogin: true,
          },
        },
        petshopProfile: {
          select: {
            id: true,
            phone: true,
            isActive: true,
            assistantName: true,
          },
        },
      },
    })

    return res.json(companies)
  } catch (err) {
    console.error('[DevTools] Erro ao listar petshops:', err)
    return res.status(500).json({ error: 'Erro ao listar petshops.' })
  }
}

// ─────────────────────────────────────────
// POST /dev-tools/petshops — Cria petshop fake (company + user + profile)
// ─────────────────────────────────────────
export async function createPetshop(req: Request, res: Response) {
  try {
    const {
      companyName,
      companySlug,
      companyPlan = 'pro',
      userName,
      userEmail,
      userPassword,
      userRole = 'owner',
      phone = '(00) 00000-0000',
    } = req.body

    if (!companyName || !companySlug || !userName || !userEmail || !userPassword) {
      return res.status(400).json({
        error: 'Campos obrigatórios: companyName, companySlug, userName, userEmail, userPassword',
      })
    }

    // Verifica duplicidades
    const existingSlug = await prisma.saasCompany.findUnique({ where: { slug: companySlug } })
    if (existingSlug) {
      return res.status(409).json({ error: `Slug "${companySlug}" já existe.` })
    }

    const existingEmail = await prisma.saasUser.findUnique({ where: { email: userEmail } })
    if (existingEmail) {
      return res.status(409).json({ error: `Email "${userEmail}" já está em uso.` })
    }

    const hashedPassword = await bcrypt.hash(userPassword, 10)

    const company = await prisma.saasCompany.create({
      data: {
        name: companyName,
        slug: companySlug,
        plan: companyPlan,
        isActive: true,
        users: {
          create: {
            email: userEmail,
            name: userName,
            hashedPassword,
            role: userRole,
            isActive: true,
          },
        },
        petshopProfile: {
          create: {
            phone,
            isActive: true,
          },
        },
      },
      include: {
        users: { select: { id: true, name: true, email: true, role: true } },
        petshopProfile: { select: { id: true, phone: true } },
      },
    })

    // Envia email de notificação
    await sendDevToolsEmail({
      type: 'petshop_created',
      petshopName: companyName,
      userName,
      userEmail,
      userPassword,
    })

    console.log(`[DevTools] Petshop criado: company_id=${company.id} | ${companyName} | ${userEmail}`)
    return res.status(201).json(company)
  } catch (err) {
    console.error('[DevTools] Erro ao criar petshop:', err)
    return res.status(500).json({ error: 'Erro ao criar petshop.' })
  }
}

// ─────────────────────────────────────────
// PATCH /dev-tools/users/:id/password — Altera senha do usuário
// ─────────────────────────────────────────
export async function updateUserPassword(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.id)
    const { newPassword } = req.body

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres.' })
    }

    const user = await prisma.saasUser.findUnique({
      where: { id: userId },
      include: { company: { select: { name: true } } },
    })

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' })
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10)
    await prisma.saasUser.update({
      where: { id: userId },
      data: { hashedPassword },
    })

    await sendDevToolsEmail({
      type: 'password_changed',
      petshopName: user.company.name,
      userName: user.name,
      userEmail: user.email,
      newPassword,
    })

    console.log(`[DevTools] Senha alterada para user_id=${userId} (${user.email})`)
    return res.json({ success: true })
  } catch (err) {
    console.error('[DevTools] Erro ao alterar senha:', err)
    return res.status(500).json({ error: 'Erro ao alterar senha.' })
  }
}

// ─────────────────────────────────────────
// PATCH /dev-tools/users/:id/email — Altera email do usuário
// ─────────────────────────────────────────
export async function updateUserEmail(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.id)
    const { newEmail } = req.body

    if (!newEmail) {
      return res.status(400).json({ error: 'Email obrigatório.' })
    }

    const user = await prisma.saasUser.findUnique({
      where: { id: userId },
      include: { company: { select: { name: true } } },
    })

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' })
    }

    const existingEmail = await prisma.saasUser.findUnique({ where: { email: newEmail } })
    if (existingEmail && existingEmail.id !== userId) {
      return res.status(409).json({ error: `Email "${newEmail}" já está em uso.` })
    }

    const oldEmail = user.email

    await prisma.saasUser.update({
      where: { id: userId },
      data: { email: newEmail },
    })

    await sendDevToolsEmail({
      type: 'email_changed',
      petshopName: user.company.name,
      userName: user.name,
      userEmail: newEmail,
      oldEmail,
    })

    console.log(`[DevTools] Email alterado para user_id=${userId}: ${oldEmail} → ${newEmail}`)
    return res.json({ success: true })
  } catch (err) {
    console.error('[DevTools] Erro ao alterar email:', err)
    return res.status(500).json({ error: 'Erro ao alterar email.' })
  }
}
