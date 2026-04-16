interface EmailPayload {
  type: 'petshop_created' | 'password_changed' | 'email_changed'
  petshopName: string
  userName: string
  userEmail: string
  userPassword?: string
  newPassword?: string
  oldEmail?: string
}

const NOTIFY_EMAIL = process.env.DEV_TOOLS_NOTIFY_EMAIL || ''
const SMTP_HOST = process.env.SMTP_HOST || ''
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587')
const SMTP_USER = process.env.SMTP_USER || ''
const SMTP_PASS = process.env.SMTP_PASS || ''

export async function sendDevToolsEmail(payload: EmailPayload): Promise<void> {
  if (!NOTIFY_EMAIL || !SMTP_HOST) {
    console.log(`[DevTools:Email] SMTP não configurado. Log da notificação:`)
    console.log(`  Tipo: ${payload.type}`)
    console.log(`  Petshop: ${payload.petshopName}`)
    console.log(`  Usuário: ${payload.userName} (${payload.userEmail})`)
    if (payload.userPassword) console.log(`  Senha: ${payload.userPassword}`)
    if (payload.newPassword) console.log(`  Nova senha: ${payload.newPassword}`)
    if (payload.oldEmail) console.log(`  Email anterior: ${payload.oldEmail}`)
    return
  }

  try {
    // Lazy require — nodemailer é opcional
    // @ts-ignore
    const nodemailer = require('nodemailer')

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })

    const { subject, html } = buildEmailContent(payload)

    await transporter.sendMail({
      from: SMTP_USER,
      to: NOTIFY_EMAIL,
      subject,
      html,
    })

    console.log(`[DevTools:Email] Notificação enviada para ${NOTIFY_EMAIL} (${payload.type})`)
  } catch (err) {
    console.error('[DevTools:Email] Falha ao enviar email:', err)
  }
}

function buildEmailContent(payload: EmailPayload): { subject: string; html: string } {
  switch (payload.type) {
    case 'petshop_created':
      return {
        subject: `[Auzap] Novo petshop criado: ${payload.petshopName}`,
        html: `
          <h2>Novo Petshop Criado</h2>
          <table style="border-collapse:collapse;">
            <tr><td style="padding:4px 12px;font-weight:bold;">Petshop:</td><td style="padding:4px 12px;">${payload.petshopName}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:bold;">Usuário:</td><td style="padding:4px 12px;">${payload.userName}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:bold;">Email:</td><td style="padding:4px 12px;">${payload.userEmail}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:bold;">Senha:</td><td style="padding:4px 12px;"><code>${payload.userPassword}</code></td></tr>
          </table>
        `,
      }

    case 'password_changed':
      return {
        subject: `[Auzap] Senha alterada: ${payload.userName} (${payload.petshopName})`,
        html: `
          <h2>Senha Alterada</h2>
          <table style="border-collapse:collapse;">
            <tr><td style="padding:4px 12px;font-weight:bold;">Petshop:</td><td style="padding:4px 12px;">${payload.petshopName}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:bold;">Usuário:</td><td style="padding:4px 12px;">${payload.userName}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:bold;">Email:</td><td style="padding:4px 12px;">${payload.userEmail}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:bold;">Nova senha:</td><td style="padding:4px 12px;"><code>${payload.newPassword}</code></td></tr>
          </table>
        `,
      }

    case 'email_changed':
      return {
        subject: `[Auzap] Email alterado: ${payload.userName} (${payload.petshopName})`,
        html: `
          <h2>Email Alterado</h2>
          <table style="border-collapse:collapse;">
            <tr><td style="padding:4px 12px;font-weight:bold;">Petshop:</td><td style="padding:4px 12px;">${payload.petshopName}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:bold;">Usuário:</td><td style="padding:4px 12px;">${payload.userName}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:bold;">Email anterior:</td><td style="padding:4px 12px;">${payload.oldEmail}</td></tr>
            <tr><td style="padding:4px 12px;font-weight:bold;">Novo email:</td><td style="padding:4px 12px;">${payload.userEmail}</td></tr>
          </table>
        `,
      }
  }
}
