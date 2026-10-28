/**
 * 5단계 실제 DB 통합 테스트 하네스.
 *
 *  - 실제 Supabase DB(대원정밀)에 실제 Prisma 로 접속하고, 앱의 실제 서버 액션 코드를 그대로 호출한다.
 *  - 인증: 앱과 같은 JWT(signAuthToken)를 만들어 `next/headers` 의 쿠키로 주입한다 → getCurrentUser/권한 조회는 실제 DB 로 동작한다.
 *  - Next 런타임이 없어서 필요한 두 가지만 대체한다: `next/headers`(쿠키 보관소), `next/cache`(재검증 no-op).
 *  - 테스트 데이터는 모두 ZT5 접두어로 만든다(나중에 SQL 로 식별·삭제 가능). 이 스위트는 DB 행을 삭제하지 않는다.
 *  - 비밀번호·연결 문자열·키는 출력하지 않는다.
 *  - 안전장치(env.ts verifyTarget): DAEWON_DB_IT_CONFIRM=<대원정밀 프로젝트 식별자> 없이는 이 모듈을 불러오는 즉시 중단한다.
 */
import Module from "node:module"
import { join } from "node:path"
import { loadEnv, testPopPin, verifyTarget } from "./env"

loadEnv()
// 실행 안전장치: 확인 변수·프로젝트·DB·테넌트가 맞지 않으면 PrismaClient 를 만들기 전에 중단한다(import 만으로 DB 에 접근하지 않는다).
verifyTarget()
// 동시성 시나리오가 병렬 요청을 보낼 수 있게 커넥션 수를 늘린다(Supabase pooler 한도 안, 앱 기본은 2).
process.env.PRISMA_CONNECTION_LIMIT ??= "8"
process.env.PRISMA_POOL_TIMEOUT ??= "20"
const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

export const PREFIX = "ZT5"

