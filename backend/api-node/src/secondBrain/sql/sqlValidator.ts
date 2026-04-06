import { Parser } from 'node-sql-parser'
import type { Select } from 'node-sql-parser'
import { ALLOWED_RELATIONS } from '../schema/allowedRelations'
import type { SqlValidationResult } from '../types'
import { validateAstTenantPolicy } from './sqlTenantAst'

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|COPY|EXECUTE|CALL|PG_SLEEP|LO_|VERSION\s*\(|INTO\s+OUTFILE)\b/i

export function stripSqlComments(sql: string): string {
  let s = sql.replace(/\/\*[\s\S]*?\*\//g, ' ')
  s = s.replace(/--[^\n\r]*/g, ' ')
  return s
}

function extractRelationNames(sql: string): string[] {
  const names: string[] = []
  const re = /\b(?:FROM|JOIN)\s+(?:ONLY\s+)?(?:public\.)?("?)([a-z_][a-z0-9_]*)\1/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sql)) !== null) {
    names.push(m[2].toLowerCase())
  }
  return names
}

function parseLimit(sql: string): number | null {
  const upper = sql.toUpperCase()
  const idx = upper.lastIndexOf('LIMIT')
  if (idx < 0) return null
  const tail = sql.slice(idx)
  const m = tail.match(/LIMIT\s+(\d+)/i)
  if (!m) return null
  return parseInt(m[1], 10)
}

export function validatePetshopReadOnlySql(sql: string, companyId: number, maxLimit: number): SqlValidationResult {
  let s = stripSqlComments(sql).trim()
  if (!s) {
    return { ok: false, code: 'EMPTY', message: 'SQL vazia.' }
  }
  s = s.replace(/;+\s*$/g, '')
  if (s.includes(';')) {
    return { ok: false, code: 'MULTI', message: 'Apenas uma instrução SQL é permitida.' }
  }
  const upper = s.toUpperCase()
  if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
    return { ok: false, code: 'NOT_SELECT', message: 'Apenas consultas SELECT (ou WITH ... SELECT) são permitidas.' }
  }
  if (FORBIDDEN.test(s)) {
    return { ok: false, code: 'FORBIDDEN', message: 'Comando ou função não permitida na consulta.' }
  }
  if (/\bSELECT\s+\*/i.test(s)) {
    return {
      ok: false,
      code: 'NO_SELECT_STAR',
      message: 'Não use SELECT *; liste apenas as colunas necessárias (facilita respostas claras e evita vazar campos internos).',
    }
  }

  let ast: unknown
  try {
    const parser = new Parser()
    const parsed = parser.parse(s, { database: 'postgresql' })
    ast = parsed.ast
  } catch {
    return {
      ok: false,
      code: 'PARSE',
      message: 'SQL inválida ou sintaxe não suportada pelo validador de segurança.',
    }
  }
  if (Array.isArray(ast)) {
    return { ok: false, code: 'MULTI', message: 'Apenas uma instrução SQL é permitida.' }
  }
  if (!ast || typeof ast !== 'object' || (ast as { type?: string }).type !== 'select') {
    return { ok: false, code: 'NOT_SELECT', message: 'Apenas consultas SELECT (ou WITH ... SELECT) são permitidas.' }
  }
  const tenantAst = validateAstTenantPolicy(ast as Select, companyId, ALLOWED_RELATIONS)
  if (!tenantAst.ok) {
    return { ok: false, code: 'TENANT', message: tenantAst.message }
  }
  const limitVal = parseLimit(s)
  if (limitVal === null) {
    return { ok: false, code: 'LIMIT', message: 'Inclua LIMIT com um número no final da consulta.' }
  }
  if (limitVal < 1 || limitVal > maxLimit) {
    return { ok: false, code: 'LIMIT_RANGE', message: `LIMIT deve estar entre 1 e ${maxLimit}.` }
  }
  const refs = extractRelationNames(s)
  if (refs.length === 0) {
    return { ok: false, code: 'NO_REL', message: 'Não foi possível identificar tabelas/views na consulta.' }
  }
  for (const r of refs) {
    if (!ALLOWED_RELATIONS.has(r)) {
      return { ok: false, code: 'ALLOWLIST', message: `Relação não permitida: ${r}` }
    }
  }
  return { ok: true, normalizedSql: s }
}
