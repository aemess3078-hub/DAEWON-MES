/**
 * 로컬 테스트 DB 전용 실행 가드 (순수 모듈 — DB/파일 접근 없음, alias 없음)
 *
 * 데이터를 만들고 지우는 테스트 스크립트(예: f22-browser-smoke)가 운영 DB 에 연결하지 못하게 한다.
 * 스크립트의 "맨 처음"에 호출하고, 통과하지 못하면 DB 에 연결하기 전에 프로세스를 종료한다(exit 2).
 *
 * 모두 만족해야 통과한다:
 *   1. DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB — 로컬 테스트 DB 에 쓰는 것을 명시적으로 승인
 *   2. DATABASE_URL 이 "프로세스 환경변수"로 직접 지정되어 있을 것 — .env / .env.local 에서 자동으로 가져오지 않는다
 *   3. 호스트가 정확히 127.0.0.1 / localhost / [::1], 데이터베이스 이름이 `*_test`, 접속 주소를 바꾸는 쿼리(host=…)가 없을 것
 *   4. DIRECT_URL 이 지정되어 있다면 같은 조건을 만족할 것(마이그레이션용 직접 연결 주소가 운영을 가리키지 않게)
 *   5. 앱 서버 주소(baseUrlVar)도 로컬일 것 — 원격/운영 서버를 브라우저로 조작하지 않는다
 * 오류 메시지에는 호스트/DB명만 표시하고 비밀번호 등 접속 정보는 출력하지 않는다.
 */

const CONFIRM_VAR = "DAEWON_TEST_DB_CONFIRM"
const CONFIRM_VALUE = "YES_LOCAL_TEST_DB"
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])
const FORBIDDEN_QUERY_KEYS = new Set(["host", "hostaddr", "service", "servicefile", "passfile"])
const TEST_DB_NAME = /^[A-Za-z0-9_]+_test$/

type Env = Record<string, string | undefined>

export type DbUrlCheck = { ok: true; host: string; port: string; database: string } | { ok: false; reason: string }

/** 접속 주소 하나를 검사한다. 실패 사유에는 접속 정보(계정/비밀번호)를 넣지 않는다. */
export function checkLocalTestDbUrl(name: string, raw: string | undefined): DbUrlCheck {
  if (!raw || !raw.trim()) {
    return { ok: false, reason: `${name} 가 환경변수로 지정되지 않았습니다(.env.local 등에서 자동으로 읽지 않습니다).` }
  }
  if (/supabase|pooler|amazonaws|azure|neon\.tech|render\.com/i.test(raw)) {
    return { ok: false, reason: `${name} 가 관리형/운영 DB 주소로 보입니다.` }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: `${name} 의 형식을 해석할 수 없습니다.` }
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return { ok: false, reason: `${name} 가 PostgreSQL 주소가 아닙니다.` }
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    return { ok: false, reason: `${name} 의 호스트(${url.hostname || "(없음)"})가 로컬(127.0.0.1/localhost/[::1])이 아닙니다.` }
  }
  for (const key of Array.from(url.searchParams.keys())) {
    if (FORBIDDEN_QUERY_KEYS.has(key.toLowerCase())) {
      return { ok: false, reason: `${name} 에 접속 대상을 바꾸는 파라미터(${key})가 있습니다.` }
    }
  }
  let database = ""
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ""))
  } catch {
    return { ok: false, reason: `${name} 의 DB 이름을 해석할 수 없습니다.` }
  }
  if (!TEST_DB_NAME.test(database)) {
    return { ok: false, reason: `${name} 의 DB 이름(${database || "(없음)"})이 *_test 가 아닙니다.` }
  }
  return { ok: true, host: url.hostname, port: url.port || "5432", database }
}

export type GuardOptions = {
  /** 앱 서버 주소를 읽을 환경변수 이름(브라우저 테스트용). 지정하면 로컬 주소만 허용한다. */
  baseUrlVar?: string
  /** baseUrlVar 가 비었을 때 스크립트가 쓰는 기본 주소 */
  defaultBaseUrl?: string
}

export type GuardResult = { ok: true; target: string } | { ok: false; reasons: string[] }

/** 환경변수 집합이 "로컬 테스트 DB 에 쓰기" 조건을 모두 만족하는지 검사한다(순수 함수). */
export function checkLocalTestDbEnv(env: Env, options: GuardOptions = {}): GuardResult {
  const reasons: string[] = []

  if (env[CONFIRM_VAR] !== CONFIRM_VALUE) {
    reasons.push(`${CONFIRM_VAR}=${CONFIRM_VALUE} 로 로컬 테스트 DB 쓰기를 명시적으로 승인해야 합니다.`)
  }

  const main = checkLocalTestDbUrl("DATABASE_URL", env.DATABASE_URL)
  if (!main.ok) reasons.push(main.reason)

  if (env.DIRECT_URL !== undefined && env.DIRECT_URL !== "") {
    const direct = checkLocalTestDbUrl("DIRECT_URL", env.DIRECT_URL)
    if (!direct.ok) reasons.push(direct.reason)
    else if (main.ok && (direct.host !== main.host || direct.port !== main.port || direct.database !== main.database)) {
      reasons.push("DIRECT_URL 이 DATABASE_URL 과 다른 대상입니다.")
    }
  }

  if (options.baseUrlVar) {
    const rawBase = env[options.baseUrlVar] || options.defaultBaseUrl || ""
    try {
      const base = new URL(rawBase)
      if (!LOCAL_HOSTS.has(base.hostname)) reasons.push(`${options.baseUrlVar} 의 호스트(${base.hostname})가 로컬이 아닙니다 — 원격/운영 서버는 조작하지 않습니다.`)
    } catch {
      reasons.push(`${options.baseUrlVar} 의 형식을 해석할 수 없습니다.`)
    }
  }

  if (reasons.length > 0) return { ok: false, reasons }
  return { ok: true, target: main.ok ? `${main.host}:${main.port}/${main.database}` : "" }
}

/**
 * 스크립트 첫 줄에서 호출한다. 조건을 만족하지 않으면 DB 연결 없이 안내를 출력하고 종료(exit 2)한다.
 * 통과하면 대상(호스트:포트/DB명)만 출력한다.
 */
export function assertLocalTestDbOrExit(scriptName: string, env: Env = process.env, options: GuardOptions = {}): void {
  const result = checkLocalTestDbEnv(env, options)
  if (!result.ok) {
    console.error(`ABORT [${scriptName}]: 로컬 테스트 DB 조건을 만족하지 않아 DB 에 연결하지 않고 중단합니다.`)
    for (const reason of result.reasons) console.error(` - ${reason}`)
    process.exit(2)
  }
  console.log(`[${scriptName}] target DB = ${result.target}`)
}

/**
 * (2차 방어) 실제로 연결된 DB 이름이 *_test 인지 확인한다. 쓰기 전에 호출한다.
 * 연결 주소 검사를 통과했더라도 서버가 다른 DB 를 가리키는 비정상 상황이면 쓰기 전에 중단한다.
 */
export async function assertConnectedDatabaseIsTest(db: { $queryRaw: (query: TemplateStringsArray) => Promise<unknown> }): Promise<string> {
  const rows = (await db.$queryRaw`SELECT current_database() AS name`) as Array<{ name: string }>
  const name = rows[0]?.name ?? ""
  if (!TEST_DB_NAME.test(name)) {
    throw new Error(`연결된 DB(${name || "알 수 없음"})가 *_test 가 아니라 쓰기 전에 중단합니다.`)
  }
  return name
}
