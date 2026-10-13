import type { SupabaseBackupsApiResponse } from "../supabase-management/backups"

// backup.actions.ts("use server")는 async export만 허용되므로, DB/네트워크에
// 의존하지 않는 순수 파싱/정규화/집계 로직을 이 파일로 분리한다.

/** 그룹 등록/수정 입력의 externalBackupIds를 정리한다 — 빈 값 제거 + 중복 제거. */
export function dedupeBackupIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((s) => s.trim()).filter(Boolean)))
}

// ─── 백업 식별자/시각 정규화 ────────────────────────────────────────────────

export function normalizeExternalBackupId(raw: { id?: string | number; inserted_at?: string | null }): string | null {
  if (raw.id !== undefined && raw.id !== null && String(raw.id).trim()) {
    return String(raw.id)
  }
  if (raw.inserted_at && raw.inserted_at.trim()) {
    return raw.inserted_at
  }
  return null
}

export function parseBackupTimestamp(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return null
  return new Date(timestamp).toISOString()
}

function backupTimestampMs(backup: Pick<SupabaseBackupItem, "insertedAt">): number | null {
  if (!backup.insertedAt) return null
  const timestamp = Date.parse(backup.insertedAt)
  return Number.isNaN(timestamp) ? null : timestamp
}

export function formatBackupDateTimeKst(iso: string | null | undefined): string {
  const normalized = parseBackupTimestamp(iso)
  if (!normalized) return "확인 불가"

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(normalized))

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`
}

// ─── Supabase 응답 파싱 ───────────────────────────────────────────────────────

export type SupabaseBackupItem = {
  externalBackupId: string
  status: string
  insertedAt: string | null
  isPhysicalBackup: boolean | null
}

export type ParsedSupabaseBackups = {
  backups: SupabaseBackupItem[]
  region: string | null
  walgEnabled: boolean | null
  pitrEnabled: boolean | null
}

/**
 * id/inserted_at이 모두 없어 식별 불가능한 항목은 건너뛴다. inserted_at이
 * invalid여도 id가 있으면 항목은 유지하고 insertedAt만 null로 둔다.
 */
export function parseSupabaseBackupsResponse(response: SupabaseBackupsApiResponse): ParsedSupabaseBackups {
  const backups: SupabaseBackupItem[] = []
  for (const raw of response.backups ?? []) {
    const externalBackupId = normalizeExternalBackupId(raw)
    if (!externalBackupId) continue
    backups.push({
      externalBackupId,
      status: raw.status ?? "UNKNOWN",
      insertedAt: parseBackupTimestamp(raw.inserted_at),
      isPhysicalBackup: raw.is_physical_backup ?? null,
    })
  }
  return {
    backups,
    region: response.region ?? null,
    walgEnabled: response.walg_enabled ?? null,
    pitrEnabled: response.pitr_enabled ?? null,
  }
}

// ─── 가시성/정렬 ──────────────────────────────────────────────────────────────

export function filterVisibleBackups(all: SupabaseBackupItem[], hiddenIds: Set<string>): SupabaseBackupItem[] {
  return all.filter((b) => !hiddenIds.has(b.externalBackupId))
}

export function computeUnclassifiedBackups(visible: SupabaseBackupItem[], groupedIds: Set<string>): SupabaseBackupItem[] {
  return visible.filter((b) => !groupedIds.has(b.externalBackupId))
}

export function sortBackupsByInsertedAtDesc<T extends Pick<SupabaseBackupItem, "insertedAt">>(backups: T[]): T[] {
  return [...backups].sort((a, b) => {
    const bTime = backupTimestampMs(b)
    const aTime = backupTimestampMs(a)
    if (aTime === null && bTime === null) return 0
    if (aTime === null) return 1
    if (bTime === null) return -1
    return bTime - aTime
  })
}

export function buildBackupLookup(backups: SupabaseBackupItem[]): Map<string, SupabaseBackupItem> {
  return new Map(backups.map((b) => [b.externalBackupId, b]))
}

// ─── 운영 요약 ────────────────────────────────────────────────────────────────

export type BackupSummary = {
  totalBackups: number | null
  visibleBackups: number | null
  hiddenBackups: number | null
  mostRecentBackupAt: string | null
  mostRecentBackupStatus: string | null
  mostRecentSuccessfulBackupAt: string | null
  failedBackups: number | null
  region: string | null
  walgEnabled: boolean | null
  pitrEnabled: boolean | null
}

export function computeMostRecentBackup(backups: SupabaseBackupItem[]): SupabaseBackupItem | null {
  return sortBackupsByInsertedAtDesc(backups.filter((b) => backupTimestampMs(b) !== null))[0] ?? null
}

export function computeMostRecentBackupAt(backups: SupabaseBackupItem[]): string | null {
  return computeMostRecentBackup(backups)?.insertedAt ?? null
}

export function computeMostRecentSuccessfulBackupAt(backups: SupabaseBackupItem[]): string | null {
  return computeMostRecentBackup(backups.filter((b) => b.status === "COMPLETED"))?.insertedAt ?? null
}

export function computeBackupSummary(params: {
  backups: SupabaseBackupItem[]
  hiddenIds: Set<string>
  region: string | null
  walgEnabled: boolean | null
  pitrEnabled: boolean | null
}): BackupSummary {
  const latest = computeMostRecentBackup(params.backups)
  return {
    totalBackups: params.backups.length,
    visibleBackups: filterVisibleBackups(params.backups, params.hiddenIds).length,
    hiddenBackups: params.backups.filter((b) => params.hiddenIds.has(b.externalBackupId)).length,
    mostRecentBackupAt: latest?.insertedAt ?? null,
    mostRecentBackupStatus: latest?.status ?? null,
    mostRecentSuccessfulBackupAt: computeMostRecentSuccessfulBackupAt(params.backups),
    failedBackups: params.backups.filter((b) => b.status === "FAILED").length,
    region: params.region,
    walgEnabled: params.walgEnabled,
    pitrEnabled: params.pitrEnabled,
  }
}

export function unavailableBackupSummary(): BackupSummary {
  return {
    totalBackups: null,
    visibleBackups: null,
    hiddenBackups: null,
    mostRecentBackupAt: null,
    mostRecentBackupStatus: null,
    mostRecentSuccessfulBackupAt: null,
    failedBackups: null,
    region: null,
    walgEnabled: null,
    pitrEnabled: null,
  }
}

// ─── 표시 라벨 ────────────────────────────────────────────────────────────────

export function backupStatusLabel(status: string | null | undefined): string {
  if (!status) return "-"
  if (status === "COMPLETED") return "완료"
  if (status === "PENDING") return "진행중"
  if (status === "FAILED") return "실패"
  return status
}

export function backupTypeLabel(isPhysicalBackup: boolean | null): string {
  if (isPhysicalBackup === null) return "-"
  return isPhysicalBackup ? "물리" : "논리"
}

export function featureFlagLabel(value: boolean | null): string {
  if (value === null) return "확인 불가"
  return value ? "활성" : "비활성"
}

// ─── 그룹/숨김 직렬화 ────────────────────────────────────────────────────────

export type BackupGroupMemberRow = {
  externalBackupId: string
  status: string | null
  insertedAt: string | null
  isPhysicalBackup: boolean | null
  hidden: boolean
}

export type BackupGroupRow = {
  id: string
  name: string
  description: string | null
  memberCount: number
  createdByName: string
  updatedByName: string
  createdAt: string
  updatedAt: string
}

export type BackupGroupDetail = BackupGroupRow & {
  members: BackupGroupMemberRow[]
}

export type HiddenBackupRow = {
  id: string
  externalBackupId: string
  insertedAt: string | null
  status: string | null
  isPhysicalBackup: boolean | null
  hiddenAt: string
  hiddenByName: string | null
  sourceAvailable: boolean
}

export function serializeBackupGroupMember(
  externalBackupId: string,
  lookup: Map<string, SupabaseBackupItem>,
  hiddenIds: Set<string>
): BackupGroupMemberRow {
  const found = lookup.get(externalBackupId)
  return {
    externalBackupId,
    status: found?.status ?? null,
    insertedAt: found?.insertedAt ?? null,
    isPhysicalBackup: found?.isPhysicalBackup ?? null,
    hidden: hiddenIds.has(externalBackupId),
  }
}
