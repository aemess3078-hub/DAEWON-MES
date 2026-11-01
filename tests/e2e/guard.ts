import { assertLocalTestDbOrExit } from "../../scripts/helpers/local-test-db-guard"

/** 로컬 테스트 DB 가 아니면(또는 서버 주소가 로컬이 아니면) 테스트를 시작하기 전에 종료한다. */
export function assertSafeE2eEnvironment() {
  assertLocalTestDbOrExit("e2e-menu", process.env, { baseUrlVar: "UI_BASE", defaultBaseUrl: "http://127.0.0.1:3130" })
}

export const E2E_BASE = process.env.UI_BASE ?? "http://127.0.0.1:3130"

export function adminCredentials() {
  const loginId = process.env.SEED_ADMIN_LOGIN_ID
  const password = process.env.SEED_ADMIN_PASSWORD
  if (!loginId || !password) throw new Error("SEED_ADMIN_LOGIN_ID / SEED_ADMIN_PASSWORD 환경변수가 필요합니다(테스트 DB seed 계정).")
  return { loginId, password }
}

/** 개발자 전용 경로 검증용(테스트 DB seed 의 test 계정). */
export function developerCredentials() {
  const loginId = process.env.SEED_DEVELOPER_LOGIN_ID
  const password = process.env.SEED_DEVELOPER_PASSWORD
  if (!loginId || !password) throw new Error("SEED_DEVELOPER_LOGIN_ID / SEED_DEVELOPER_PASSWORD 환경변수가 필요합니다(테스트 DB seed 계정).")
  return { loginId, password }
}
