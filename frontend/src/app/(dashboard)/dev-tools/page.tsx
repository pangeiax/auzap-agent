import { useState, useEffect, useCallback } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Input } from '@/components/atoms/Input'
import { Button } from '@/components/atoms/Button'
import { devToolsService, type DevToolsCompany, type CreatePetshopPayload } from '@/services/devToolsService'
import { Plus, KeyRound, Mail, Eye, EyeOff, Store, Users, ChevronDown, ChevronUp, ArrowLeft } from 'lucide-react'

// ── Create Petshop Modal ──
function CreatePetshopModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreatePetshopPayload>({
    companyName: '',
    companySlug: '',
    companyPlan: 'pro',
    userName: '',
    userEmail: '',
    userPassword: '',
    userRole: 'owner',
    phone: '(00) 00000-0000',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
    setForm(f => ({ ...f, companyName: name, companySlug: slug }))
  }

  const handleSubmit = async () => {
    setError('')
    if (!form.companyName || !form.userName || !form.userEmail || !form.userPassword) {
      setError('Preencha todos os campos obrigatórios.')
      return
    }
    setLoading(true)
    try {
      await devToolsService.createPetshop(form)
      onCreated()
      onClose()
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao criar petshop.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl dark:bg-[#1E2028]"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-[#202026] dark:text-white">Criar Petshop</h2>

        <div className="space-y-3">
          <Input label="Nome do Petshop *" value={form.companyName} onChange={e => handleNameChange(e.target.value)} />
          <Input label="Slug" value={form.companySlug} onChange={e => setForm(f => ({ ...f, companySlug: e.target.value }))} />

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">Plano</label>
              <select
                className="h-[47px] w-full rounded-[4px] border border-[#E1E5EB] bg-white px-3 text-sm text-[#434A57] dark:border-[#40485A] dark:bg-[#272A34] dark:text-[#f5f9fc]"
                value={form.companyPlan}
                onChange={e => setForm(f => ({ ...f, companyPlan: e.target.value }))}
              >
                <option value="free">Free</option>
                <option value="pro">Pro</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-sm font-semibold text-[#434A57] dark:text-[#f5f9fc]">Role</label>
              <select
                className="h-[47px] w-full rounded-[4px] border border-[#E1E5EB] bg-white px-3 text-sm text-[#434A57] dark:border-[#40485A] dark:bg-[#272A34] dark:text-[#f5f9fc]"
                value={form.userRole}
                onChange={e => setForm(f => ({ ...f, userRole: e.target.value }))}
              >
                <option value="owner">Owner</option>
                <option value="staff">Staff</option>
              </select>
            </div>
          </div>

          <Input label="Nome do Usuário *" value={form.userName} onChange={e => setForm(f => ({ ...f, userName: e.target.value }))} />
          <Input label="Email *" type="email" value={form.userEmail} onChange={e => setForm(f => ({ ...f, userEmail: e.target.value }))} />
          <Input label="Senha *" type="password" value={form.userPassword} onChange={e => setForm(f => ({ ...f, userPassword: e.target.value }))} />
          <Input label="Telefone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
        </div>

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Criando...' : 'Criar Petshop'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── User Row (inline edit password/email) ──
function UserRow({ user, petshopName, onUpdated }: {
  user: DevToolsCompany['users'][number]
  petshopName: string
  onUpdated: () => void
}) {
  const [editingPassword, setEditingPassword] = useState(false)
  const [editingEmail, setEditingEmail] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [newEmail, setNewEmail] = useState(user.email)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState('')

  const savePassword = async () => {
    if (!newPassword || newPassword.length < 6) { setMsg('Min. 6 caracteres'); return }
    setLoading(true)
    try {
      await devToolsService.updatePassword(user.id, newPassword)
      setMsg('Senha alterada!')
      setEditingPassword(false)
      setNewPassword('')
      onUpdated()
    } catch (err: any) {
      setMsg(err.response?.data?.error || 'Erro')
    } finally {
      setLoading(false)
      setTimeout(() => setMsg(''), 3000)
    }
  }

  const saveEmail = async () => {
    if (!newEmail) { setMsg('Email obrigatório'); return }
    setLoading(true)
    try {
      await devToolsService.updateEmail(user.id, newEmail)
      setMsg('Email alterado!')
      setEditingEmail(false)
      onUpdated()
    } catch (err: any) {
      setMsg(err.response?.data?.error || 'Erro')
    } finally {
      setLoading(false)
      setTimeout(() => setMsg(''), 3000)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[#E1E5EB] bg-white p-3 dark:border-[#40485A] dark:bg-[#272A34]">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-[#202026] dark:text-white">{user.name}</span>
          <span className="ml-2 rounded bg-[#1E62EC]/10 px-2 py-0.5 text-xs font-medium text-[#1E62EC]">{user.role}</span>
          {user.isActive === false && (
            <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-xs text-red-600">Inativo</span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => { setEditingEmail(!editingEmail); setEditingPassword(false) }}
            className="rounded p-1.5 text-[#727B8E] hover:bg-gray-100 dark:hover:bg-[#1E2028]"
            title="Alterar email"
          >
            <Mail size={16} />
          </button>
          <button
            onClick={() => { setEditingPassword(!editingPassword); setEditingEmail(false) }}
            className="rounded p-1.5 text-[#727B8E] hover:bg-gray-100 dark:hover:bg-[#1E2028]"
            title="Alterar senha"
          >
            <KeyRound size={16} />
          </button>
        </div>
      </div>

      <p className="text-sm text-[#727B8E]">{user.email}</p>

      {editingPassword && (
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Nova senha (min. 6)"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="h-9 w-full rounded border border-[#E1E5EB] bg-white px-3 pr-9 text-sm dark:border-[#40485A] dark:bg-[#1E2028] dark:text-white"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#727B8E]"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <Button size="sm" onClick={savePassword} disabled={loading} className="h-9">
            {loading ? '...' : 'Salvar'}
          </Button>
        </div>
      )}

      {editingEmail && (
        <div className="flex items-end gap-2">
          <input
            type="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            className="h-9 flex-1 rounded border border-[#E1E5EB] bg-white px-3 text-sm dark:border-[#40485A] dark:bg-[#1E2028] dark:text-white"
          />
          <Button size="sm" onClick={saveEmail} disabled={loading} className="h-9">
            {loading ? '...' : 'Salvar'}
          </Button>
        </div>
      )}

      {msg && <p className="text-xs text-[#1E62EC]">{msg}</p>}
    </div>
  )
}

// ── Petshop Card (collapsible) ──
function PetshopCard({ company, onUpdated }: { company: DevToolsCompany; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-[#E1E5EB] bg-[#FAFAFA] dark:border-[#40485A] dark:bg-[#1E2028]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#1E62EC]/10">
            <Store size={20} className="text-[#1E62EC]" />
          </div>
          <div>
            <p className="font-semibold text-[#202026] dark:text-white">{company.name}</p>
            <p className="text-xs text-[#727B8E]">
              ID: {company.id} | Slug: {company.slug} | Plano: {company.plan ?? 'free'}
              {company.petshopProfile?.phone ? ` | Tel: ${company.petshopProfile.phone}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-[#727B8E]">
            <Users size={14} /> {company.users.length}
          </span>
          {open ? <ChevronUp size={18} className="text-[#727B8E]" /> : <ChevronDown size={18} className="text-[#727B8E]" />}
        </div>
      </button>

      {open && (
        <div className="space-y-2 border-t border-[#E1E5EB] p-4 dark:border-[#40485A]">
          {company.users.length === 0 && (
            <p className="text-sm text-[#727B8E]">Nenhum usuário.</p>
          )}
          {company.users.map(user => (
            <UserRow key={user.id} user={user} petshopName={company.name} onUpdated={onUpdated} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Page ──
export default function DevToolsPage() {
  const navigate = useNavigate()
  const hasKey = typeof window !== 'undefined' && !!localStorage.getItem('dev-tool')

  const [companies, setCompanies] = useState<DevToolsCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await devToolsService.listPetshops()
      setCompanies(data)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erro ao carregar dados.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (hasKey) fetchData() }, [fetchData, hasKey])

  if (!hasKey) return <Navigate to="/login" replace />

  const filtered = companies.filter(c => {
    const q = search.toLowerCase()
    return (
      c.name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      c.users.some(u => u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q))
    )
  })

  return (
    <div className="min-h-screen bg-[#F4F6F9] dark:bg-[#272A34]">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="mx-auto max-w-4xl p-6"
      >
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/login')}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-[#727B8E] hover:bg-white dark:hover:bg-[#1E2028]"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-[#202026] dark:text-white">Dev Tools</h1>
              <p className="text-sm text-[#727B8E]">Gerenciar petshops e usuários</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowModal(true)}>
            <Plus size={16} /> Criar Petshop
          </Button>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Buscar por nome, slug ou email..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 w-full rounded-md border border-[#E1E5EB] bg-white px-4 text-sm text-[#434A57] placeholder:text-[#727B8E] dark:border-[#40485A] dark:bg-[#272A34] dark:text-white"
          />
        </div>

        {/* Content */}
        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1E62EC] border-t-transparent" />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-[#727B8E]">{filtered.length} petshop(s) encontrado(s)</p>
            {filtered.map(company => (
              <PetshopCard key={company.id} company={company} onUpdated={fetchData} />
            ))}
          </div>
        )}

        {showModal && (
          <CreatePetshopModal onClose={() => setShowModal(false)} onCreated={fetchData} />
        )}
      </motion.div>
    </div>
  )
}
