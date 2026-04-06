import type { Select } from 'node-sql-parser'

/**
 * Política de tenant no AST (complementa heurísticas em sqlValidator).
 *
 * Regras principais:
 * - WHERE: como antes — basta um `company_id = tenant` em algum ramo AND (ou ambos os lados de OR seguros).
 * - Alternativa segura: cada alias de tabela **permitida** no FROM precisa aparecer em
 *   `alias.company_id = tenant` (qualificado) num conjunto **só-AND** (sem OR no topo da expressão)
 *   no WHERE **ou** no ON de um **INNER** JOIN (JOIN sem LEFT/RIGHT/FULL/CROSS).
 * - LEFT/RIGHT/FULL/CROSS: o ON **não** conta para cobertura — evita linhas preservadas sem filtro de tenant.
 * - HAVING: não substitui WHERE/ON para cobertura; `illegalCompanyIdPredicateMessage` continua aplicável.
 */

function unwrapCteStmt(stmt: unknown): Select | null {
  if (!stmt || typeof stmt !== 'object') return null
  const s = stmt as { type?: string; ast?: Select }
  if (s.type === 'select') return s as Select
  if (s.ast?.type === 'select') return s.ast
  return null
}

function cteName(w: { name?: { value?: string; type?: string } | string }): string {
  const n = w.name
  if (typeof n === 'string') return n.toLowerCase()
  if (n && typeof n === 'object' && n.value != null) return String(n.value).toLowerCase()
  return ''
}

function columnName(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const n = node as { type?: string; column?: { expr?: { value?: unknown } } | string }
  if (n.type !== 'column_ref') return null
  const c = n.column
  if (typeof c === 'string') return c.toLowerCase()
  const v = c && typeof c === 'object' && c.expr && typeof c.expr === 'object' && 'value' in c.expr! ? (c.expr as { value: unknown }).value : null
  return v != null ? String(v).toLowerCase() : null
}

function literalNumberOrString(node: unknown): string | null {
  if (node == null || typeof node !== 'object') return null
  const n = node as { type?: string; value?: unknown }
  if (n.type === 'number' && n.value != null) return String(n.value)
  if (
    n.type === 'single_quote_string' ||
    n.type === 'double_quote_string' ||
    n.type === 'default' ||
    n.type === 'bool' ||
    n.type === 'boolean'
  ) {
    return String(n.value)
  }
  return null
}

function literalMatchesCompanyId(node: unknown, companyId: number): boolean {
  const s = literalNumberOrString(node)
  if (s === null) return false
  return Number(s) === companyId || s === String(companyId)
}

/** Nome da coluna (ex.: company_id) em column_ref, com suporte a column.expr.value. */
function columnRefColumnName(node: unknown): string | null {
  return columnName(node)
}

/** Alias da tabela em column_ref (ex.: pa); null se não qualificado. */
function columnRefTableAlias(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null
  const n = node as { type?: string; table?: string | null }
  if (n.type !== 'column_ref' || n.table == null || String(n.table).trim() === '') return null
  return String(n.table).toLowerCase()
}

function isCompanyIdEquality(node: unknown, companyId: number): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as { type?: string; operator?: string; left?: unknown; right?: unknown }
  if (n.type !== 'binary_expr') return false
  const op = String(n.operator).toUpperCase()
  if (op === '=' || op === '==') {
    return columnRefColumnName(n.left) === 'company_id' && literalMatchesCompanyId(n.right, companyId)
  }
  if (op === 'IN') {
    if (columnRefColumnName(n.left) !== 'company_id') return false
    const right = n.right as { type?: string; value?: unknown[] }
    if (!right || right.type !== 'expr_list' || !Array.isArray(right.value)) return false
    if (right.value.length !== 1) return false
    return literalMatchesCompanyId(right.value[0], companyId)
  }
  return false
}

/** Igual a isCompanyIdEquality, mas exige tabela qualificada (pa.company_id = N). */
function isQualifiedCompanyIdEquality(node: unknown, companyId: number): boolean {
  if (!isCompanyIdEquality(node, companyId)) return false
  const n = node as { left?: unknown }
  return columnRefTableAlias(n.left) != null
}

function isOrNode(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as { type?: string; operator?: string }
  return n.type === 'binary_expr' && String(n.operator).toUpperCase() === 'OR'
}

function flattenAndConjuncts(node: unknown): unknown[] {
  if (node == null) return []
  const n = node as { type?: string; operator?: string; left?: unknown; right?: unknown }
  if (n.type === 'binary_expr' && String(n.operator).toUpperCase() === 'AND') {
    return [...flattenAndConjuncts(n.left), ...flattenAndConjuncts(n.right)]
  }
  return [node]
}

