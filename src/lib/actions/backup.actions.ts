"use server"

import { prisma } from "@/lib/db/prisma"
import { requireRole, getTenantId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { getErrorMessage } from "@/lib/utils"
import { fetchSupabaseBackupsRaw } from "@/lib/supabase-management/backups"
import {
  parseSupabaseBackupsResponse,
  filterVisibleBackups,
  computeUnclassifiedBackups,
  computeBackupSummary,
  unavailableBackupSummary,
  buildBackupLookup,
  sortBackupsByInsertedAtDesc,
  serializeBackupGroupMember,
  dedupeBackupIds,
  type SupabaseBackupItem,
  type BackupSummary,
  type BackupGroupRow,
  type BackupGroupDetail,
  type HiddenBackupRow,
} from "./backup.helpers"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

export type { SupabaseBackupItem, BackupSummary, BackupGroupRow, BackupGroupDetail, HiddenBackupRow }

// ─── 청운커팅 사업계획서 "기준정보관리 > 백업관리" ──────────────────────────
//
// 이 파일은 Supabase 자동 DB 백업 목록을 "조회"하고, NMES 자체 metadata
// (BackupGroup/BackupGroupItem/HiddenBackup)로 그룹핑·숨김 처리하는 기능만
// 제공한다. Supabase backup 원본에 대한 생성/삭제/restore/PITR 호출은 없다.
// 그룹 삭제/백업 숨김/다시 표시는 전부 NMES DB metadata 변경이다.

const MENU_NAME = "백업관리"

function revalidateBackupPaths() {
  revalidatePath("/app/mes/backups")
}

async function loadHiddenIds(tenantId: string): Promise<Set<string>> {
  const rows = await prisma.hiddenBackup.findMany({ where: { tenantId }, select: { externalBackupId: true } })
  return new Set(rows.map((r) => r.externalBackupId))
}

function serializeGroupRow(group: {
  id: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: { name: string }
  updatedBy: { name: string }
  _count: { items: number }
}): BackupGroupRow {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    memberCount: group._count.items,
    createdByName: group.createdBy.name,
    updatedByName: group.updatedBy.name,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  }
}

function serializeHiddenBackupRows(params: {
  hiddenRows: Array<{
    id: string
    externalBackupId: string
    hiddenAt: Date
    hiddenBy: { name: string } | null
  }>
  lookup: Map<string, SupabaseBackupItem>
}): HiddenBackupRow[] {
  const rows = params.hiddenRows.map((row) => {
    const found = params.lookup.get(row.externalBackupId)
    return {
      id: row.id,
      externalBackupId: row.externalBackupId,
      insertedAt: found?.insertedAt ?? null,
      status: found?.status ?? null,
      isPhysicalBackup: found?.isPhysicalBackup ?? null,
      hiddenAt: row.hiddenAt.toISOString(),
      hiddenByName: row.hiddenBy?.name ?? null,
      sourceAvailable: Boolean(found),
    }
  })
  return sortBackupsByInsertedAtDesc(rows)
}

async function loadCurrentBackupLookup(): Promise<Map<string, SupabaseBackupItem> | null> {
  const rawResponse = await fetchSupabaseBackupsRaw()
  if (!rawResponse) return null
  const parsed = parseSupabaseBackupsResponse(rawResponse)
  return buildBackupLookup(parsed.backups)
}

async function validateCurrentBackupIds(ids: string[], message: string) {
  const lookup = await loadCurrentBackupLookup()
  if (!lookup) throw new Error("현재 Supabase 백업 목록을 확인할 수 없어 백업 분류를 변경할 수 없습니다.")
  const missing = ids.filter((id) => !lookup.has(id))
  if (missing.length > 0) throw new Error(message)
}

// ─── 조회 ─────────────────────────────────────────────────────────────────────

export type BackupManagementData = {
  available: boolean
  checkedAt: string
  summary: BackupSummary
  groups: BackupGroupRow[]
  unclassified: SupabaseBackupItem[]
  visibleBackups: SupabaseBackupItem[]
  hiddenBackups: HiddenBackupRow[]
}

