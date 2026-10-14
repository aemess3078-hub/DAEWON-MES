/**
 * 개발/테스트 Master seed 실행 가드 (순수)
 *
 * 운영(Production)에는 seed 로 대원정밀 Master 를 넣지 않는다. 운영 반영은 Validation → Preview → 사용자 승인 → 명시적 Import(Phase 7B)뿐.
 * 이 가드는 seed CLI 가 "의도하지 않은 DB"(특히 운영)에 쓰는 것을 막는다.
 *
 *  - MASTER_SEED_CONFIRM=DEV_ONLY 가 있어야 한다.
 *  - 대상 DB 는 일반 DATABASE_URL/DIRECT_URL 이 아니라 별도 변수 MASTER_SEED_DATABASE_URL 로만 받는다.
 *  - 그 URL 의 호스트가 DATABASE_URL / DIRECT_URL 의 호스트와 같으면 거부한다(운영 설정 오지정 방지).
 *  - Vercel / NODE_ENV=production 에서는 거부한다.
 */

export type SeedEnv = Record<string, string | undefined>

export class SeedGuardError extends Error {
  readonly isSeedGuardError = true
  constructor(message: string) {
    super(message)
    Object.setPrototypeOf(this, SeedGuardError.prototype)
  }
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

export function assertDevSeedTarget(env: SeedEnv): { databaseUrl: string; host: string } {
  if (env.VERCEL || env.VERCEL_ENV) throw new SeedGuardError("Vercel 환경에서는 Master seed 를 실행할 수 없습니다.")
  if (env.NODE_ENV === "production") throw new SeedGuardError("NODE_ENV=production 에서는 Master seed 를 실행할 수 없습니다.")
  if (env.MASTER_SEED_CONFIRM !== "DEV_ONLY") throw new SeedGuardError("MASTER_SEED_CONFIRM=DEV_ONLY 가 필요합니다(개발/테스트 DB 전용).")
  const url = env.MASTER_SEED_DATABASE_URL
  if (!url) throw new SeedGuardError("MASTER_SEED_DATABASE_URL 이 필요합니다(개발/테스트 DB 의 접속 문자열).")
  const host = hostOf(url)
  if (!host) throw new SeedGuardError("MASTER_SEED_DATABASE_URL 형식이 올바르지 않습니다.")
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const other = hostOf(env[name])
    if (other !== null && other === host) {
      throw new SeedGuardError(`MASTER_SEED_DATABASE_URL 의 호스트가 ${name} 와 같습니다. 운영/기본 DB 에는 Master seed 를 실행하지 않습니다.`)
    }
  }
  return { databaseUrl: url, host }
}

export const isSeedGuardError = (e: unknown): e is SeedGuardError =>
  typeof e === "object" && e !== null && (e as { isSeedGuardError?: boolean }).isSeedGuardError === true
