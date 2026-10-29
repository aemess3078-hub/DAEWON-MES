/**
 * 실제 DB 통합 테스트(db-it) 공통: 실행 안전장치 — 로컬 테스트 DB 전용.
 *
 * 이 스위트는 한때 대원정밀 운영(Supabase) DB 에 직접 실행하도록 만들어져 있었다(.env.local 자동 로딩 + 프로젝트 식별자 일치 시 허용).
 * 실행 확인 값이 비밀이 아니라 스크립트 머리 주석에 그대로 적혀 있어 한 줄만 붙이면 운영 DB 에 시험 데이터를 쓸 수 있는 구조였으므로,
 * f22-browser-smoke 와 같은 가드(scripts/helpers/local-test-db-guard.ts)로 교체했다.
 *
 *  - .env / .env.local 을 읽지 않는다. 접속 정보는 프로세스 환경변수로 직접 지정해야 한다.
 *  - 아래를 모두 만족하지 않으면 DB 에 연결하기 전에 종료한다(exit 2):
 *      DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB, DATABASE_URL 이 127.0.0.1/localhost/[::1] 의 `*_test` DB,
 *      DIRECT_URL 이 있으면 같은 대상, 앱 서버 주소(UI_BASE, 기본 http://localhost:3130)도 로컬, DEFAULT_TENANT_ID 지정.
 *  - 비밀번호·연결 문자열은 출력하지 않는다.
 * 운영 DB 에 대해서는 이 스위트를 실행할 수 없다.
 */
import { assertLocalTestDbOrExit, checkLocalTestDbUrl } from "../helpers/local-test-db-guard"

export const CONFIRM_VAR = "DAEWON_TEST_DB_CONFIRM"

/** (호환용) 이전에는 .env.local 을 읽었다. 이제는 아무 파일도 읽지 않는다. */
export function loadEnv(): { file: string } {
  return { file: "" }
}

export type DbTarget = { host: string; port: string; database: string; projectRef: string; tenantId: string }

export function describeTarget(): DbTarget {
  const main = checkLocalTestDbUrl("DATABASE_URL", process.env.DATABASE_URL)
  return {
    host: main.ok ? main.host : "",
    port: main.ok ? main.port : "",
    database: main.ok ? main.database : "",
    projectRef: "local-test-db",
    tenantId: process.env.DEFAULT_TENANT_ID ?? "",
  }
}

/** 로컬 테스트 DB 가 아니면(또는 승인이 없으면) DB 연결 전에 프로세스를 종료한다. 통과하면 식별 정보만 돌려준다. */
export function verifyTarget(): DbTarget {
  assertLocalTestDbOrExit("db-it", process.env, { baseUrlVar: "UI_BASE", defaultBaseUrl: "http://localhost:3130" })
  const target = describeTarget()
  if (!target.tenantId) {
    console.error("ABORT [db-it]: DEFAULT_TENANT_ID 가 지정되지 않았습니다.")
    process.exit(2)
  }
  return target
}

/** 테스트 POP PIN 은 코드에 두지 않고 환경변수로만 받는다. */
export function testPopPin(): string {
  const pin = process.env.ZT5_POP_PIN
  if (!pin) throw new Error("ZT5_POP_PIN 환경변수(테스트 전용 POP PIN)가 필요합니다.")
  return pin
}
