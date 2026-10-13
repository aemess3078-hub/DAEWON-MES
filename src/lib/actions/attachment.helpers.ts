// attachment.actions.ts("use server")는 async export만 허용되므로, DB/Storage에
// 의존하지 않는 순수 검증/직렬화 로직을 이 파일로 분리한다(defect-corrective-action.helpers.ts와
// 동일한 이유). code-path 테스트는 scripts/test-attachment-management.ts 참조.

// ─── 대상 업무유형(entityType) allow-list ────────────────────────────────────
//
// Attachment는 entityType/entityId 기반 generic 증빙 모델이다. entityType은
// 임의 문자열을 받지 않고 현재 업무에서 서버 소유권/권한/삭제정책을 모두
// 검증할 수 있는 6개 업무유형만 허용한다. 새 유형을 추가할 때는 이 allow-list,
// 권한 매핑, 소유권/라벨/삭제정책을 함께 확장해야 한다.
export const ATTACHMENT_ENTITY_TYPES = [
  "QUALITY_INSPECTION",
  "DEFECT_RECORD",
  "DEFECT_CAUSE_ANALYSIS",
  "DEFECT_CORRECTIVE_ACTION",
  "DEFECT_RECURRENCE_PREVENTION",
  "EQUIPMENT_REPAIR_REQUEST",
] as const
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number]

export const ATTACHMENT_ENTITY_TYPE_LABEL: Record<AttachmentEntityType, string> = {
  QUALITY_INSPECTION: "품질검사",
  DEFECT_RECORD: "불량기록",
  DEFECT_CAUSE_ANALYSIS: "원인분석",
  DEFECT_CORRECTIVE_ACTION: "조치관리",
  DEFECT_RECURRENCE_PREVENTION: "재발방지관리",
  EQUIPMENT_REPAIR_REQUEST: "설비수리요청",
}

export const ATTACHMENT_PERMISSION_RESOURCE: Record<AttachmentEntityType, string> = {
  QUALITY_INSPECTION: "QUALITY_INSPECTION",
  DEFECT_RECORD: "DEFECT_MANAGEMENT",
  DEFECT_CAUSE_ANALYSIS: "DEFECT_MANAGEMENT",
  DEFECT_CORRECTIVE_ACTION: "DEFECT_MANAGEMENT",
  DEFECT_RECURRENCE_PREVENTION: "DEFECT_MANAGEMENT",
  EQUIPMENT_REPAIR_REQUEST: "EQUIPMENT_REPAIR",
}

export function isValidAttachmentEntityType(value: string): value is AttachmentEntityType {
  return (ATTACHMENT_ENTITY_TYPES as readonly string[]).includes(value)
}

export function getAttachmentPermissionResource(entityType: string): string | null {
  return isValidAttachmentEntityType(entityType) ? ATTACHMENT_PERMISSION_RESOURCE[entityType] : null
}

export function getAttachmentEntityTypeLabel(entityType: string): string {
  return isValidAttachmentEntityType(entityType) ? ATTACHMENT_ENTITY_TYPE_LABEL[entityType] : "알 수 없는 업무유형"
}

// ─── 파일 검증 ────────────────────────────────────────────────────────────────
//
// 실행파일(exe/bat/cmd/js/ps1/sh/dll 등)은 이 allow-list에 없으므로 자동으로
// 차단된다 — 별도 블록리스트를 두지 않는다. zip은 실제 사용 요구가 확인되지
// 않아 이번 PR에서는 포함하지 않는다(§ STEP 7 — 근거 없이 확장하지 않음).
//
// 브라우저가 보고하는 MIME type은 특히 hwp/csv에서 신뢰할 수 없는 경우가 많아
// (예: hwp는 종종 application/octet-stream 또는 빈 문자열로 보고됨), 확장자를
// 1차 판정 기준으로 삼는다. mimeType은 저장/표시용으로만 사용하고, 확장자와
// 명백히 모순되는 위험한 값(예: 실행형 MIME)만 별도로 걸러내지는 않는다 — 그런
// 경우도 어차피 확장자 allow-list를 통과하지 못해 차단된다.
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  "pdf",
  "xlsx",
  "xls",
  "docx",
  "doc",
  "hwp",
  "jpg",
  "jpeg",
  "png",
  "csv",
  "txt",
] as const

