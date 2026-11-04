/**
 * 권한 테스트 공용 라이브러리 — 로컬 테스트 DB/서버 전용.
 *  - 서버 액션 직접 호출(Next-Action 헤더) : 개발 서버가 컴파일한 server-reference-manifest 에서 액션 ID 를 찾아 HTTP 로 호출한다.
 *  - DB 변경 감지 : 모든 테이블의 행 수 + 호출 이후 변경된 행(xmin) 수를 비교한다(권한 거부 시 DB 가 바뀌면 안 됨).
 *  - 정책 기준 : 소스(role-permissions.ts 의 메뉴→리소스 매핑)와 로컬 DB 의 RolePermission 행을 그대로 읽는다.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import jwt from "jsonwebtoken"
import { PrismaClient } from "@prisma/client"
import { E2E_BASE } from "../guard"

export type RoleKey = "ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER"
export const ROLES: RoleKey[] = ["ADMIN", "MANAGER", "OPERATOR", "VIEWER"]

export function roleCreds(role: RoleKey | "T2OWNER") {
  const loginId = process.env[`ROLE_${role}_LOGIN`]
  const password = process.env[`ROLE_${role}_PASSWORD`]
  if (!loginId || !password) throw new Error(`ROLE_${role}_LOGIN/PASSWORD 환경변수가 필요합니다(tests/e2e/support/seed-roles.ts 로 로컬 DB 에 생성).`)
  return { loginId, password }
}

// ───────── 액션 맵 (개발 서버 컴파일 결과) ─────────
export type ActionInfo = { id: string; name: string; pages: string[]; files: string[] }
const REPO = process.cwd()

export function buildActionMap(): ActionInfo[] {
  const manPath = path.join(REPO, ".next/server/server-reference-manifest.json")
  const man = JSON.parse(fs.readFileSync(manPath, "utf8")) as { node: Record<string, { workers: Record<string, string> }> }
  const names: Record<string, string> = {}
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name)
      if (f.isDirectory()) walk(p)
      else if (f.name.endsWith(".js")) {
        const s = fs.readFileSync(p, "utf8")
        const re = /__next_internal_action_entry_do_not_use__ (\{[^}]*\})/g
        let m: RegExpExecArray | null
        while ((m = re.exec(s))) {
          for (const t of [m[1], m[1].split('\\"').join('"')]) {
            try { Object.assign(names, JSON.parse(t)); break } catch { /* next form */ }
          }
        }
      }
    }
  }
  walk(path.join(REPO, ".next/server"))
  const out: ActionInfo[] = []
  for (const [id, e] of Object.entries(man.node)) {
    const files = new Set<string>()
    for (const v of Object.values(e.workers)) {
      const m = /actions=([^&]+)/.exec(v)
      if (!m) continue
      try {
        const arr = JSON.parse(decodeURIComponent(m[1])) as [string, string[]][]
        for (const [file, ns] of arr) if (ns.includes(names[id])) files.add(path.relative(REPO, file).split("\\").join("/"))
      } catch { /* ignore */ }
    }
    out.push({ id, name: names[id] ?? "", pages: Object.keys(e.workers), files: Array.from(files) })
  }
  return out.filter((a) => a.name)
}

export const pageKey = (p: string) => `app${p}/page`

// ───────── 액션 분류 ─────────
export type ActionClass = "CREATE" | "UPDATE" | "DELETE" | "APPROVE" | "OTHER_MUT" | "READ"
const READ_RE = /^(get|list|search|find|fetch|load|check|validate|lookup|preview|count|export|download|read|query|resolve|calculate|compute|verify|assert|require|is|has|can)/i
const MUT_RE = /^(create|update|delete|remove|save|submit|register|approve|reject|cancel|confirm|import|upload|issue|receive|reset|toggle|set|add|bulk|release|complete|start|close|adjust|void|post|assign|change|edit|apply|run|execute|generate|print|reprint|record|revoke|lock|unlock|activate|deactivate|merge|split|move|transfer|archive|restore|finish|stop|pause|resume|link|unlink|attach|detach|upsert|reactivate|request|reserve|mark|inspect|implement|commit|copy|enable|disable|ensure)/i

