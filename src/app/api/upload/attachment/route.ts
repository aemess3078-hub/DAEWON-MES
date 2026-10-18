import { randomUUID } from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireRole, getTenantId } from "@/lib/auth"
import { ROLE_PERMISSION_DENIED_MESSAGE } from "@/lib/auth/role-permissions"
import { uploadAttachmentFile, deleteAttachmentFile } from "@/lib/storage/attachment-storage"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"
import { assertAttachmentEntityOwnership, requireAttachmentEntityPermission } from "@/lib/actions/attachment.actions"
import {
  isValidAttachmentEntityType,
  validateAttachmentFile,
  sanitizeFileName,
  buildAttachmentStoragePath,
} from "@/lib/actions/attachment.helpers"

// 대원정밀 구축 범위 밖 화면(원인분석/조치관리/재발방지/설비수리)에서만 쓰이는 업무유형
// (원인분석/조치관리/재발방지는 Phase 10 / DG-016 에서 범위에 포함 — 설비수리만 개발자 전용으로 남는다)
const OUT_OF_SCOPE_ENTITY_TYPES = new Set([
  "EQUIPMENT_REPAIR_REQUEST",
])

// ─── POST /api/upload/attachment ─────────────────────────────────────────────
//
// 파일 바이너리 바디를 다루므로 Server Action이 아니라 Route Handler로
// 구현한다(기존 /api/upload/work-standard와 동일 convention). work-standard와
// 달리 이 첨부파일은 비공개(private) 버킷에 저장하고 public URL을 반환하지
// 않는다 — 다운로드는 attachment.actions.ts의 getAttachmentDownloadUrl(짧은
// 유효시간 signed URL)로만 가능하다.
//
// 순서: 서버측 검증(권한/entity 소유권/파일형식·크기) → Storage 업로드 →
// DB INSERT + AuditLog CREATE(트랜잭션). Storage 업로드가 성공한 뒤 DB INSERT가
// 실패하면 orphan 파일이 남지 않도록 방금 올린 Storage 객체를 보상 삭제한다
// (§ STEP 22).

export async function POST(req: NextRequest) {
  let uploadedStoragePath: string | null = null
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const formData = await req.formData()
    const file = formData.get("file")
    const entityType = formData.get("entityType")
    const entityId = formData.get("entityId")
    const description = formData.get("description")

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일을 선택하세요." }, { status: 400 })
    }
    if (typeof entityType !== "string" || !isValidAttachmentEntityType(entityType)) {
      return NextResponse.json({ error: "지원하지 않는 업무유형입니다." }, { status: 400 })
    }
    if (OUT_OF_SCOPE_ENTITY_TYPES.has(entityType)) await assertDaewonFeatureScope()
    if (typeof entityId !== "string" || !entityId.trim()) {
      return NextResponse.json({ error: "연결 대상을 확인할 수 없습니다." }, { status: 400 })
    }

    // entity 소유권(현재 tenant 소속 여부) 서버 재검증 — client가 보낸 entityId를 신뢰하지 않는다.
    await assertAttachmentEntityOwnership(entityType, entityId, tenantId)
    await requireAttachmentEntityPermission(entityType, "CREATE", actor)

    validateAttachmentFile(file.name, file.size)

    const safeName = sanitizeFileName(file.name)
    const storagePath = buildAttachmentStoragePath(tenantId, entityType, entityId, safeName, randomUUID())

    const arrayBuffer = await file.arrayBuffer()
    await uploadAttachmentFile(storagePath, file.type, arrayBuffer)
    uploadedStoragePath = storagePath

    const created = await prisma.$transaction(async (tx) => {
      const attachment = await tx.attachment.create({
        data: {
          tenantId,
          entityType,
          entityId,
          fileName: file.name,
          storagePath,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          description: typeof description === "string" && description.trim() ? description.trim() : null,
          uploadedById: actor.id,
        },
      })
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "Attachment",
          entityId: attachment.id,
          action: "CREATE",
          afterData: {
            fileName: attachment.fileName,
            fileSize: attachment.fileSize,
            storagePath: attachment.storagePath,
            entityType: attachment.entityType,
            entityId: attachment.entityId,
          },
          menuName: "첨부파일관리",
        },
      })
      return attachment
    })

    return NextResponse.json({ id: created.id, fileName: created.fileName, fileSize: created.fileSize })
  } catch (err) {
    // Storage 업로드는 성공했지만 이후 단계(DB INSERT 등)에서 실패한 경우, 참조되지
    // 않는 orphan 파일이 Storage에 남지 않도록 보상 삭제를 시도한다. 이 보상 자체가
    // 실패해도 사용자에게 노출할 원래 오류를 덮지 않고 로그만 남긴다.
    if (uploadedStoragePath) {
      const cleanup = await deleteAttachmentFile(uploadedStoragePath)
      if (!cleanup.ok) {
        console.error(`[attachment upload] compensation cleanup failed: ${uploadedStoragePath} — ${cleanup.error}`)
      }
    }
    const message = err instanceof Error ? err.message : "파일 업로드 중 오류가 발생했습니다."
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 })
    }
    if (message === "FORBIDDEN" || message === ROLE_PERMISSION_DENIED_MESSAGE) {
      return NextResponse.json({ error: "업로드 권한이 없습니다." }, { status: 403 })
    }
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