// 코드 한 곳에서 관리 — 클라이언트(업로드 다이얼로그)와 서버(API route)가 동일한 값을 import해서 쓴다.
export const MAX_ATTACHMENT_FILE_SIZE_BYTES = 20 * 1024 * 1024 // 20 MB

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".")
  if (idx < 0 || idx === fileName.length - 1) return ""
  return fileName.slice(idx + 1).toLowerCase()
}

/** 업로드 가능 여부를 검증한다. 위반 시 사용자에게 보여줄 한글 메시지로 예외를 던진다. */
export function validateAttachmentFile(fileName: string, fileSize: number): void {
  if (!fileName.trim()) {
    throw new Error("파일명이 올바르지 않습니다.")
  }
  const ext = getFileExtension(fileName)
  if (!ext || !(ALLOWED_ATTACHMENT_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error(
      `허용되지 않는 파일 형식입니다. (허용: ${ALLOWED_ATTACHMENT_EXTENSIONS.join(", ")})`
    )
  }
  if (fileSize <= 0) {
    throw new Error("빈 파일은 업로드할 수 없습니다.")
  }
  if (fileSize > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
    throw new Error(
      `파일 크기는 ${formatFileSize(MAX_ATTACHMENT_FILE_SIZE_BYTES)} 이하여야 합니다.`
    )
  }
}

/**
 * storagePath 구성 전용 — Supabase Storage는 object key에 비-ASCII 문자를 허용하지
 * 않는다(실측: 한글 포함 키 업로드 시 400 InvalidKey). 그래서 한글 등은 걸러내고
 * 영문/숫자/./_/- 만 남긴다. 원본 파일명(한글 포함)은 이 함수를 거치지 않고
 * Attachment.fileName 컬럼에 그대로 저장해 화면에는 원본 그대로 표시한다.
 */
export function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim()
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed
  const safe = base
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "") // 영문/숫자/./_/- 만 허용(비-ASCII 전부 제거)
  return safe || "file"
}

/** tenantId/entityType/entityId/uuid-파일명 형태로 storagePath를 구성한다(§ STEP 6). */
export function buildAttachmentStoragePath(
  tenantId: string,
  entityType: string,
  entityId: string,
  sanitizedFileName: string,
  uuid: string
): string {
  return `${tenantId}/${entityType}/${entityId}/${uuid}-${sanitizedFileName}`
}

/** 업무 숫자 formatter(formatQuantity 등)와 섞지 않는 전용 파일크기 표시 helper. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

// ─── 목록 직렬화 ──────────────────────────────────────────────────────────────

export type AttachmentRow = {
  id: string
  entityType: string
  entityId: string
  entityTypeLabel: string
  entityLabel: string
  fileName: string
  mimeType: string
  fileSize: number
  description: string | null
  uploadedById: string
  uploadedByName: string
  createdAt: string
  canDelete?: boolean
}

export type AttachmentRecordLike = {
  id: string
  entityType: string
  entityId: string
  fileName: string
  mimeType: string
  fileSize: number
  description: string | null
  uploadedById: string
  uploadedBy: { name: string }
  createdAt: Date
}

/**
 * entityLabelMap은 entityType별로 배치 조회한 "연결대상" 표시 문자열
 * (예: "[WO-2026-021] 구동 모듈 완제품 A형")을 entityId로 매핑한 것이다.
 * DB 조회(추측성 join 없이 entityId 직접 FK로 배치 조회)는 attachment.actions.ts가
 * 담당하고, 이 함수는 병합만 한다.
 */
export function serializeAttachmentRow(
  record: AttachmentRecordLike,
  entityLabelMap: Map<string, string>
): AttachmentRow {
  return {
    id: record.id,
    entityType: record.entityType,
    entityId: record.entityId,
    entityTypeLabel: getAttachmentEntityTypeLabel(record.entityType),
    entityLabel: entityLabelMap.get(record.entityId) ?? "(연결대상 없음)",
    fileName: record.fileName,
    mimeType: record.mimeType,
    fileSize: record.fileSize,
    description: record.description,
    uploadedById: record.uploadedById,
    uploadedByName: record.uploadedBy.name,
    createdAt: record.createdAt.toISOString(),
  }
}
