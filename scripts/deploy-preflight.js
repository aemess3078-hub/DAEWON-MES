#!/usr/bin/env node
/**
 * 배포 전 점검 스크립트 (읽기 전용 · 비밀값 출력 없음)
 *
 *   node scripts/deploy-preflight.js env        환경변수 존재/형식/분류 점검
 *   node scripts/deploy-preflight.js bundle     빌드 산출물(client)에 비밀값이 포함되지 않았는지 검사 (npm run build 이후)
 *   node scripts/deploy-preflight.js supabase   Supabase 연결/마이그레이션/Storage 읽기 전용 점검
 *   node scripts/deploy-preflight.js all        위 세 가지 전부
 *
 * 값 출처: process.env 가 우선, 없으면 프로젝트 루트의 .env.local / .env 를 읽는다.
 * 이 스크립트는 DB/Storage 에 쓰지 않는다(SELECT 및 GET 만 사용).
 */
const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")
const EXPECTED_REF = "aquqetajewvhyirmewfy"
const EXPECTED_TENANT = "daewon-001"

// ── env 로딩 ────────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {}
  for (const f of [".env", ".env.local"]) {
    const p = path.join(ROOT, f)
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1")
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v !== "")) }
}

// ── 변수 분류 ────────────────────────────────────────────────────────────────
const SECRET_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "DIRECT_URL",
  "JWT_SECRET",
  "POP_PIN_SECRET",
  "POP_WORKER_SESSION_SECRET",
  "SEED_ADMIN_PASSWORD",
  "SUPABASE_MANAGEMENT_ACCESS_TOKEN",
  "OPENAI_API_KEY",
]

const PRODUCTION_REQUIRED = [
  "DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_BRAND",
  "DEFAULT_TENANT_ID",
  "JWT_SECRET",
  "POP_PIN_SECRET",
  "POP_WORKER_SESSION_SECRET",
]

const mask = (v) => (v ? "[CONFIGURED]" : "[MISSING]")
let failures = 0
let warnings = 0
const pass = (m) => console.log("  PASS  " + m)
const fail = (m) => { failures++; console.log("  FAIL  " + m) }
const warn = (m) => { warnings++; console.log("  WARN  " + m) }

function secretValuesOf(env) {
  const out = []
  for (const k of SECRET_NAMES) {
    const v = env[k]
    if (!v) continue
    out.push([k, v])
    if (k === "DATABASE_URL" || k === "DIRECT_URL") {
      try {
        const u = new URL(v)
        if (u.password) {
          out.push([k + ":password", u.password])
          out.push([k + ":password(decoded)", decodeURIComponent(u.password)])
        }
      } catch { /* ignore */ }
    }
  }
  return out.filter(([, v]) => v.length >= 8)
}

// ── env 점검 ────────────────────────────────────────────────────────────────
function checkEnv(env) {
  console.log("\n[env] 환경변수 점검 (값은 출력하지 않음)")
  for (const k of PRODUCTION_REQUIRED) console.log(`  ${k.padEnd(30)} ${mask(env[k])}`)
  console.log(`  ${"DIRECT_URL".padEnd(30)} ${mask(env.DIRECT_URL)}   (마이그레이션 전용 — Production runtime 불필요)`)
  for (const k of ["PRISMA_CONNECTION_LIMIT", "PRISMA_POOL_TIMEOUT", "PRISMA_CONNECT_TIMEOUT", "AI_ENABLED"]) {
    console.log(`  ${k.padEnd(30)} ${env[k] ? "set (" + env[k] + ")" : "(unset → 코드 기본값)"}`)
  }

  const missing = PRODUCTION_REQUIRED.filter((k) => !env[k])
  missing.length ? fail("필수 변수 누락: " + missing.join(", ")) : pass("Production 필수 변수 8개 모두 설정됨")

  if (env.NEXT_PUBLIC_BRAND !== "daewon") fail("NEXT_PUBLIC_BRAND 는 daewon 이어야 함 (빌드 시점에 번들에 고정됨)")
  else pass("NEXT_PUBLIC_BRAND=daewon")
  if (env.DEFAULT_TENANT_ID && env.DEFAULT_TENANT_ID !== EXPECTED_TENANT) warn(`DEFAULT_TENANT_ID 가 ${EXPECTED_TENANT} 가 아님`)
  if (env.DEFAULT_TENANT_ID === "tenant-demo-001") fail("DEFAULT_TENANT_ID 가 NMES 데모 값")

  const s = [env.JWT_SECRET, env.POP_PIN_SECRET, env.POP_WORKER_SESSION_SECRET].filter(Boolean)
  if (s.length === 3) {
    new Set(s).size === 3 ? pass("JWT/POP 시크릿 3개가 서로 다른 값") : fail("JWT/POP 시크릿 중 같은 값이 있음")
    s.every((v) => v.length >= 64) ? pass("시크릿 길이 ≥ 64") : warn("시크릿 길이가 64자 미만인 항목이 있음")
  }

  // URL 형식
  try {
    const u = new URL(env.NEXT_PUBLIC_SUPABASE_URL)
    u.hostname === `${EXPECTED_REF}.supabase.co` ? pass("NEXT_PUBLIC_SUPABASE_URL 이 대상 프로젝트") : fail("NEXT_PUBLIC_SUPABASE_URL 이 대상 프로젝트와 다름")
  } catch { fail("NEXT_PUBLIC_SUPABASE_URL 형식 오류") }
  for (const [k, port] of [["DATABASE_URL", "6543"], ["DIRECT_URL", "5432"]]) {
    if (!env[k]) continue
    try {
      const u = new URL(env[k])
      const refOk = u.username === `postgres.${EXPECTED_REF}`
      const hostOk = /\.pooler\.supabase\.com$/.test(u.hostname)
      refOk && hostOk && u.port === port ? pass(`${k}: 대상 프로젝트 풀러, 포트 ${port}`) : fail(`${k}: 사용자/호스트/포트(${port}) 확인 필요`)
    } catch { fail(`${k} 형식 오류`) }
  }

  // NEXT_PUBLIC_ 에 비밀이 들어가지 않았는지
  const badPublic = Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_") && /SECRET|PASSWORD|TOKEN|SERVICE_ROLE|DATABASE|PRIVATE/i.test(k))
  badPublic.length ? fail("NEXT_PUBLIC_ 에 비밀 가능성: " + badPublic.join(", ")) : pass("NEXT_PUBLIC_* 에 비밀 변수 없음")
  const pub = Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_"))
  console.log("  NEXT_PUBLIC_* 목록:", pub.join(", ") || "(none)")

  // seed 전용 변수가 운영 환경에 들어갔는지(권장: 넣지 않는다)
  const seedVars = ["SEED_ADMIN_LOGIN_ID", "SEED_ADMIN_PASSWORD", "SEED_ADMIN_NAME", "SEED_ADMIN_EMAIL", "DAEWON_SEED_CONFIRM"].filter((k) => process.env[k])
  seedVars.length ? warn("process.env(= 배포 환경)에 seed 전용 변수가 있음: " + seedVars.join(", ") + " → Vercel 에는 넣지 말 것") : pass("process.env 에 seed 전용 변수 없음")
}

