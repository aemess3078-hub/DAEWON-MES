/**
 * 5단계 실제 DB 통합 테스트 공통: 접속 환경 로드와 대상 확인(실행 안전장치).
 *
 * - 접속 정보는 저장소 밖의 .env.local(메인 worktree)에서 프로세스 환경변수로만 읽는다 — 이 worktree 에 복사하거나 출력하지 않는다.
 * - 비밀번호·연결 문자열·키는 어디에도 출력하지 않는다. 호스트/프로젝트 식별자만 요약한다.
 * - 이 스위트는 대원정밀 Supabase 프로젝트에만 실행된다. 아래 세 조건을 모두 만족하지 않으면 실행을 거부한다.
 *     1) DAEWON_DB_IT_CONFIRM 이 기대 프로젝트 식별자와 정확히 같다(명시적 실행 확인 — 설정하지 않으면 DB 에 접근하지 않는다)
 *     2) DATABASE_URL · DIRECT_URL · NEXT_PUBLIC_SUPABASE_URL 이 모두 같은 기대 프로젝트를 가리키고 DB 이름이 postgres 이다
 *     3) DEFAULT_TENANT_ID 가 daewon-001 이다
 */
import { readFileSync, existsSync } from "node:fs"

export const EXPECTED_PROJECT_REF = "aquqetajewvhyirmewfy"
export const EXPECTED_DATABASE = "postgres"
export const EXPECTED_TENANT = "daewon-001"
export const CONFIRM_VAR = "DAEWON_DB_IT_CONFIRM"

const DEFAULT_ENV_FILE = "C:/Users/Mingrid/Documents/사업/MES/01_REPOS/DAEWON-MES/.env.local"

export function loadEnv(): { file: string } {
  const file = process.env.DAEWON_ENV_FILE ?? DEFAULT_ENV_FILE
  if (!existsSync(file)) throw new Error(`환경 파일을 찾을 수 없습니다: ${file}`)
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return { file }
}

export type DbTarget = { host: string; port: string; database: string; projectRef: string; directProjectRef: string; supabaseHost: string; tenantId: string }

function refOf(url: string | undefined): { host: string; port: string; database: string; projectRef: string } {
  if (!url) return { host: "", port: "", database: "", projectRef: "" }
  const u = new URL(url)
  return { host: u.hostname, port: u.port, database: u.pathname.replace("/", ""), projectRef: decodeURIComponent(u.username).split(".")[1] ?? "" }
}

export function describeTarget(): DbTarget {
  const main = refOf(process.env.DATABASE_URL)
  const direct = refOf(process.env.DIRECT_URL)
  const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : ""
  return { ...main, directProjectRef: direct.projectRef, supabaseHost, tenantId: process.env.DEFAULT_TENANT_ID ?? "" }
}

/** 대상이 대원정밀 프로젝트가 아니거나 불분명하면 예외를 던진다. 통과해도 접속 정보는 반환하지 않고 식별 정보만 돌려준다. */
export function verifyTarget(): DbTarget {
  if (process.env[CONFIRM_VAR] !== EXPECTED_PROJECT_REF) {
    throw new Error(`실행 확인이 없어 중단합니다. 대원정밀 DB 에 테스트 데이터를 쓰려면 ${CONFIRM_VAR}=${EXPECTED_PROJECT_REF} 를 명시하세요.`)
  }
  const t = describeTarget()
  const problems: string[] = []
  if (t.projectRef !== EXPECTED_PROJECT_REF) problems.push("DATABASE_URL 의 프로젝트가 기대값과 다름")
  if (t.directProjectRef !== EXPECTED_PROJECT_REF) problems.push("DIRECT_URL 의 프로젝트가 기대값과 다르거나 없음")
  if (t.supabaseHost !== `${EXPECTED_PROJECT_REF}.supabase.co`) problems.push("NEXT_PUBLIC_SUPABASE_URL 이 기대 프로젝트가 아님")
  if (t.database !== EXPECTED_DATABASE) problems.push("DB 이름이 기대값과 다름")
  if (t.tenantId !== EXPECTED_TENANT) problems.push("DEFAULT_TENANT_ID 가 기대값과 다름")
  if (problems.length > 0) throw new Error(`연결 대상이 대원정밀(${EXPECTED_TENANT}) 프로젝트로 확인되지 않아 중단합니다: ${problems.join("; ")}`)
  return t
}

/** 테스트 POP PIN 은 코드에 두지 않고 환경변수로만 받는다. */
export function testPopPin(): string {
  const pin = process.env.ZT5_POP_PIN
  if (!pin) throw new Error("ZT5_POP_PIN 환경변수(테스트 전용 POP PIN)가 필요합니다.")
  return pin
}
