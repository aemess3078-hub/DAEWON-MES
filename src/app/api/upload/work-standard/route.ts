import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { requireRole, getTenantId } from "@/lib/auth"
import { hasCurrentUserResourcePermission } from "@/lib/auth/role-permissions"
import { buildWorkStandardRef, uploadWorkStandardObject } from "@/lib/storage/work-standard-storage"

// ─── 상수 ────────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  // 20 MB
const ALLOWED_CONTENT_TYPE = "application/pdf"

// ─── POST /api/upload/work-standard ──────────────────────────────────────────
//
// 작업표준서 PDF 를 private 버킷("work-standards")에 업로드한다(서버의 service role 로만 접근).
// 응답의 url 은 공개 URL 이 아니라 저장소 참조("storage://work-standards/<path>")이며,
// 화면/POP 에서 열 때는 서버가 짧은 만료의 signed URL 로 변환한다(work-standard-storage.ts).

export async function POST(req: NextRequest) {
  try {
    // ── 1. 인증 / 권한 ───────────────────────────────────────────────
    await requireRole("OPERATOR")
    // 작업표준서 등록/수정 권한이 있는 사용자만 업로드할 수 있다(현장작업자 OPERATOR 는 조회 전용).
    const canUpload =
      (await hasCurrentUserResourcePermission("WORK_STANDARD", "CREATE")) ||
      (await hasCurrentUserResourcePermission("WORK_STANDARD", "UPDATE"))
    if (!canUpload) throw new Error("FORBIDDEN")
    const tenantId = await getTenantId()

    // ── 2. FormData 파싱 / 파일 검증 ────────────────────────────────
    const formData = await req.formData()
    const file = formData.get("file")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일을 선택하세요." }, { status: 400 })
    }

    const isPdf =
      file.type === ALLOWED_CONTENT_TYPE ||
      file.name.toLowerCase().endsWith(".pdf")

    if (!isPdf) {
      return NextResponse.json(
        { error: "PDF 파일(.pdf)만 업로드할 수 있습니다." },
        { status: 400 },
      )
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "빈 파일은 업로드할 수 없습니다." }, { status: 400 })
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: "파일 크기는 20 MB 이하여야 합니다." },
        { status: 400 },
      )
    }

    // ── 3. 파일명 sanitize + 고유 경로 생성 ─────────────────────────
    const originalName = file.name.trim() || "document.pdf"
    const safeName = originalName
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9._-]/g, "")
      .replace(/\.pdf$/i, "") || "file"
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const objectPath = `${tenantId}/${dateStr}-${randomUUID()}-${safeName}.pdf`

    // ── 4. 실제 PDF 시그니처 확인 ───────────────────────────────────
    // 확장자/MIME 은 클라이언트가 정하므로 "%PDF-" 시그니처도 확인한다.
    const arrayBuffer = await file.arrayBuffer()
    const head = new Uint8Array(arrayBuffer.slice(0, 5))
    const isPdfSignature =
      head.length === 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d
    if (!isPdfSignature) {
      return NextResponse.json({ error: "올바른 PDF 파일이 아닙니다." }, { status: 400 })
    }

    // ── 5. Supabase Storage 업로드 (private 버킷, service role 은 서버에서만) ──
    try {
      await uploadWorkStandardObject(objectPath, arrayBuffer)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "파일 업로드에 실패했습니다."
      console.error(`[work-standard upload] ${msg}`)
      return NextResponse.json({ error: msg }, { status: 500 })
    }

    // ── 6. 저장소 참조 반환 (영구 URL/서명 URL 을 DB 에 저장하지 않는다) ──
    return NextResponse.json({ url: buildWorkStandardRef(objectPath) })
  } catch (err) {
    const message = err instanceof Error ? err.message : "파일 업로드 중 오류가 발생했습니다."
    if (message === "UNAUTHORIZED" || message === "FORBIDDEN") {
      return NextResponse.json({ error: "업로드 권한이 없습니다." }, { status: 403 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