// ── bundle 점검 ──────────────────────────────────────────────────────────────
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, exts, out)
    else if (exts.some((x) => p.endsWith(x))) out.push(p)
  }
  return out
}

function checkBundle(env) {
  console.log("\n[bundle] 빌드 산출물(client) 비밀값 검사")
  const next = path.join(ROOT, ".next")
  if (!fs.existsSync(next)) return fail(".next 가 없음 — 먼저 npm run build 실행")
  const targets = [
    ...walk(path.join(next, "static"), [".js", ".css", ".json", ".html", ".map"]),
    ...walk(path.join(next, "server", "app"), [".html", ".rsc"]), // 프리렌더된 페이지(클라이언트에 전달됨)
  ]
  const secrets = secretValuesOf(env)
  if (secrets.length === 0) warn("비교할 비밀값이 없음(.env.local 또는 환경변수 필요) — 이름 검사만 수행")
  const valueHits = []
  const nameHits = new Map()
  const names = SECRET_NAMES.concat(["service_role"])
  for (const f of targets) {
    const t = fs.readFileSync(f, "utf8")
    for (const [k, v] of secrets) if (t.includes(v)) valueHits.push(`${k} @ ${path.relative(ROOT, f)}`)
    for (const n of names) if (t.includes(n)) nameHits.set(n, (nameHits.get(n) || 0) + 1)
  }
  console.log(`  scanned files: ${targets.length}, secrets compared: ${secrets.length}`)
  valueHits.length ? fail("비밀값이 client 산출물에 포함됨: " + [...new Set(valueHits)].slice(0, 5).join("; ")) : pass("비밀 값 포함 0건")
  nameHits.size ? warn("환경변수 이름 문자열이 client 산출물에 있음: " + [...nameHits.entries()].map(([k, n]) => `${k}(${n})`).join(", ")) : pass("비밀 변수 이름 문자열 0건")
}

