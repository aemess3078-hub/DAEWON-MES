/**
 * 로컬 테스트 DB 가드 검증 — 브라우저 스모크(f22)가 운영 DB 에 접근/변경할 수 없는지 확인한다 (DB 불필요)
 *
 *  1) 가드 순수 함수: 운영(Supabase) 주소 / 원격 호스트 / *_test 아닌 DB / 승인 없음 / 환경변수 누락 / DIRECT_URL / 원격 앱 서버 거부, 로컬 *_test 만 통과
 *  2) 실제 스크립트 실행: 위 조건에서 f22-browser-smoke.ts 를 실제로 실행해 exit 2 로 즉시 종료하고, DB 연결을 시도하지 않으며,
 *     접속 정보(비밀번호)를 출력하지 않는지 확인한다. 사용하는 주소는 모두 존재하지 않는 가짜 주소다(진짜 운영 주소는 쓰지 않는다).
 *  3) 소스 점검: .env/.env.local 자동 로딩 제거, 가드가 prisma 로딩보다 먼저 실행, 연결 DB 확인 후에만 cleanup 수행
 *  4) 실제 .env.local 이 있다면 그 값을(메모리에서만, 출력 없이) 가드에 넣어 거부되는지 확인
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { checkLocalTestDbEnv, checkLocalTestDbUrl } from "./helpers/local-test-db-guard"

const root = process.cwd()
let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed += 1
  console.log(`PASS ${passed}: ${name}`)
}

const CONFIRM = { DAEWON_TEST_DB_CONFIRM: "YES_LOCAL_TEST_DB" }
const LOCAL_OK = "postgresql://user:pw@127.0.0.1:54329/daewon_mes_test"
const FAKE_PROD = "postgresql://postgres.fakeproject:FAKE-PASSWORD-FOR-GUARD-TEST@aws-0-fake.pooler.supabase.com:6543/postgres"
const FAKE_REMOTE = "postgresql://user:FAKE-PASSWORD-FOR-GUARD-TEST@db.fake-prod-example.internal:5432/daewon_prod"
const rejected = (env: Record<string, string | undefined>, opts = {}) => {
  const r = checkLocalTestDbEnv(env, opts)
  assert.equal(r.ok, false)
  return r.ok ? [] : r.reasons
}

// ── 1) 순수 함수 ──────────────────────────────────────────────────────────────
check("통과: 승인 + 로컬 *_test DB (127.0.0.1 / localhost / [::1])", () => {
  for (const url of [LOCAL_OK, "postgres://u:p@localhost:5432/x_test", "postgresql://u:p@[::1]:5432/abc_test"]) {
    assert.equal(checkLocalTestDbEnv({ ...CONFIRM, DATABASE_URL: url }).ok, true, url)
  }
})
check("거부: 승인(DAEWON_TEST_DB_CONFIRM) 없음 또는 값이 다름", () => {
  assert.ok(rejected({ DATABASE_URL: LOCAL_OK }).some((r) => r.includes("DAEWON_TEST_DB_CONFIRM")))
  assert.ok(rejected({ DAEWON_TEST_DB_CONFIRM: "yes", DATABASE_URL: LOCAL_OK }).some((r) => r.includes("DAEWON_TEST_DB_CONFIRM")))
})
check("거부: DATABASE_URL 미지정(.env.local 에서 가져오지 않음), 빈 값, 해석 불가", () => {
  assert.ok(rejected({ ...CONFIRM }).some((r) => r.includes("DATABASE_URL")))
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "   " }).length > 0)
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "not a url" }).length > 0)
})
check("거부: 운영(Supabase pooler) 주소 / 원격 호스트 / 로컬이지만 *_test 아님", () => {
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: FAKE_PROD }).length > 0)
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: FAKE_REMOTE }).some((r) => r.includes("로컬")))
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/postgres" }).some((r) => r.includes("*_test")))
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/test_data" }).length > 0) // 접미사가 아니면 거부
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/" }).length > 0)
})
check("거부: 우회 시도 — 로컬처럼 보이는 호스트명, 접속 대상을 바꾸는 쿼리, 다중 호스트, 다른 프로토콜", () => {
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "postgresql://u:p@127.0.0.1.evil.example:5432/a_test" }).length > 0)
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "postgresql://u:p@localhost.evil.example/a_test" }).length > 0)
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/a_test?host=db.remote.example" }).some((r) => r.includes("파라미터")))
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432,db.remote.example:5432/a_test" }).length > 0)
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "mysql://u:p@127.0.0.1:3306/a_test" }).length > 0)
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: "postgresql://u:p@evil.example/a_test?supabase=1" }).length > 0)
})
check("거부: DIRECT_URL 이 운영을 가리키거나 DATABASE_URL 과 다른 대상", () => {
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: LOCAL_OK, DIRECT_URL: FAKE_PROD }).some((r) => r.includes("DIRECT_URL")))
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: LOCAL_OK, DIRECT_URL: "postgresql://u:p@127.0.0.1:54329/other_test" }).some((r) => r.includes("다른 대상")))
  assert.equal(checkLocalTestDbEnv({ ...CONFIRM, DATABASE_URL: LOCAL_OK, DIRECT_URL: LOCAL_OK }).ok, true)
})
check("거부: 앱 서버 주소가 원격/운영(브라우저가 운영 서버를 조작하지 않음), 로컬이면 통과", () => {
  const opts = { baseUrlVar: "F22_SMOKE_BASE_URL", defaultBaseUrl: "http://localhost:3000" }
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: LOCAL_OK, F22_SMOKE_BASE_URL: "https://daewon-mes.vercel.app" }, opts).some((r) => r.includes("F22_SMOKE_BASE_URL")))
  assert.ok(rejected({ ...CONFIRM, DATABASE_URL: LOCAL_OK, F22_SMOKE_BASE_URL: "garbage" }, opts).length > 0)
  assert.equal(checkLocalTestDbEnv({ ...CONFIRM, DATABASE_URL: LOCAL_OK }, opts).ok, true) // 기본값 localhost:3000
  assert.equal(checkLocalTestDbEnv({ ...CONFIRM, DATABASE_URL: LOCAL_OK, F22_SMOKE_BASE_URL: "http://127.0.0.1:3113" }, opts).ok, true)
})
check("메시지에 접속 정보(비밀번호/계정)를 싣지 않는다", () => {
  const all = [
    ...rejected({ ...CONFIRM, DATABASE_URL: FAKE_PROD, DIRECT_URL: FAKE_REMOTE }),
    ...rejected({ ...CONFIRM, DATABASE_URL: FAKE_REMOTE }),
    ...(checkLocalTestDbUrl("X", FAKE_PROD).ok ? [] : [(checkLocalTestDbUrl("X", FAKE_PROD) as { reason: string }).reason]),
  ].join("\n")
  assert.ok(!all.includes("FAKE-PASSWORD-FOR-GUARD-TEST") && !all.includes("postgres.fakeproject"))
})

// ── 2) 실제 스크립트 실행 (DB 연결 전에 중단되는지) ──────────────────────────────
const tsNode = path.join(root, "node_modules", "ts-node", "dist", "bin.js")
function minimalEnv(extraEnv: Record<string, string>) {
  const base: Record<string, string> = {}
  for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
    if (process.env[key]) base[key] = process.env[key] as string
  }
  return { ...base, ...extraEnv } as unknown as NodeJS.ProcessEnv
}
function runTsScript(script: string, extraEnv: Record<string, string>) {
  const started = Date.now()
  const result = spawnSync(
    process.execPath,
    [tsNode, "--compiler-options", '{"module":"commonjs","esModuleInterop":true,"target":"es2019"}', "--project", "tsconfig.json", script],
    { cwd: root, env: minimalEnv(extraEnv), encoding: "utf8", timeout: 120_000 },
  )
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, ms: Date.now() - started }
}
function runSmoke(extraEnv: Record<string, string>) {
  const base: Record<string, string> = {}
  for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
    if (process.env[key]) base[key] = process.env[key] as string
  }
  const started = Date.now()
  const result = spawnSync(
    process.execPath,
    [tsNode, "--compiler-options", '{"module":"commonjs","esModuleInterop":true,"target":"es2019"}', "--project", "tsconfig.json", "scripts/f22-browser-smoke.ts"],
    // 부모 환경(운영 주소가 들어 있을 수 있음)을 물려주지 않고 필요한 최소 값만 넘긴다. (Next 가 ProcessEnv 에 NODE_ENV 를 필수로 선언해 캐스팅)
    { cwd: root, env: { ...base, ...extraEnv } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 120_000 },
  )
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, ms: Date.now() - started }
}
function assertBlocked(label: string, extraEnv: Record<string, string>, expectText: string) {
  const r = runSmoke(extraEnv)
  assert.equal(r.status, 2, `${label}: exit code ${r.status}\n${r.output.slice(0, 400)}`)
  assert.ok(r.output.includes("ABORT [f22-browser-smoke]") && r.output.includes(expectText), `${label}: 안내 메시지\n${r.output.slice(0, 400)}`)
  assert.ok(!/Prisma|Can't reach database|ECONNREFUSED|ENOTFOUND|P1001/i.test(r.output), `${label}: DB 연결을 시도한 흔적\n${r.output.slice(0, 400)}`)
  assert.ok(!r.output.includes("FAKE-PASSWORD-FOR-GUARD-TEST"), `${label}: 접속 정보 노출`)
}

check("실행: 환경변수 없음(.env.local 이 있어도 읽지 않음) → DB 연결 전 exit 2", () => assertBlocked("no env", {}, "DATABASE_URL"))
check("실행: 가짜 운영(Supabase) 주소 + 승인 → exit 2, 연결 시도 없음", () =>
  assertBlocked("fake prod", { ...CONFIRM, DATABASE_URL: FAKE_PROD, DIRECT_URL: FAKE_PROD }, "관리형/운영"))
check("실행: 원격 호스트 + 승인 → exit 2", () => assertBlocked("remote", { ...CONFIRM, DATABASE_URL: FAKE_REMOTE }, "로컬"))
check("실행: 로컬이지만 *_test 아닌 DB → exit 2", () =>
  assertBlocked("non-test db", { ...CONFIRM, DATABASE_URL: "postgresql://u:p@127.0.0.1:1/postgres" }, "*_test"))
check("실행: 로컬 *_test DB 이지만 승인 없음 → exit 2", () =>
  assertBlocked("no confirm", { DATABASE_URL: LOCAL_OK.replace("54329", "1") }, "DAEWON_TEST_DB_CONFIRM"))
check("실행: 로컬 *_test DB + 승인이어도 앱 서버가 원격이면 → exit 2", () =>
  assertBlocked("remote app", { ...CONFIRM, DATABASE_URL: LOCAL_OK.replace("54329", "1"), F22_SMOKE_BASE_URL: "https://daewon-mes.vercel.app" }, "F22_SMOKE_BASE_URL"))

// ── 3) 소스 점검 ──────────────────────────────────────────────────────────────
const smoke = fs.readFileSync(path.join(root, "scripts/f22-browser-smoke.ts"), "utf8")
check("소스: .env/.env.local 자동 로딩 코드가 없다", () => {
  assert.ok(!/loadLocalEnv/.test(smoke))
  assert.ok(!/readFileSync\([^)]*\.env/.test(smoke))
  assert.ok(!/\[\s*"\.env\.local"/.test(smoke))
  assert.ok(!/process\.env\[key\]\s*=/.test(smoke), "환경변수를 파일에서 채워 넣는 코드 금지")
})
check("소스: 가드가 DB 모듈(prisma) 로딩보다 먼저 실행된다", () => {
  const guard = smoke.indexOf("assertLocalTestDbOrExit(")
  const load = smoke.indexOf('require("../src/lib/db/prisma")')
  assert.ok(guard > 0 && load > guard)
})
check("소스: 쓰기 전에 연결된 DB 이름을 확인하고, 확인된 경우에만 cleanup(삭제)을 수행한다", () => {
  assert.ok(smoke.indexOf("await assertConnectedDatabaseIsTest(prisma)") < smoke.indexOf("const fixture = await createFixture()"))
  assert.ok(/if \(databaseVerified\) await cleanup\(\)/.test(smoke))
  assert.ok(!/^\s*await cleanup\(\)\s*$/m.test(smoke.slice(smoke.indexOf(".finally("))))
})

// ── 3b) scripts/db-it (운영 Supabase 를 대상으로 설계되어 있던 실제 DB 통합 스위트) ──────────────
// 옛 방식(운영 프로젝트 식별자 확인 변수 + Supabase 주소 + 운영 테넌트)을 그대로 넣어도 DB 연결 전에 거부되어야 한다. 아래 값은 모두 가짜다.
const OLD_PROD_STYLE: Record<string, string> = {
  DAEWON_DB_IT_CONFIRM: "aquqetajewvhyirmewfy",
  DATABASE_URL: FAKE_PROD,
  DIRECT_URL: FAKE_PROD,
  NEXT_PUBLIC_SUPABASE_URL: "https://aquqetajewvhyirmewfy.supabase.co",
  DEFAULT_TENANT_ID: "daewon-001",
}
function assertDbItBlocked(label: string, script: string, extraEnv: Record<string, string>, expectText: string) {
  const r = runTsScript(script, extraEnv)
  assert.equal(r.status, 2, `${label}: exit code ${r.status}\n${r.output.slice(0, 400)}`)
  assert.ok(r.output.includes("ABORT [db-it]") && r.output.includes(expectText), `${label}: 안내 메시지\n${r.output.slice(0, 400)}`)
  assert.ok(!/Prisma|Can't reach database|ECONNREFUSED|ENOTFOUND|P1001/i.test(r.output), `${label}: DB 연결을 시도한 흔적\n${r.output.slice(0, 400)}`)
  assert.ok(!r.output.includes("FAKE-PASSWORD-FOR-GUARD-TEST"), `${label}: 접속 정보 노출`)
}
const dbItFiles = fs.readdirSync(path.join(root, "scripts/db-it")).filter((n) => n.endsWith(".ts") || n.endsWith(".js"))

check("db-it 실행: 옛 방식(운영 프로젝트 식별자 + Supabase 주소 + daewon-001)의 읽기 전용 점검(00-inspect) → exit 2, 연결 시도 없음", () =>
  assertDbItBlocked("db-it 00 old-style", "scripts/db-it/00-inspect.ts", OLD_PROD_STYLE, "DAEWON_TEST_DB_CONFIRM"))
check("db-it 실행: 옛 방식 입력으로 쓰기 스위트(09-lot-rule, lib.ts 경유) → exit 2, 연결 시도 없음", () =>
  assertDbItBlocked("db-it 09 old-style", "scripts/db-it/09-lot-rule.ts", OLD_PROD_STYLE, "관리형/운영"))
check("db-it 실행: 환경변수 없음(.env.local 이 있어도 읽지 않음)으로 시드 스위트(01-seed) → exit 2", () =>
  assertDbItBlocked("db-it 01 no env", "scripts/db-it/01-seed.ts", {}, "DATABASE_URL"))
check("db-it 실행: 승인 + 가짜 운영 주소(로컬 아님) → exit 2", () =>
  assertDbItBlocked("db-it 08 remote", "scripts/db-it/08-lot-rule-inspect.ts", { ...CONFIRM, DATABASE_URL: FAKE_REMOTE, DEFAULT_TENANT_ID: "x" }, "로컬"))

check("db-it/with-env.js: 운영 주소면 명령을 실행하지 않고(exit 2), 로컬 *_test 면 실행한다", () => {
  const run = (extraEnv: Record<string, string>) =>
    spawnSync(process.execPath, ["scripts/db-it/with-env.js", "node", "-e", "console.log('COMMAND_RAN')"], { // 경로에 공백이 있는 execPath 대신 PATH 의 node 사용(shell 실행)
      cwd: root,
      env: minimalEnv(extraEnv),
      encoding: "utf8",
      timeout: 120_000,
    })
  const blocked = run({ ...OLD_PROD_STYLE, ...CONFIRM })
  const blockedOut = `${blocked.stdout}${blocked.stderr}`
  assert.equal(blocked.status, 2, blockedOut.slice(0, 300))
  assert.ok(!blockedOut.includes("COMMAND_RAN") && !blockedOut.includes("FAKE-PASSWORD-FOR-GUARD-TEST"))
  const allowed = run({ ...CONFIRM, DATABASE_URL: LOCAL_OK, DEFAULT_TENANT_ID: "t" })
  assert.equal(allowed.status, 0, `${allowed.stdout}${allowed.stderr}`.slice(0, 300))
  assert.ok(`${allowed.stdout}`.includes("COMMAND_RAN"))
})

check("db-it 소스: .env/.env.local 읽기·운영 프로젝트 식별자·tenant 고정값이 코드에 없다", () => {
  for (const name of dbItFiles) {
    const code = fs
      .readFileSync(path.join(root, "scripts/db-it", name), "utf8")
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n")
    assert.ok(!/aquqetajewvhyirmewfy/.test(code), `${name}: 운영 프로젝트 식별자`)
    assert.ok(!/readFileSync\([^)]*\.env/.test(code) && !/DEFAULT_ENV_FILE|DAEWON_ENV_FILE/.test(code), `${name}: 환경 파일 로딩`)
    assert.ok(!/process\.env\[[^\]]+\]\s*=\s*m\[/.test(code), `${name}: 파일 값을 환경변수로 올리는 코드`)
    assert.ok(!/"daewon-001"/.test(code), `${name}: 운영 테넌트 고정`)
  }
})
check("db-it 소스: 모든 스크립트는 가드를 거친다(lib.ts 경유 18개 + 직접 verifyTarget 2개), 가드가 DB 접속 코드보다 먼저", () => {
  const read = (n: string) => fs.readFileSync(path.join(root, "scripts/db-it", n), "utf8").split("\r\n").join("\n")
  const viaLib = dbItFiles.filter((n) => /^\d+-.*\.ts$/.test(n) && /from "\.\/lib"/.test(read(n)))
  const direct = ["00-inspect.ts", "08-lot-rule-inspect.ts"]
  const numbered = dbItFiles.filter((n) => /^\d+-.*\.ts$/.test(n))
  assert.equal(viaLib.length + direct.length, numbered.length, "가드를 거치지 않는 db-it 스크립트가 있다: " + numbered.filter((n) => !viaLib.includes(n) && !direct.includes(n)).join(","))
  const lib = read("lib.ts")
  const guardAt = lib.indexOf("verifyTarget()\n")
  const dbAt = Math.min(...["new PrismaClient", 'require("@/lib/db/prisma")', 'require("../../src/lib/db/prisma")', "src/lib/db/prisma"].map((k) => lib.indexOf(k)).filter((i) => i >= 0))
  assert.ok(guardAt > 0 && guardAt < dbAt, "lib.ts: verifyTarget() 는 DB 모듈 로딩보다 먼저여야 한다")
  for (const n of direct) {
    const src = read(n)
    assert.ok(src.indexOf("verifyTarget()") > 0 && src.indexOf("verifyTarget()") < src.indexOf("new PrismaClient("), `${n}: 가드가 PrismaClient 생성보다 먼저`)
  }
})

// ── 4) 실제 .env.local 값으로 시뮬레이션 (메모리에서만, 출력 없음) ─────────────────
check("실제 .env.local 값은 가드가 거부한다(있을 때만 검사, 값은 출력하지 않음)", () => {
  const file = path.join(root, ".env.local")
  if (!fs.existsSync(file)) {
    console.log("   (건너뜀: .env.local 없음)")
    return
  }
  const parsed: Record<string, string> = {}
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) parsed[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  const env = { ...CONFIRM, DATABASE_URL: parsed.DATABASE_URL, DIRECT_URL: parsed.DIRECT_URL }
  assert.equal(checkLocalTestDbEnv(env).ok, false, ".env.local 의 DB 주소가 가드를 통과했습니다")
})

console.log(`\n${passed} checks passed`)
