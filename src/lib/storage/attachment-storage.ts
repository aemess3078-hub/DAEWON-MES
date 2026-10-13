// 청운커팅 사업계획서 "첨부파일관리"의 Supabase Storage 접근 래퍼.
//
// 기존 work-standard 업로드(src/app/api/upload/work-standard/route.ts)와 동일하게
// @supabase/supabase-js SDK를 추가하지 않고 Storage REST API를 service_role key로
// 직접 호출한다(레포에 이미 확립된 convention 재사용). 단, work-standard 버킷은
// public이라 URL만 알면 누구나 다운로드할 수 있는 구조인데, 첨부파일관리는 품질
// 이력/증빙 자료를 다루므로 **비공개(private) 버킷**을 쓰고 다운로드는 짧은 유효시간의
// signed URL로만 제공한다(§ STEP 6/9). service_role key는 이 파일 밖으로 절대
// 내보내지 않는다 — 클라이언트에서 직접 Storage를 호출하지 않는다.
const BUCKET = "attachments"

function getSupabaseConfig(): { supabaseUrl: string; serviceKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "파일 저장소 설정이 필요합니다. 환경 변수(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)를 확인하세요."
    )
  }
  return { supabaseUrl, serviceKey }
}

/**
 * "attachments" 버킷이 없으면 비공개(private)로 생성한다. work-standard 버킷처럼
 * Supabase 콘솔에서 수동 생성하게 하지 않고, service_role key로 Storage 관리 API를
 * 직접 호출해 최초 업로드 시 자동으로 준비되게 한다(수동 콘솔 조작 불필요).
 */
async function ensureBucketExists(): Promise<void> {
  const { supabaseUrl, serviceKey } = getSupabaseConfig()
  const checkRes = await fetch(`${supabaseUrl}/storage/v1/bucket/${BUCKET}`, {
    headers: { Authorization: `Bearer ${serviceKey}` },
  })
  if (checkRes.ok) return

  // Supabase Storage API는 버킷 미존재를 HTTP transport status가 아니라 JSON 본문의
  // code/statusCode 필드로만 알려준다(실제로 관찰된 응답: HTTP 400 + body
  // {"statusCode":"404","error":"Bucket not found","code":"NoSuchBucket"}). 그래서
  // checkRes.status만으로 판단하지 않고 본문을 파싱해서 "미존재"인지 확인한다.
  const checkBodyText = await checkRes.text().catch(() => "")
  let notFound = checkRes.status === 404
  try {
    const parsed = JSON.parse(checkBodyText) as { statusCode?: string; code?: string }
    if (parsed.code === "NoSuchBucket" || parsed.statusCode === "404") notFound = true
  } catch {
    // 본문이 JSON이 아니면 위에서 판단한 HTTP status 결과를 그대로 사용한다.
  }
  if (!notFound) {
    throw new Error(`Storage 버킷 확인 중 오류가 발생했습니다. (HTTP ${checkRes.status}) ${checkBodyText}`)
  }

  const createRes = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  })
  // 409(이미 존재 — 동시 생성 경쟁)는 정상으로 취급한다.
  if (!createRes.ok && createRes.status !== 409) {
    const body = await createRes.text().catch(() => "")
    throw new Error(`Storage 버킷 생성에 실패했습니다. (HTTP ${createRes.status}) ${body}`)
  }
}

export async function uploadAttachmentFile(
  storagePath: string,
  mimeType: string,
  body: ArrayBuffer
): Promise<void> {
  const { supabaseUrl, serviceKey } = getSupabaseConfig()
  await ensureBucketExists()

  const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": mimeType || "application/octet-stream",
      "x-upsert": "false",
    },
    body,
  })
  if (!res.ok) {
    let errBody = ""
    try {
      errBody = JSON.stringify(await res.json())
    } catch {
      errBody = await res.text().catch(() => "")
    }
    throw new Error(`파일 업로드에 실패했습니다. (HTTP ${res.status}) ${errBody}`)
  }
}

/** 삭제는 예외를 던지지 않고 결과를 반환한다 — 호출부(DB 삭제 이후 보상처리)가 실패를 로그만 남기고 넘어갈 수 있도록. */
export async function deleteAttachmentFile(storagePath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabaseUrl, serviceKey } = getSupabaseConfig()
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${serviceKey}` },
    })
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "")
      return { ok: false, error: `HTTP ${res.status}: ${body}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 짧은 유효시간의 signed URL을 발급한다. storagePath를 그대로 브라우저에 노출하지 않는다. */
export async function createAttachmentSignedUrl(storagePath: string, expiresInSeconds = 60): Promise<string> {
  const { supabaseUrl, serviceKey } = getSupabaseConfig()
  const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${storagePath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expiresIn: expiresInSeconds }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`다운로드 링크 생성에 실패했습니다. (HTTP ${res.status}) ${body}`)
  }
  const json = (await res.json()) as { signedURL?: string }
  if (!json.signedURL) throw new Error("다운로드 링크 생성에 실패했습니다.")
  return `${supabaseUrl}/storage/v1${json.signedURL}`
}