export function classify(name: string): ActionClass {
  if (!MUT_RE.test(name) || /^generate\w*No$/.test(name)) return "READ" // 번호 미리보기(generate*No)는 조회성
  if (/^(create|add|register|import|upload|receive|issue|request|reserve|copy|commit|generate|record|upsert)/i.test(name)) return "CREATE"
  if (/^(delete|remove|cancel|void|revoke|unlink|detach|archive)/i.test(name)) return "DELETE"
  if (/^(approve|reject|confirm|implement|release)/i.test(name)) return "APPROVE"
  if (/^(update|edit|save|set|toggle|change|reset|reactivate|activate|deactivate|lock|unlock|assign|mark|enable|disable|adjust)/i.test(name)) return "UPDATE"
  return "OTHER_MUT"
}

// ───────── 인자 추정 ─────────
export function dummyArgs(a: ActionInfo): { args: unknown[]; skip?: string } {
  const file = a.files[0]
  if (!file) return { args: [{}] }
  let src = ""
  try { src = fs.readFileSync(path.join(REPO, file), "utf8") } catch { return { args: [{}] } }
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${a.name}\\s*(?:<[^>]*>)?\\(`)
  const re2 = new RegExp(`export\\s+const\\s+${a.name}\\s*=\\s*(?:async\\s*)?\\(`)
  const m = re.exec(src) ?? re2.exec(src)
  if (!m) return { args: [{}] }
  let i = m.index + m[0].length, depth = 1
  const start = i
  while (i < src.length && depth > 0) {
    const c = src[i]
    if (c === "(" || c === "{" || c === "[" || c === "<") depth++
    else if (c === ")" || c === "}" || c === "]" || c === ">") { if (!(c === ">" && src[i - 1] === "=")) depth-- }
    i++
  }
  const sig = src.slice(start, i - 1).trim()
  if (!sig) return { args: [] }
  const params: string[] = []
  let cur = "", d = 0
  for (const c of sig) {
    if ("({[<".includes(c)) d++
    if (")}]>".includes(c)) d--
    if (c === "," && d === 0) { params.push(cur); cur = "" } else cur += c
  }
  if (cur.trim()) params.push(cur)
  const args: unknown[] = []
  for (const p of params) {
    const t = p.includes(":") ? p.slice(p.indexOf(":") + 1) : ""
    const typ = t.split("=")[0].trim()
    if (/FormData/.test(typ)) return { args: [], skip: "FormData 인자" }
    if (/\[\]\s*$|^Array</.test(typ)) args.push([])
    else if (/^(string|UUID|Id)\b/.test(typ) && !/\|\s*(\{|number)/.test(typ)) args.push("E2E-NO-SUCH-ID")
    else if (/^number\b/.test(typ)) args.push(0)
    else if (/^boolean\b/.test(typ)) args.push(false)
    else if (/^Date\b/.test(typ)) args.push("2026-01-01")
    else if (/^(UserRole|[A-Z_]+)$/.test(typ) && /Role|Status|Type|Kind/.test(typ)) args.push("VIEWER")
    else args.push({})
  }
  return { args }
}

/** 시그니처에 tenantId 파라미터(클라이언트가 보내는 테넌트)가 있으면 그 자리에 지정한 테넌트를 넣은 인자 목록을, 없으면 null 을 돌려준다. */
export function tenantParamArgs(a: ActionInfo, tenantId: string): unknown[] | null {
  const file = a.files[0]
  if (!file) return null
  let src = ""
  try { src = fs.readFileSync(path.join(REPO, file), "utf8") } catch { return null }
  const m = new RegExp(`export\\s+async\\s+function\\s+${a.name}\\s*\\(`).exec(src)
  if (!m) return null
  let i = m.index + m[0].length, depth = 1
  const start = i
  while (i < src.length && depth > 0) {
    const c = src[i]
    if ("({[<".includes(c)) depth++
    else if (")}]>".includes(c) && !(c === ">" && src[i - 1] === "=")) depth--
    i++
  }
  const params: string[] = []
  let cur = "", d = 0
  for (const c of src.slice(start, i - 1)) {
    if ("({[<".includes(c)) d++
    if (")}]>".includes(c)) d--
    if (c === "," && d === 0) { params.push(cur); cur = "" } else cur += c
  }
  if (cur.trim()) params.push(cur)
  const isTenant = (p: string) => /^\s*tenantId\??\s*:/.test(p)
  if (!params.some(isTenant)) return null
  const base = dummyArgs(a).args
  return params.map((p, idx) => (isTenant(p) ? tenantId : base[idx] ?? {}))
}

// ───────── HTTP: 로그인 / 서버 액션 호출 ─────────
export async function apiLogin(loginId: string, password: string): Promise<{ status: number; cookie: string | null }> {
  const r = await fetch(`${E2E_BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ loginId, password }) })
  const m = /nmes-session=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")
  return { status: r.status, cookie: m ? `nmes-session=${m[1]}` : null }
}