// ── supabase 점검 (읽기 전용) ─────────────────────────────────────────────────
async function checkSupabase(env) {
  console.log("\n[supabase] 읽기 전용 점검")
  let PrismaClient
  try { ({ PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"))) } catch { return fail("@prisma/client 를 불러올 수 없음 (npm install / prisma generate)") }

  const urls = [["DATABASE_URL (Transaction pooler 6543)", env.DATABASE_URL, true], ["DIRECT_URL (Session pooler 5432)", env.DIRECT_URL, false]]
  let deepClient = null
  for (const [label, raw, pgbouncer] of urls) {
    if (!raw) { warn(`${label}: 미설정 — 건너뜀`); continue }
    let url
    try { url = new URL(raw) } catch { fail(`${label}: URL 형식 오류`); continue }
    if (url.username !== `postgres.${EXPECTED_REF}`) { fail(`${label}: 대상 프로젝트 사용자가 아님 — 중단`); continue }
    if (pgbouncer && !url.searchParams.has("pgbouncer")) url.searchParams.set("pgbouncer", "true")
    url.searchParams.set("connect_timeout", "15")
    const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] })
    try {
      await prisma.$queryRawUnsafe("select 1")
      pass(`${label}: 연결 성공`)
      if (!deepClient) deepClient = prisma
      else await prisma.$disconnect()
    } catch (e) {
      const m = String(e && e.message)
      const kind = /Authentication failed|password authentication failed/i.test(m) ? "password authentication failed"
        : /Tenant or user not found/i.test(m) ? "tenant/user not found"
        : /ssl|tls/i.test(m) ? "SSL 관련"
        : /timed out|timeout|P1002/i.test(m) ? "timeout/network"
        : /Can't reach|ENOTFOUND|ECONNREFUSED/i.test(m) ? "host/region mismatch 또는 unreachable" : "기타"
      fail(`${label}: 연결 실패 → ${kind}`)
      await prisma.$disconnect()
    }
  }

  if (deepClient) {
    try {
      const mig = await deepClient.$queryRawUnsafe("select count(*)::int total, count(*) filter (where finished_at is not null)::int finished, count(*) filter (where finished_at is null)::int unfinished from _prisma_migrations")
      const m = mig[0]
      m.unfinished === 0 && m.total >= 1 ? pass(`_prisma_migrations: ${m.finished} 적용, 실패/미완료 0`) : fail(`_prisma_migrations 이상: ${JSON.stringify(m)}`)
      const t = await deepClient.$queryRawUnsafe("select id, code from \"Tenant\"")
      t.some((x) => x.id === EXPECTED_TENANT) ? pass(`Tenant ${EXPECTED_TENANT} 존재`) : fail(`Tenant ${EXPECTED_TENANT} 없음`)
      const own = await deepClient.$queryRawUnsafe("select count(*)::int n from \"TenantUser\" where role='OWNER' and \"isActive\"")
      own[0].n >= 1 ? pass(`활성 OWNER ${own[0].n}명`) : fail("활성 OWNER 없음")
      const rls = await deepClient.$queryRawUnsafe("select count(*) filter (where c.relrowsecurity)::int on_, count(*)::int total from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")
      rls[0].on_ === rls[0].total ? pass(`RLS 활성화 ${rls[0].on_}/${rls[0].total}`) : fail(`RLS 미적용 테이블 있음 ${rls[0].on_}/${rls[0].total}`)
      const g = await deepClient.$queryRawUnsafe("select count(*)::int n from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated')")
      g[0].n === 0 ? pass("anon/authenticated 테이블 권한 0") : fail(`anon/authenticated 권한 ${g[0].n}건`)
    } catch (e) {
      fail("DB 점검 쿼리 실패: " + String(e && e.message).split("\n").slice(-1)[0].slice(0, 120))
    } finally { await deepClient.$disconnect() }
  }

  // Storage (service role, GET 만)
  const base = env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return warn("Storage 점검: URL/key 없음 — 건너뜀")
  if (base !== `https://${EXPECTED_REF}.supabase.co`) return fail("Storage 점검: 대상 프로젝트 URL 이 아님 — 중단")
  try {
    const res = await fetch(base + "/storage/v1/bucket", { headers: { apikey: key, Authorization: "Bearer " + key } })
    if (!res.ok) return fail(`Storage bucket 조회 실패 (HTTP ${res.status}) — service role key 확인`)
    const buckets = await res.json()
    pass("service role key 로 Storage 접근 성공")
    for (const name of ["attachments", "work-standards"]) {
      const b = buckets.find((x) => x.name === name)
      if (!b) warn(`bucket ${name} 없음 (첫 업로드 시 자동 생성됨)`)
      else b.public === false ? pass(`bucket ${name}: private`) : fail(`bucket ${name}: PUBLIC — private 로 변경 필요`)
    }
    const pub = buckets.filter((b) => b.public)
    pub.length ? fail("public bucket 존재: " + pub.map((b) => b.name).join(",")) : pass("public bucket 0개")
  } catch (e) { fail("Storage 점검 오류: " + String(e && e.message).slice(0, 100)) }
}

// ── main ────────────────────────────────────────────────────────────────────
;(async () => {
  const mode = process.argv[2] || "all"
  const env = loadEnv()
  if (["env", "all"].includes(mode)) checkEnv(env)
  if (["bundle", "all"].includes(mode)) checkBundle(env)
  if (["supabase", "all"].includes(mode)) await checkSupabase(env)
  if (!["env", "bundle", "supabase", "all"].includes(mode)) { console.log("usage: node scripts/deploy-preflight.js [env|bundle|supabase|all]"); process.exit(2) }
  console.log(`\n결과: FAIL ${failures} / WARN ${warnings}`)
  // process.exit() 를 쓰면 Windows 에서 열린 핸들 때문에 libuv assertion 이 날 수 있어 exitCode 만 지정한다.
  process.exitCode = failures === 0 ? 0 : 1
})()