export async function getBackupManagementData(): Promise<BackupManagementData> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()
  const checkedAt = new Date().toISOString()

  const [rawResponse, groupRecords, hiddenRows, groupItemRows] = await Promise.all([
    fetchSupabaseBackupsRaw(),
    prisma.backupGroup.findMany({
      where: { tenantId },
      include: {
        createdBy: { select: { name: true } },
        updatedBy: { select: { name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.hiddenBackup.findMany({
      where: { tenantId },
      include: { hiddenBy: { select: { name: true } } },
      orderBy: { hiddenAt: "desc" },
    }),
    prisma.backupGroupItem.findMany({ where: { tenantId }, select: { externalBackupId: true } }),
  ])

  const groups = groupRecords.map(serializeGroupRow)
  const hiddenIds = new Set(hiddenRows.map((r) => r.externalBackupId))

  if (!rawResponse) {
    return {
      available: false,
      checkedAt,
      summary: unavailableBackupSummary(),
      groups,
      unclassified: [],
      visibleBackups: [],
      hiddenBackups: serializeHiddenBackupRows({ hiddenRows, lookup: new Map() }),
    }
  }

  const parsed = parseSupabaseBackupsResponse(rawResponse)
  const sortedBackups = sortBackupsByInsertedAtDesc(parsed.backups)
  const visible = sortBackupsByInsertedAtDesc(filterVisibleBackups(sortedBackups, hiddenIds))
  const groupedIds = new Set(groupItemRows.map((r) => r.externalBackupId))
  const unclassified = sortBackupsByInsertedAtDesc(computeUnclassifiedBackups(visible, groupedIds))
  const lookup = buildBackupLookup(sortedBackups)

  return {
    available: true,
    checkedAt,
    summary: computeBackupSummary({
      backups: sortedBackups,
      hiddenIds,
      region: parsed.region,
      walgEnabled: parsed.walgEnabled,
      pitrEnabled: parsed.pitrEnabled,
    }),
    groups,
    unclassified,
    visibleBackups: visible,
    hiddenBackups: serializeHiddenBackupRows({ hiddenRows, lookup }),
  }
}

export async function getBackupGroupDetail(id: string): Promise<BackupGroupDetail | null> {
  await assertDaewonFeatureScope()
  await requireRole("VIEWER")
  const tenantId = await getTenantId()

  const group = await prisma.backupGroup.findFirst({
    where: { id, tenantId },
    include: {
      createdBy: { select: { name: true } },
      updatedBy: { select: { name: true } },
      items: { select: { externalBackupId: true }, orderBy: { createdAt: "asc" } },
    },
  })
  if (!group) return null

  const [rawResponse, hiddenIds] = await Promise.all([fetchSupabaseBackupsRaw(), loadHiddenIds(tenantId)])
  const lookup = rawResponse ? buildBackupLookup(parseSupabaseBackupsResponse(rawResponse).backups) : new Map()

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    memberCount: group.items.length,
    createdByName: group.createdBy.name,
    updatedByName: group.updatedBy.name,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
    members: sortBackupsByInsertedAtDesc(group.items.map((i) => serializeBackupGroupMember(i.externalBackupId, lookup, hiddenIds))),
  }
}

// ─── 그룹 등록 ────────────────────────────────────────────────────────────────

export type CreateBackupGroupInput = {
  name: string
  description?: string | null
  externalBackupIds: string[]
}

export async function createBackupGroup(data: CreateBackupGroupInput): Promise<{ id: string }> {
  await assertDaewonFeatureScope()
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const name = data.name.trim()
  if (!name) throw new Error("그룹명을 입력해 주세요.")
  const ids = dedupeBackupIds(data.externalBackupIds)
  if (ids.length === 0) throw new Error("백업을 1개 이상 선택해 주세요.")
  await validateCurrentBackupIds(ids, "현재 Supabase 백업 목록에 없는 백업은 새 그룹에 추가할 수 없습니다.")
  const description = data.description?.trim() || null

  const created = await prisma.$transaction(async (tx) => {
    const group = await tx.backupGroup.create({
      data: { tenantId, name, description, createdById: actor.id, updatedById: actor.id },
    })
    await tx.backupGroupItem.createMany({
      data: ids.map((externalBackupId) => ({ tenantId, groupId: group.id, externalBackupId })),
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "BackupGroup",
        entityId: group.id,
        action: "CREATE",
        afterData: { name, description, backupCount: ids.length },
        menuName: MENU_NAME,
      },
    })
    return group
  })

  revalidateBackupPaths()
  return { id: created.id }
}

// ─── 그룹 수정 ────────────────────────────────────────────────────────────────

export type UpdateBackupGroupInput = {
  name: string
  description?: string | null
  externalBackupIds: string[]
}

export async function updateBackupGroup(id: string, data: UpdateBackupGroupInput) {
  await assertDaewonFeatureScope()
  const actor = await requireRole("OPERATOR")
  const tenantId = await getTenantId()

  const existing = await prisma.backupGroup.findFirst({
    where: { id, tenantId },
    include: { items: { select: { externalBackupId: true } } },
  })
  if (!existing) throw new Error("그룹을 찾을 수 없습니다.")

  const name = data.name.trim()
  if (!name) throw new Error("그룹명을 입력해 주세요.")
  const ids = dedupeBackupIds(data.externalBackupIds)
  if (ids.length === 0) throw new Error("백업을 1개 이상 선택해 주세요.")
  const description = data.description?.trim() || null

  const existingIds = new Set(existing.items.map((item) => item.externalBackupId))
  const newlyAddedIds = ids.filter((externalBackupId) => !existingIds.has(externalBackupId))
  if (newlyAddedIds.length > 0) {
    await validateCurrentBackupIds(newlyAddedIds, "현재 Supabase 백업 목록에 없는 백업은 그룹에 새로 추가할 수 없습니다.")
  }

  await prisma.$transaction(async (tx) => {
    await tx.backupGroup.update({ where: { id }, data: { name, description, updatedById: actor.id } })
    await tx.backupGroupItem.deleteMany({ where: { groupId: id, tenantId } })
    await tx.backupGroupItem.createMany({
      data: ids.map((externalBackupId) => ({ tenantId, groupId: id, externalBackupId })),
    })
    await tx.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "BackupGroup",
        entityId: id,
        action: "UPDATE",
        beforeData: { name: existing.name, description: existing.description, backupCount: existing.items.length },
        afterData: { name, description, backupCount: ids.length },
        menuName: MENU_NAME,
      },
    })
  })

  revalidateBackupPaths()
}