export type CallResult = {
  status: number
  kind: "DENIED" | "EXECUTED" | "SOFT_ERROR" | "ERROR" | "BLOCKED_BY_ROUTE" | "NOT_FOUND_ACTION"
  message: string
  stackAt: string
}
const DENY_RE = /이 기능을 사용할 권한이 없습니다|FORBIDDEN|UNAUTHORIZED|권한이 없|이상 필요|접근 권한|로그인이 필요|인증이 필요/

export async function callAction(cookie: string | null, pagePath: string, a: ActionInfo, args: unknown[]): Promise<CallResult> {
  const headers: Record<string, string> = { "next-action": a.id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }
  if (cookie) headers.cookie = cookie
  const r = await fetch(`${E2E_BASE}${pagePath}`, { method: "POST", headers, body: JSON.stringify(args), redirect: "manual" })
  const t = await r.text()
  if (r.status === 404) return { status: 404, kind: /Failed to find Server Action|__daewon/.test(t) ? "NOT_FOUND_ACTION" : "BLOCKED_BY_ROUTE", message: t.slice(0, 120), stackAt: "" }
  if (r.status >= 300 && r.status < 400) return { status: r.status, kind: "BLOCKED_BY_ROUTE", message: `redirect ${r.headers.get("location")}`, stackAt: "" }
  const em = /\d+:E(\{.*)/.exec(t)
  if (em) {
    let message = "", stack = ""
    try { const j = JSON.parse(em[1]) as { message?: string; stack?: string }; message = j.message ?? ""; stack = j.stack ?? "" } catch { message = em[1].slice(0, 200) }
    const at = /at (?:async )?(\w+) \(webpack-internal:\/\/\/\(rsc\)\/\.\/(src\/[^:)]+:\d+)/.exec(stack)
    const guard = /(requireResourcePermission|requireRole|requireDeveloper)/.exec(stack)?.[1]
    const stackAt = guard ? `${guard}` + (at ? ` ← ${at[1]} (${at[2]})` : "") : at ? `${at[1]} (${at[2]})` : ""
    const denied = DENY_RE.test(message) || !!guard
    return { status: r.status, kind: denied ? "DENIED" : "ERROR", message, stackAt }
  }
  if (r.status >= 400) return { status: r.status, kind: /Failed to find Server Action/.test(t) ? "NOT_FOUND_ACTION" : "ERROR", message: t.slice(0, 160), stackAt: "" }
  // 서버 액션은 오류를 던지지 않고 { success:false | ok:false, error|message } 형태로 돌려주는 경우가 많다 → 응답 본문을 해석한다.
  const body = (/^1:(.*)$/m.exec(t)?.[1] ?? t).trim()
  const msg = body.slice(0, 160)
  const soft = /"(?:success|ok)":false/.test(body) || /^{"error"/.test(body) || /"outcome":"FAILED"/.test(body)
  if (soft) return { status: r.status, kind: DENY_RE.test(body) ? "DENIED" : "SOFT_ERROR", message: msg, stackAt: "" }
  return { status: r.status, kind: "EXECUTED", message: msg, stackAt: "" }
}

// ───────── DB: 변경 감지 / 정책 조회 ─────────
let _prisma: PrismaClient | null = null
export const db = () => (_prisma ??= new PrismaClient())
export async function closeDb() { await _prisma?.$disconnect(); _prisma = null }

const IGNORE_TABLES = new Set(["_prisma_migrations", "LoginHistory"])
let _tables: string[] | null = null
async function tables(): Promise<string[]> {
  if (_tables) return _tables
  const rows = await db().$queryRawUnsafe<{ table_name: string }[]>(
    `select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`,
  )
  _tables = rows.map((r) => r.table_name).filter((t) => !IGNORE_TABLES.has(t))
  return _tables
}

export type Snapshot = { boundary: bigint; counts: Record<string, number> }
export async function snapshot(): Promise<Snapshot> {
  const b = (await db().$queryRawUnsafe<{ x: bigint }[]>(`select txid_current() as x`))[0].x
  const ts = await tables()
  const sql = ts.map((t) => `select '${t}' as t, count(*)::int as c from "${t}"`).join(" union all ")
  const rows = await db().$queryRawUnsafe<{ t: string; c: number }[]>(sql)
  return { boundary: b, counts: Object.fromEntries(rows.map((r) => [r.t, r.c])) }
}
/** 스냅샷 이후 행 수가 바뀌었거나 행이 수정/추가된 테이블 목록 */
export async function changedSince(s: Snapshot): Promise<string[]> {
  const ts = await tables()
  const sql = ts.map((t) => `select '${t}' as t, count(*)::int as c, (count(*) filter (where xmin::text::bigint >= ${s.boundary}))::int as m from "${t}"`).join(" union all ")
  const rows = await db().$queryRawUnsafe<{ t: string; c: number; m: number }[]>(sql)
  return rows.filter((r) => r.c !== s.counts[r.t] || r.m > 0).map((r) => `${r.t}(${r.c - (s.counts[r.t] ?? 0) >= 0 ? "+" : ""}${r.c - (s.counts[r.t] ?? 0)}/수정${r.m})`)
}

// ───────── 정책: 소스의 메뉴→리소스 매핑 + DB RolePermission ─────────
let _resMap: Record<string, string> | null = null
export function menuResourceMap(): Record<string, string> {
  if (_resMap) return _resMap
  const src = fs.readFileSync(path.join(REPO, "src/lib/auth/role-permissions.ts"), "utf8")
  const body = /MENU_CODE_RESOURCE_MAP: Record<string, string> = \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ""
  const map: Record<string, string> = {}
  for (const m of Array.from(body.matchAll(/(?:"([\w-]+)"|(\w+)):\s*"(\w+)"/g))) map[m[1] ?? m[2]] = m[3]
  return (_resMap = map)
}
export const resourceOfPath = (p: string) => menuResourceMap()[p.split("/").filter(Boolean).at(-1) ?? ""] ?? null

let _perms: Map<string, Set<string>> | null = null
export async function rolePerms(tenantId: string): Promise<Map<string, Set<string>>> {
  if (_perms) return _perms
  const rows = await db().rolePermission.findMany({ where: { tenantId, isAllowed: true }, select: { role: true, resource: true, action: true } })
  const m = new Map<string, Set<string>>()
  for (const r of rows) { if (!m.has(r.role)) m.set(r.role, new Set()); m.get(r.role)!.add(`${r.resource}:${r.action}`) }
  return (_perms = m)
}
export function allowedFor(perms: Map<string, Set<string>>, role: RoleKey, resource: string | null, cls: ActionClass): boolean | null {
  if (cls === "READ" || cls === "OTHER_MUT") return null
  if (!resource) return null
  if (role === "ADMIN") return perms.get("ADMIN")?.has(`${resource}:${cls}`) ?? false
  return perms.get(role)?.has(`${resource}:${cls}`) ?? false
}

// ───────── 토큰 위조/타 테넌트 ─────────
export function signToken(payload: Record<string, unknown>, secret = process.env.JWT_SECRET as string) {
  return jwt.sign(payload, secret, "exp" in payload ? {} : { expiresIn: 600 })
}

/** 응답 본문 전체(타 테넌트 표식 검색용) */
export async function rawCall(cookie: string | null, pagePath: string, a: ActionInfo, args: unknown[]): Promise<string> {
  const headers: Record<string, string> = { "next-action": a.id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }
  if (cookie) headers.cookie = cookie
  const r = await fetch(`${E2E_BASE}${pagePath}`, { method: "POST", headers, body: JSON.stringify(args), redirect: "manual" })
  return r.text()
}
