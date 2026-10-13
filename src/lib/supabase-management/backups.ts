// 청운커팅 사업계획서 "기준정보관리 > 백업관리"의 Supabase Management API
// 래퍼(백업 "목록 조회" 전용, GET 1개만).
//
// 절대 원칙 — 이 파일에는 다음을 절대 추가하지 않는다:
//   - backup 생성/삭제(DELETE /database/backups/...)
//   - restore / PITR restore
//   - 그 외 어떤 Supabase 프로젝트 mutation 엔드포인트도 호출하지 않는다
// NMES는 Supabase 자동 백업의 "조회 + 분류(그룹/숨김) UI" 역할만 하며, 실제
// 백업의 생성/보존/삭제는 계속 Supabase가 전담한다(§ STEP 27).
//
// 인증 — 기존 PR #70의 SUPABASE_SERVICE_ROLE_KEY(Storage/DB 데이터 접근용)와는
// 완전히 다른 credential이다. Management API는 프로젝트 관리 권한을 가진
// 별도의 access token(SUPABASE_MANAGEMENT_ACCESS_TOKEN)이 필요하며, 이 토큰은
// 서버에서만 사용하고 NEXT_PUBLIC_*로 절대 노출하지 않는다. 저장소를 감사한
// 결과 기존에 이 용도의 env var는 없어(§ STEP 5) 새로 도입했다 — 실제 값은
// Vercel/로컬 .env.local에 별도로 설정해야 하며, 미설정 시 이 모듈은 조용히
// "unavailable" 신호만 반환한다(throw하지 않음, § STEP 23).
//
// 프로젝트 ref는 새 env var를 추가하지 않고 기존 NEXT_PUBLIC_SUPABASE_URL
// (https://<ref>.supabase.co)에서 파싱해 재사용한다(§ STEP 5 "프로젝트 ref도
// 기존 env를 우선 재사용한다").

const MANAGEMENT_API_BASE = "https://api.supabase.com/v1"

export function getSupabaseProjectRef(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return null
  try {
    const host = new URL(url).hostname // "<ref>.supabase.co"
    const ref = host.split(".")[0]
    return ref || null
  } catch {
    return null
  }
}

// 실제 Supabase Management API 응답 형태를 이 환경에서 라이브 토큰 없이 검증하지
// 못했다(§ STEP 4/32 — 최종 보고에 명시). 공개 API 레퍼런스 기준으로 파싱하되,
// backup 항목별 안정적인 id 필드 존재 여부가 불확실할 수 있어 아래 타입은
// 의도적으로 느슨하게(optional 위주) 정의한다 — 실제 파싱/정규화 로직은
// backup.helpers.ts의 normalizeExternalBackupId가 id 유무와 무관하게 안전한
// 문자열 식별자를 만들어낸다.
export type SupabaseBackupsApiResponse = {
  region?: string
  walg_enabled?: boolean
  pitr_enabled?: boolean
  backups?: Array<{
    id?: string | number
    status?: string
    inserted_at?: string
    is_physical_backup?: boolean
  }>
}

/**
 * GET /v1/projects/{ref}/database/backups — 유일한 네트워크 호출.
 * 토큰 미설정/네트워크 오류/비정상 응답이면 null을 반환한다(throw하지 않음).
 * 화면은 null을 "백업 정보를 불러올 수 없습니다"로 표시하고, 원인(상태
 * 코드 등)은 서버 로그에만 남긴다 — 토큰/응답 본문을 사용자에게 노출하지 않는다.
 */
export async function fetchSupabaseBackupsRaw(): Promise<SupabaseBackupsApiResponse | null> {
  const token = process.env.SUPABASE_MANAGEMENT_ACCESS_TOKEN
  const ref = getSupabaseProjectRef()
  if (!token || !ref) {
    console.error("[backup-management] SUPABASE_MANAGEMENT_ACCESS_TOKEN 또는 project ref가 설정되지 않았습니다.")
    return null
  }

  try {
    const res = await fetch(`${MANAGEMENT_API_BASE}/projects/${ref}/database/backups`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
    if (!res.ok) {
      console.error(`[backup-management] Supabase Management API 응답 오류: HTTP ${res.status}`)
      return null
    }
    return (await res.json()) as SupabaseBackupsApiResponse
  } catch (e) {
    console.error(`[backup-management] Supabase Management API 호출 실패: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
}