/** WHERE deve implicar isolamento ao tenant: em ramos OR cada lado precisa ser seguro; em AND basta um `company_id = <tenant>`. */
export function isWhereTenantSafe(where: unknown, companyId: number): boolean {
  if (where == null) return false
  if (isOrNode(where)) {
    const w = where as { left: unknown; right: unknown }
    return isWhereTenantSafe(w.left, companyId) && isWhereTenantSafe(w.right, companyId)
  }
  for (const t of flattenAndConjuncts(where)) {
    if (isCompanyIdEquality(t, companyId)) return true
    if (isOrNode(t)) {
      const o = t as { left: unknown; right: unknown }
      if (!(isWhereTenantSafe(o.left, companyId) && isWhereTenantSafe(o.right, companyId))) return false
    }
  }
  return false
}

function walkExpr(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (node == null || typeof node !== 'object') return
  const n = node as Record<string, unknown>
  visit(n)
  if ('left' in n && n.left) walkExpr(n.left, visit)
  if ('right' in n && n.right) walkExpr(n.right, visit)
  if (n.type === 'expr_list' && Array.isArray(n.value)) {
    for (const x of n.value as unknown[]) walkExpr(x, visit)
  }
  if (n.type === 'case' && Array.isArray(n.args)) {
    for (const br of n.args as { cond?: unknown; result?: unknown }[]) {
      if (br.cond) walkExpr(br.cond, visit)
      if (br.result) walkExpr(br.result, visit)
    }
  }
}

/** `a.company_id = b.company_id` em JOIN (mesmo tenant por linha); não usa literal — é seguro e comum. */
function isQualifiedCompanyIdToCompanyIdEquality(n: { left?: unknown; right?: unknown }): boolean {
  if (columnRefColumnName(n.left) !== 'company_id' || columnRefColumnName(n.right) !== 'company_id') return false
  return columnRefTableAlias(n.left) != null && columnRefTableAlias(n.right) != null
}

/** Bloqueia `company_id <> …`, `LIKE`, subqueries em comparação com company_id, etc. */
export function illegalCompanyIdPredicateMessage(where: unknown, companyId: number): string | null {
  if (where == null) return null
  let bad: string | null = null
  walkExpr(where, (n) => {
    if (bad || n.type !== 'binary_expr') return
    const op = String(n.operator).toUpperCase()
    const leftName = columnRefColumnName(n.left)
    if (leftName !== 'company_id') return
    if (op === '=' || op === '==') {
      if (isQualifiedCompanyIdToCompanyIdEquality(n as { left?: unknown; right?: unknown })) return
      if (!literalMatchesCompanyId(n.right, companyId)) {
        bad = `company_id deve ser igual a ${companyId} nesta consulta.`
      }
      return
    }
    if (op === 'IN') {
      const right = n.right as { type?: string; value?: unknown[] }
      if (right?.type === 'expr_list' && Array.isArray(right.value) && right.value.length === 1 && literalMatchesCompanyId(right.value[0], companyId)) {
        return
      }
      bad = 'Use apenas company_id = <sua empresa> (ou IN com um único valor igual ao da empresa).'
      return
    }
    bad = 'Comparações não permitidas na coluna company_id.'
  })
  return bad
}

function normalizeFrom(from: unknown): unknown[] {
  if (from == null) return []
  if (Array.isArray(from)) return from
  if (typeof from === 'object' && from !== null && 'expr' in from) return [from]
  return []
}

/** Só INNER JOIN (e JOIN) contam para company_id no ON; LEFT/RIGHT/FULL/CROSS não (evita vazamento). */
function joinIsInner(join: unknown): boolean {
  if (join == null) return false
  const j = String(join).toUpperCase().replace(/\s+/g, ' ')
  if (j.includes('LEFT') || j.includes('RIGHT') || j.includes('FULL') || j.includes('CROSS')) return false
  return true
}

function aliasFromFromItem(item: Record<string, unknown>): string | null {
  const a = item.as
  if (a != null && String(a).trim() !== '') return String(a).toLowerCase()
  const t = item.table
  if (t != null && String(t).trim() !== '') return String(t).toLowerCase()
  return null
}

/** Conjuntos AND sem OR no topo; se encontrar OR, retorna null (não usar para cobertura por ON). */
function flattenAndConjunctsStrictNoOr(node: unknown): unknown[] | null {
  if (node == null) return []
  if (isOrNode(node)) return null
  const n = node as { type?: string; operator?: string; left?: unknown; right?: unknown }
  if (n.type === 'binary_expr' && String(n.operator).toUpperCase() === 'AND') {
    const l = flattenAndConjunctsStrictNoOr(n.left)
    const r = flattenAndConjunctsStrictNoOr(n.right)
    if (l == null || r == null) return null
    return [...l, ...r]
  }
  return [node]
}

/** Aliases com pa.company_id = N (ou c.company_id = N) em expressão só-AND. */
function qualifiedCompanyTenantAliasesInExpr(expr: unknown, companyId: number): Set<string> | null {
  const parts = flattenAndConjunctsStrictNoOr(expr)
  if (parts == null) return null
  const out = new Set<string>()
  for (const p of parts) {
    if (!isQualifiedCompanyIdEquality(p, companyId)) continue
    const n = p as { left?: unknown }
    const al = columnRefTableAlias(n.left)
    if (al) out.add(al)
  }
  return out
}