// ─── Next 런타임 대체 ────────────────────────────────────────────────────────
const jar = new Map<string, string>()
function inject(modulePath: string, exports: Record<string, unknown>) {
  const filename = require.resolve(modulePath)
  const mod = new Module(filename)
  mod.filename = filename
  mod.loaded = true
  mod.exports = exports
  require.cache[filename] = mod
}
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  getAll: () => Array.from(jar).map(([name, value]) => ({ name, value })),
  has: (name: string) => jar.has(name),
  set: (name: string | { name: string; value: string }, value?: string) => {
    if (typeof name === "object") jar.set(name.name, name.value)
    else jar.set(name, value ?? "")
  },
  delete: (name: string) => void jar.delete(name),
}
inject("next/headers", { cookies: async () => cookieStore, headers: async () => new Map<string, string>([["x-forwarded-for", "127.0.0.1"], ["user-agent", "zt5-db-it"]]) })
inject("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: <T>(fn: T) => fn })

// 실제 Prisma(앱과 같은 src/lib/db/prisma — DATABASE_URL 그대로)
// eslint-disable-next-line @typescript-eslint/no-var-requires
export const prisma = (require("../../src/lib/db/prisma") as typeof import("../../src/lib/db/prisma")).prisma
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jwtLib = require("../../src/lib/jwt") as typeof import("../../src/lib/jwt")

export const TENANT_ID = process.env.DEFAULT_TENANT_ID as string

export function assertTarget() {
  return verifyTarget()
}

export { testPopPin }

/** 세션을 이 사용자로 바꾼다(앱의 로그인 쿠키와 같은 JWT). */
export function loginAs(user: { profileId: string; loginId: string; name: string; email: string; role: string }) {
  jar.set(
    jwtLib.NMES_SESSION_COOKIE,
    jwtLib.signAuthToken({ profileId: user.profileId, tenantId: TENANT_ID, loginId: user.loginId, email: user.email, name: user.name, role: user.role, mustChangePw: false }),
  )
}
export function logout() {
  jar.delete(jwtLib.NMES_SESSION_COOKIE)
}
export function cookieJar() {
  return jar
}

// ─── 결과 표시 ───────────────────────────────────────────────────────────────
export type Verdict = "PASS" | "FAIL" | "INFO"
export const results: Array<{ id: string; verdict: Verdict; text: string }> = []
export function check(id: string, condition: unknown, text: string, detail?: unknown) {
  const verdict: Verdict = condition ? "PASS" : "FAIL"
  results.push({ id, verdict, text })
  console.log(`${verdict} ${id} ${text}${!condition && detail !== undefined ? ` :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`)
}
export function info(id: string, text: string) {
  results.push({ id, verdict: "INFO", text })
  console.log(`INFO ${id} ${text}`)
}
export function summary(label: string) {
  const pass = results.filter((r) => r.verdict === "PASS").length
  const fail = results.filter((r) => r.verdict === "FAIL").length
  console.log(`\n[${label}] PASS ${pass} / FAIL ${fail}`)
  if (fail > 0) process.exitCode = 1
}

/** 01-seed 가 만든 고정 데이터(코드로 조회). */
export async function fixtures() {
  const [site, rmA, rmB, fgA, fgB, wRm, wFg, wFg2, bom, routing, po, so] = await Promise.all([
    prisma.site.findFirstOrThrow({ where: { tenantId: TENANT_ID }, orderBy: { createdAt: "asc" } }),
    prisma.item.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-RM-A" } }),
    prisma.item.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-RM-B" } }),
    prisma.item.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-FG-A" } }),
    prisma.item.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-FG-B" } }),
    prisma.warehouse.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-WH-RM" } }),
    prisma.warehouse.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-WH-FG" } }),
    prisma.warehouse.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-WH-FG2" } }),
    prisma.bOM.findFirstOrThrow({ where: { tenantId: TENANT_ID, version: "ZT5-1" } }),
    prisma.routing.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-RT-A" }, include: { operations: { orderBy: { seq: "asc" } } } }),
    prisma.purchaseOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, orderNo: "ZT5-PO-001" }, include: { items: true } }),
    prisma.salesOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, orderNo: "ZT5-SO-001" }, include: { items: true } }),
  ])
  const userRows = await prisma.userCredential.findMany({ where: { tenantId: TENANT_ID, loginId: { startsWith: "zt5-" } }, include: { profile: true } })
  const asUser = (loginId: string) => {
    const c = userRows.find((u) => u.loginId === loginId)
    if (!c) throw new Error(`테스트 사용자 없음: ${loginId}`)
    const role = loginId.replace("zt5-", "").toUpperCase()
    return { profileId: c.profileId, loginId, name: c.profile.name, email: c.profile.email, role }
  }
  return { site, rmA, rmB, fgA, fgB, wRm, wFg, wFg2, bom, routing, po, so, admin: asUser("zt5-admin"), operator: asUser("zt5-operator"), viewer: asUser("zt5-viewer") }
}

export const sleep =(ms: number) => new Promise((r) => setTimeout(r, ms))
export const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

/**
 * 동시성·트랜잭션 테스트 시작 전 DB 상태 점검(읽기 전용, 쓰기 요청을 재시도하지 않는다).
 * 앱 트랜잭션 기본 제한(5초) 안에서 도는 테스트는 DB 가 일시적으로 정체(왕복 지연 급증, 이전 실행이 남긴 idle-in-transaction 세션,
 * 잠금 대기)일 때 "테스트 실패"처럼 보이는 시간 초과를 낸다. 그런 상태에서는 쓰기를 시작하지 않고 원인을 알려 준다.
 *   - 왕복 지연 중앙값이 PREFLIGHT_MAX_RTT_MS(기본 250ms) 초과
 *   - 20초 넘게 열려 있는 idle in transaction 세션 / 승인되지 않은(대기 중인) 잠금이 있음
 * 운영 업무 로직의 타임아웃은 건드리지 않는다. 점검을 끄려면 DB_IT_SKIP_PREFLIGHT=1.
 */
export async function preflight(label: string): Promise<void> {
  if (process.env.DB_IT_SKIP_PREFLIGHT === "1") return
  const maxRtt = Number(process.env.PREFLIGHT_MAX_RTT_MS ?? 250)
  const samples: number[] = []
  await prisma.$queryRaw`select 1`
  for (let i = 0; i < 7; i++) {
    const t0 = Date.now()
    await prisma.$queryRaw`select 1`
    samples.push(Date.now() - t0)
  }
  samples.sort((x, y) => x - y)
  const median = samples[3]
  const stale = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `select count(*)::int n from pg_stat_activity where datname = current_database() and state = 'idle in transaction' and now() - state_change > interval '20 seconds'`,
  )
  const waiting = await prisma.$queryRawUnsafe<Array<{ n: number }>>(`select count(*)::int n from pg_locks l join pg_stat_activity a on a.pid = l.pid where not l.granted and a.datname = current_database()`)
  const problems: string[] = []
  if (median > maxRtt) problems.push(`DB 왕복 지연 중앙값 ${median}ms (기준 ${maxRtt}ms 이하)`)
  if ((stale[0]?.n ?? 0) > 0) problems.push(`20초 넘게 열린 idle in transaction 세션 ${stale[0].n}개(이전 실행이 남긴 잠금 가능성)`)
  if ((waiting[0]?.n ?? 0) > 0) problems.push(`잠금 대기 중인 세션 ${waiting[0].n}개`)
  info("PREFLIGHT", `${label}: 왕복 지연 ${samples[0]}~${samples[6]}ms(중앙값 ${median}ms), 잔류 idle-in-tx ${stale[0]?.n ?? 0}, 잠금 대기 ${waiting[0]?.n ?? 0}`)
  if (problems.length > 0) {
    throw new Error(`DB 상태가 불안정해 ${label} 을(를) 시작하지 않습니다(쓰기 없음): ${problems.join("; ")}. 잠시 후 다시 실행하세요.`)
  }
}

/** 제한 시간 안에 끝나지 않으면 실패로 보고(연결 장시간 점유 방지). */
export async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([fn(), new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`TIMEOUT ${label} ${ms}ms`)), ms)))])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
