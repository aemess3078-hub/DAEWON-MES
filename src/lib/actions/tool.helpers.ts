import type { EquipmentStatus, EquipmentType } from "@prisma/client"

// tool.actions.ts("use server")는 async export만 허용되므로, DB에 의존하지 않는
// 순수 로직(검증/where절 조립/수명 계산/직렬화)을 이 파일로 분리한다
// (defect-corrective-action.helpers.ts와 동일한 이유).
// code-path 테스트는 scripts/test-tool-management.ts 참조.

// 공구관리 대상 EquipmentType — mold.actions.ts의 MOLD_TYPES와 동일한 범위를
// 재사용한다(신규 enum 값을 만들지 않음, § tool.actions.ts 주석 참조).
export const TOOL_TYPES = ["TOOL", "JIG", "FIXTURE"] as const
export type ToolEquipmentType = (typeof TOOL_TYPES)[number]

export type ToolStatusFilter = "ALL" | EquipmentStatus

/** 공구번호는 identifier이므로 trim 후 빈 문자열이면 거부한다. comma formatting 대상이 아니다. */
export function normalizeToolCode(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("공구번호를 입력해 주세요.")
  }
  return trimmed
}

/** 공구명은 필수 — trim 후 빈 문자열이면 거부한다. */
export function normalizeToolName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("공구명을 입력해 주세요.")
  }
  return trimmed
}

/** 수명기준(lifeLimit)은 선택값 — 입력 시 0보다 큰 정수만 허용한다. */
export function normalizeLifeLimit(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const num = typeof value === "string" ? Number(value) : value
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
    throw new Error("수명기준은 1 이상의 정수여야 합니다.")
  }
  return num
}

/** 사용이력의 사용량(usageCount)은 0보다 큰 정수만 허용한다. */
export function normalizeUsageCount(value: number | string): number {
  const num = typeof value === "string" ? Number(value) : value
  if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) {
    throw new Error("사용량은 1 이상의 정수여야 합니다.")
  }
  return num
}

/**
 * 잔여수명/사용률은 DB에 저장하지 않고 조회 시점에 계산한다
 * (DefectCorrectiveAction의 overdue 계산과 동일 원칙). lifeLimit이 없으면
 * 계산 불가능하므로 null을 반환한다 — 80% 등 임의의 교체예정 임계값은
 * 아직 두지 않는다(§ tool.actions.ts 주석 참조).
 */
export function computeRemainingLife(lifeLimit: number | null, currentUsage: number): number | null {
  if (lifeLimit === null) return null
  return lifeLimit - currentUsage
}

export function computeUsageRate(lifeLimit: number | null, currentUsage: number): number | null {
  if (lifeLimit === null || lifeLimit === 0) return null
  return Math.round((currentUsage / lifeLimit) * 1000) / 10 // 소수점 1자리 %
}

/** "상태" 필터를 Prisma Equipment.where 절로 변환한다. */
export function buildToolStatusWhere(status?: ToolStatusFilter): Record<string, unknown> {
  if (!status || status === "ALL") return {}
  return { status }
}

/** "유형" 필터를 Prisma Equipment.where 절로 변환한다. */
export function buildToolTypeWhere(equipmentType?: ToolEquipmentType | "ALL"): Record<string, unknown> {
  if (!equipmentType || equipmentType === "ALL") return {}
  return { equipmentType }
}

// ─── 목록 직렬화 ──────────────────────────────────────────────────────────────

export type ToolRow = {
  id: string
  code: string
  name: string
  equipmentType: ToolEquipmentType
  status: EquipmentStatus
  siteId: string
  siteName: string
  workCenterId: string
  workCenterName: string
  lifeLimit: number | null
  currentUsage: number
  remainingLife: number | null
  usageRate: number | null
  appliedItems: { id: string; code: string; name: string }[]
  lastUsedAt: string | null
  updatedAt: string
}

export type ToolRecordLike = {
  id: string
  code: string
  name: string
  equipmentType: EquipmentType
  status: EquipmentStatus
  siteId: string
  site: { name: string }
  workCenterId: string
  workCenter: { name: string }
  lifeLimit: number | null
  currentUsage: number
  updatedAt: Date
  appliedItems: { item: { id: string; code: string; name: string } }[]
  usageHistories: { usedAt: Date }[]
}

export function serializeToolRow(record: ToolRecordLike): ToolRow {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    equipmentType: record.equipmentType as ToolEquipmentType,
    status: record.status,
    siteId: record.siteId,
    siteName: record.site.name,
    workCenterId: record.workCenterId,
    workCenterName: record.workCenter.name,
    lifeLimit: record.lifeLimit,
    currentUsage: record.currentUsage,
    remainingLife: computeRemainingLife(record.lifeLimit, record.currentUsage),
    usageRate: computeUsageRate(record.lifeLimit, record.currentUsage),
    appliedItems: record.appliedItems.map((a) => a.item),
    lastUsedAt: record.usageHistories[0]?.usedAt.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  }
}