function collectRequiredTenantAliases(
  fromList: unknown[],
  cteNames: Set<string>,
  allowed: Set<string>,
): string[] {
  const req: string[] = []
  for (const item of fromList) {
    if (!item || typeof item !== 'object') continue
    const row = item as { expr?: { ast?: Select }; table?: string }
    if (row.expr?.ast?.type === 'select') continue
    const t = row.table
    if (t == null) continue
    const tl = String(t).toLowerCase()
    if (tl === 'dual' || cteNames.has(tl) || !allowed.has(tl)) continue
    const al = aliasFromFromItem(row as Record<string, unknown>)
    if (al) req.push(al)
  }
  return req
}

/**
 * Cobertura multi-tenant sem depender só do WHERE: cada tabela permitida no FROM precisa de
 * `alias.company_id = tenant` em um AND (sem OR) no WHERE ou no ON de um INNER JOIN.
 */
function isFromTenantSafeWithInnerOn(
  sel: Select,
  fromList: unknown[],
  cteNames: Set<string>,
  companyId: number,
  allowed: Set<string>,
): boolean {
  const required = collectRequiredTenantAliases(fromList, cteNames, allowed)
  if (required.length === 0) return false

  let covered = new Set<string>()

  if (sel.where) {
    const w = qualifiedCompanyTenantAliasesInExpr(sel.where, companyId)
    if (w == null) return false
    covered = new Set(w)
  }

  for (const item of fromList) {
    if (!item || typeof item !== 'object') continue
    const row = item as { join?: unknown; on?: unknown }
    if (!joinIsInner(row.join)) continue
    if (row.on == null) continue
    const fromOn = qualifiedCompanyTenantAliasesInExpr(row.on, companyId)
    if (fromOn == null) return false
    covered = new Set([...covered, ...fromOn])
  }

  return required.every((a) => covered.has(a))
}

function hasSetOpChain(sel: Select): boolean {
  let cur: Select | null | undefined = sel
  while (cur) {
    if (cur.set_op) return true
    cur = cur._next as Select | undefined
  }
  return false
}

function validateSelectTenant(sel: Select, inheritedCtes: Set<string>, companyId: number, allowed: Set<string>): string | null {
  if (hasSetOpChain(sel)) {
    return 'UNION, INTERSECT e EXCEPT não são permitidos.'
  }

  let ctesForBodies = new Set(inheritedCtes)
  const withList = sel.with
  if (Array.isArray(withList)) {
    for (const w of withList) {
      const inner = unwrapCteStmt((w as { stmt?: unknown }).stmt)
      if (inner) {
        const err = validateSelectTenant(inner, ctesForBodies, companyId, allowed)
        if (err) return err
      }
      const name = cteName(w as { name?: { value?: string } })
      if (name) ctesForBodies.add(name)
    }
  }

  return validatePhysicalFromAndWhere(sel, ctesForBodies, companyId, allowed)
}

function validatePhysicalFromAndWhere(sel: Select, cteNames: Set<string>, companyId: number, allowed: Set<string>): string | null {
  const fromList = normalizeFrom(sel.from)
  let needsTenantOnThisSelect = false

  for (const item of fromList) {
    if (!item || typeof item !== 'object') continue
    const row = item as { expr?: { ast?: Select }; table?: string }
    if (row.expr?.ast?.type === 'select') {
      const err = validateSelectTenant(row.expr.ast, cteNames, companyId, allowed)
      if (err) return err
      continue
    }
    const t = row.table
    if (t == null) continue
    const tl = String(t).toLowerCase()
    if (tl === 'dual') continue
    if (cteNames.has(tl)) continue
    if (allowed.has(tl)) needsTenantOnThisSelect = true
  }

  if (!needsTenantOnThisSelect) return null

  const illegalWhere = illegalCompanyIdPredicateMessage(sel.where, companyId)
  if (illegalWhere) return illegalWhere

  for (const item of fromList) {
    if (!item || typeof item !== 'object') continue
    const row = item as { join?: unknown; on?: unknown }
    if (!joinIsInner(row.join) || row.on == null) continue
    const ion = illegalCompanyIdPredicateMessage(row.on, companyId)
    if (ion) return ion
  }

  const whereTenantSafe = isWhereTenantSafe(sel.where, companyId)
  const innerOnTenantSafe = isFromTenantSafeWithInnerOn(sel, fromList, cteNames, companyId, allowed)
  if (!whereTenantSafe && !innerOnTenantSafe) {
    return `A query deve garantir isolamento por empresa (company_id = ${companyId}) em cada parte que acessa tabelas de dados.`
  }

  if (sel.having) {
    const hav = Array.isArray(sel.having) ? sel.having[0] : sel.having
    if (hav && typeof hav === 'object') {
      const ih = illegalCompanyIdPredicateMessage(hav, companyId)
      if (ih) return ih
    }
  }

  return null
}

export function validateAstTenantPolicy(ast: Select, companyId: number, allowed: Set<string>): { ok: true } | { ok: false; message: string } {
  const err = validateSelectTenant(ast, new Set(), companyId, allowed)
  if (err) return { ok: false, message: err }
  return { ok: true }
}
