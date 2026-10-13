// 작업표준서(PDF) Supabase Storage 래퍼 — private 버킷 + 서버 발급 signed URL.
//
// - 버킷 "work-standards" 는 private 이다. 공개 URL 은 동작하지 않는다.
// - service_role key 는 이 파일(서버 코드)에서만 사용하며 클라이언트로 내보내지 않는다.
// - DB(Document.fileUrl)에는 만료되는 signed URL 이 아니라 **저장소 참조**("storage://work-standards/<object path>")를
//   저장한다. 화면/POP 에 보여줄 때만 resolveWorkStandardFileUrls() 로 짧은 만료의 signed URL 로 바꾼다.
// - 외부 링크(http/https)로 직접 입력한 값은 그대로 통과시킨다.
// - 과거 public URL(".../storage/v1/object/public/work-standards/<path>") 이 저장된 데이터도 같은 방식으로 signed URL 로 변환한다.

export const WORK_STANDARD_BUCKET = "work-standards"
const REF_PREFIX = `storage://${WORK_STANDARD_BUCKET}/`

/** 웹 목록/편집 화면용 signed URL 만료(초) */
export const WORK_STANDARD_WEB_URL_TTL_SECONDS = 60 * 60
/** POP 화면용 signed URL 만료(초) — 교대 근무 동안 화면이 열려 있는 경우를 고려 */
export const WORK_STANDARD_POP_URL_TTL_SECONDS = 4 * 60 * 60

function getSupabaseConfig(): { supabaseUrl: string; serviceKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "파일 저장소 설정이 필요합니다. 환경 변수(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)를 확인하세요.",
    )
  }
  return { supabaseUrl, serviceKey }
}

function authHeaders(serviceKey: string): Record<string, string> {
  return { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey }
}

// ─── 참조 문자열 ──────────────────────────────────────────────────────────────

export function buildWorkStandardRef(objectPath: string): string {
  return `${REF_PREFIX}${objectPath}`
}

/** 저장소 참조 또는 과거 public URL 이면 object path 를, 아니면(외부 링크 등) null 을 반환한다. */
export function parseWorkStandardObjectPath(value: string | null | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  if (v.startsWith(REF_PREFIX)) return v.slice(REF_PREFIX.length) || null
  const m = v.match(/\/storage\/v1\/object\/(?:public|sign)\/work-standards\/([^?#]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

export function isWorkStandardStorageRef(value: string | null | undefined): boolean {
  return parseWorkStandardObjectPath(value) !== null
}

// ─── 버킷 보장(private) ───────────────────────────────────────────────────────

let bucketVerified = false

/**
 * 버킷이 없으면 private 으로 생성한다. 이미 있는데 public 이면 업로드를 거부한다
 * (작업표준서가 공개 URL 로 노출되는 것을 막는 안전장치).
 */
async function ensurePrivateBucket(): Promise<void> {
  if (bucketVerified) return
  const { supabaseUrl, serviceKey } = getSupabaseConfig()
  const headers = authHeaders(serviceKey)

  const check = await fetch(`${supabaseUrl}/storage/v1/bucket/${WORK_STANDARD_BUCKET}`, { headers })
  if (check.ok) {
    const info = (await check.json().catch(() => ({}))) as { public?: boolean }
    if (info.public === true) {
      throw new Error(
        `Storage 버킷 "${WORK_STANDARD_BUCKET}" 이 public 입니다. private 로 변경한 뒤 다시 시도하세요.`,
      )
    }
    bucketVerified = true
    return
  }

  const create = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: WORK_STANDARD_BUCKET, name: WORK_STANDARD_BUCKET, public: false }),
  })
  if (!create.ok && create.status !== 409) {
    const body = await create.text().catch(() => "")
    throw new Error(`Storage 버킷 생성에 실패했습니다. (HTTP ${create.status}) ${body}`)
  }
  bucketVerified = true
}

// ─── 업로드 / 삭제 ────────────────────────────────────────────────────────────

export async function uploadWorkStandardObject(objectPath: string, body: ArrayBuffer): Promise<void> {
  await ensurePrivateBucket()
  const { supabaseUrl, serviceKey } = getSupabaseConfig()
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${WORK_STANDARD_BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...authHeaders(serviceKey), "Content-Type": "application/pdf", "x-upsert": "false" },
    body,
  })
  if (!res.ok) {
    let detail = ""
    try {
      detail = JSON.stringify(await res.json())
    } catch {
      detail = await res.text().catch(() => "")
    }
    throw new Error(`파일 업로드에 실패했습니다. (HTTP ${res.status}) ${detail}`)
  }
}

// ─── signed URL ──────────────────────────────────────────────────────────────

/**
 * 저장된 fileUrl 값 목록을 화면에 보여줄 URL 목록으로 변환한다(입력과 같은 순서).
 *  - 저장소 참조/과거 public URL → 짧은 만료의 signed URL (실패 시 null)
 *  - 외부 링크(http/https 등) → 그대로
 *  - 빈 값 → null
 */
export async function resolveWorkStandardFileUrls(
  values: Array<string | null | undefined>,
  expiresInSeconds: number = WORK_STANDARD_WEB_URL_TTL_SECONDS,
): Promise<Array<string | null>> {
  const paths = Array.from(
    new Set(values.map((v) => parseWorkStandardObjectPath(v)).filter((p): p is string => !!p)),
  )
  const signed = new Map<string, string>()

  if (paths.length > 0) {
    try {
      const { supabaseUrl, serviceKey } = getSupabaseConfig()
      const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/${WORK_STANDARD_BUCKET}`, {
        method: "POST",
        headers: { ...authHeaders(serviceKey), "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: expiresInSeconds, paths }),
      })
      if (res.ok) {
        const items = (await res.json()) as Array<{ path?: string; signedURL?: string | null; error?: string | null }>
        for (const it of items) {
          if (it.path && it.signedURL && !it.error) signed.set(it.path, `${supabaseUrl}/storage/v1${it.signedURL}`)
        }
      } else {
        console.error(`[work-standard-storage] signed URL 발급 실패 (HTTP ${res.status})`)
      }
    } catch (e) {
      console.error("[work-standard-storage] signed URL 발급 오류:", e instanceof Error ? e.message : e)
    }
  }

  return values.map((v) => {
    const trimmed = v?.trim()
    if (!trimmed) return null
    const p = parseWorkStandardObjectPath(trimmed)
    if (p === null) return trimmed // 외부 링크
    return signed.get(p) ?? null
  })
}