// ─── 그룹 삭제 — BackupGroupItem은 cascade, Supabase backup 원본은 무관 ──────

export async function deleteBackupGroup(id: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const existing = await prisma.backupGroup.findFirst({ where: { id, tenantId } })
    if (!existing) throw new Error("그룹을 찾을 수 없습니다.")

    await prisma.$transaction(async (tx) => {
      const result = await tx.backupGroup.deleteMany({ where: { id, tenantId } })
      if (result.count === 0) throw new Error("그룹을 찾을 수 없습니다.")
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "BackupGroup",
          entityId: id,
          action: "DELETE",
          beforeData: { name: existing.name, description: existing.description },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateBackupPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

// ─── 백업 목록 숨김/다시 표시 — Supabase backup 원본 mutation 없음 ───────────

export async function hideBackup(externalBackupId: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const id = externalBackupId.trim()
    if (!id) throw new Error("백업을 확인할 수 없습니다.")

    const existing = await prisma.hiddenBackup.findFirst({ where: { tenantId, externalBackupId: id } })
    if (existing) {
      revalidateBackupPaths()
      return { ok: true }
    }

    await validateCurrentBackupIds([id], "현재 Supabase 백업 목록에 없는 백업은 숨김 처리할 수 없습니다.")

    await prisma.$transaction(async (tx) => {
      const hidden = await tx.hiddenBackup.create({
        data: { tenantId, externalBackupId: id, hiddenById: actor.id },
      })
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "HiddenBackup",
          entityId: hidden.id,
          action: "CREATE",
          afterData: { externalBackupId: id },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateBackupPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}

export async function unhideBackup(externalBackupId: string): Promise<{ ok: boolean; error?: string }> {
  await assertDaewonFeatureScope()
  try {
    const actor = await requireRole("OPERATOR")
    const tenantId = await getTenantId()

    const id = externalBackupId.trim()
    if (!id) throw new Error("백업을 확인할 수 없습니다.")

    const existing = await prisma.hiddenBackup.findFirst({ where: { tenantId, externalBackupId: id } })
    if (!existing) {
      revalidateBackupPaths()
      return { ok: true }
    }

    await prisma.$transaction(async (tx) => {
      await tx.hiddenBackup.deleteMany({ where: { id: existing.id, tenantId } })
      await tx.auditLog.create({
        data: {
          tenantId,
          actorId: actor.id,
          actorLabel: actor.name,
          entityType: "HiddenBackup",
          entityId: existing.id,
          action: "DELETE",
          beforeData: { externalBackupId: id },
          menuName: MENU_NAME,
        },
      })
    })

    revalidateBackupPaths()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: getErrorMessage(e) }
  }
}
