"use server"

import { prisma } from "@/lib/db/prisma"
import {
  ConnectionProtocol,
  TagDataType,
  TagCategory,
  GatewayStatus,
  Prisma,
} from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireDeveloper } from "@/lib/auth"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { assertDeveloperOnly } from "@/lib/auth/daewon-scope.server"

// ─── Types ────────────────────────────────────────────────────────────────────

export type EdgeGatewayRow = {
  id: string
  tenantId: string
  siteId: string
  name: string
  description: string | null
  apiKey: string
  status: GatewayStatus
  lastHeartbeat: Date | null
  createdAt: Date
  updatedAt: Date
  site: { id: string; code: string; name: string }
  _count: { connections: number }
}

export type EquipmentConnectionRow = {
  id: string
  equipmentId: string
  gatewayId: string
  protocol: ConnectionProtocol
  host: string | null
  port: number | null
  config: any
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  equipment: { id: string; code: string; name: string }
  gateway: { id: string; name: string }
  _count: { tags: number }
}

export type DataTagRow = {
  id: string
  connectionId: string
  tagCode: string
  displayName: string
  dataType: TagDataType
  unit: string | null
  category: TagCategory
  plcAddress: string
  scaleFactor: number | null
  offset: number | null
  samplingMs: number
  deadband: number | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  connection: {
    id: string
    protocol: ConnectionProtocol
    equipment: { id: string; code: string; name: string }
    gateway: { id: string; name: string }
  }
}

export type NcwatchMappingStatus = "MAPPED" | "UNMAPPED" | "INACTIVE"

export type NcwatchMappingRow = {
  id: string | null
  tenantId: string
  siteId: string | null
  machineName: string
  equipmentId: string | null
  equipment: { id: string; code: string; name: string } | null
  isActive: boolean
  memo: string | null
  status: NcwatchMappingStatus
  statusCode: number | null
  statusLabel: string | null
  lastReceivedAt: Date | null
  lastSyncResult: string | null
  lastSyncMessage: string | null
  lastSyncAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
}

// ─── Input Types ──────────────────────────────────────────────────────────────

export type CreateGatewayInput = {
  siteId: string
  name: string
  description?: string | null
}

export type UpdateGatewayInput = {
  name?: string
  description?: string | null
  status?: GatewayStatus
}

export type CreateConnectionInput = {
  equipmentId: string
  gatewayId: string
  protocol: ConnectionProtocol
  host?: string | null
  port?: number | null
  config?: Prisma.InputJsonValue | null
}

export type UpdateConnectionInput = {
  protocol?: ConnectionProtocol
  host?: string | null
  port?: number | null
  config?: Prisma.InputJsonValue | null
}

export type CreateTagInput = {
  connectionId: string
  tagCode: string
  displayName: string
  dataType: TagDataType
  unit?: string | null
  category: TagCategory
  plcAddress: string
  scaleFactor?: number | null
  offset?: number | null
  samplingMs?: number
  deadband?: number | null
}

export type UpdateTagInput = {
  displayName?: string
  dataType?: TagDataType
  unit?: string | null
  category?: TagCategory
  plcAddress?: string
  scaleFactor?: number | null
  offset?: number | null
  samplingMs?: number
  deadband?: number | null
}

export type UpsertNcwatchMappingInput = {
  id?: string | null
  machineName: string
  equipmentId?: string | null
  isActive?: boolean
  memo?: string | null
}

type NcwatchDefaultTagDefinition = {
  tagCode: string
  displayName: string
  dataType: TagDataType
  unit: string | null
  category: TagCategory
  plcAddress: string
  isVisible: boolean
  isPrimary: boolean
  displayOrder: number
}

export type CopyTagConflictMode = "SKIP" | "UPDATE" | "REPLACE"

export type CopyEquipmentTagsInput = {
  sourceEquipmentId: string
  targetEquipmentIds: string[]
  conflictMode: CopyTagConflictMode
}

export type CopyEquipmentTagResult = {
  equipmentId: string
  equipmentCode: string
  equipmentName: string
  added: number
  updated: number
  skipped: number
  deleted: number
}

// ─── EdgeGateway CRUD ─────────────────────────────────────────────────────────

export async function getGateways(tenantId: string): Promise<EdgeGatewayRow[]> {
  await assertDeveloperOnly()
  const rows = await prisma.edgeGateway.findMany({
    where: { tenantId },
    include: {
      site: { select: { id: true, code: true, name: true } },
      _count: { select: { connections: true } },
    },
    orderBy: { createdAt: "desc" },
  })
  return rows as any
}

export async function createGateway(
  data: CreateGatewayInput,
  _tenantId?: string
): Promise<{ id: string; apiKey: string }> {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "CREATE")
  const actor = await requireDeveloper()
  const scopedTenantId = actor.tenantId
  const site = await prisma.site.findFirst({
    where: { id: data.siteId, tenantId: scopedTenantId },
    select: { id: true },
  })
  if (!site) throw new Error("사이트를 찾을 수 없습니다.")

  const gateway = await prisma.edgeGateway.create({
    data: {
      tenantId: scopedTenantId,
      siteId: data.siteId,
      name: data.name,
      description: data.description ?? null,
      status: "OFFLINE",
    },
    select: { id: true, apiKey: true },
  })
  revalidatePath("/app/mes/gateways")
  return gateway
}

export async function updateGateway(id: string, data: UpdateGatewayInput) {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "UPDATE")
  const actor = await requireDeveloper()
  const owned = await prisma.edgeGateway.findFirst({
    where: { id, tenantId: actor.tenantId },
    select: { id: true },
  })
  if (!owned) throw new Error("Gateway를 찾을 수 없습니다.")

  await prisma.edgeGateway.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.status !== undefined && { status: data.status }),
    },
  })
  revalidatePath("/app/mes/gateways")
}

export async function deleteGateway(id: string) {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "DELETE")
  const actor = await requireDeveloper()
  const owned = await prisma.edgeGateway.findFirst({
    where: { id, tenantId: actor.tenantId },
    select: { id: true },
  })
  if (!owned) throw new Error("Gateway를 찾을 수 없습니다.")

  const connCount = await prisma.equipmentConnection.count({
    where: { gatewayId: id },
  })
  if (connCount > 0) {
    throw new Error("이 게이트웨이에 연결된 설비가 있어 삭제할 수 없습니다.")
  }
  await prisma.edgeGateway.delete({ where: { id } })
  revalidatePath("/app/mes/gateways")
}

// ─── EquipmentConnection CRUD ─────────────────────────────────────────────────

export async function getConnections(
  tenantId: string
): Promise<EquipmentConnectionRow[]> {
  await assertDeveloperOnly()
  const rows = await prisma.equipmentConnection.findMany({
    where: {
      equipment: { tenantId },
    },
    include: {
      equipment: { select: { id: true, code: true, name: true } },
      gateway: { select: { id: true, name: true } },
      _count: { select: { tags: true } },
    },
    orderBy: { createdAt: "desc" },
  })
  return rows.filter((row) => row.protocol !== "NCWATCH_AGENT") as any
}

export async function createConnection(data: CreateConnectionInput) {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "CREATE")
  const actor = await requireDeveloper()
  const [equipment, gateway] = await Promise.all([
    prisma.equipment.findFirst({
      where: { id: data.equipmentId, tenantId: actor.tenantId },
      select: { id: true },
    }),
    prisma.edgeGateway.findFirst({
      where: { id: data.gatewayId, tenantId: actor.tenantId },
      select: { id: true },
    }),
  ])
  if (!equipment) throw new Error("설비를 찾을 수 없습니다.")
  if (!gateway) throw new Error("Gateway를 찾을 수 없습니다.")

  const existing = await prisma.equipmentConnection.findUnique({
    where: {
      equipmentId_gatewayId: {
        equipmentId: data.equipmentId,
        gatewayId: data.gatewayId,
      },
    },
  })
  if (existing) {
    throw new Error("이 설비와 게이트웨이 조합의 연결이 이미 존재합니다.")
  }
  await prisma.equipmentConnection.create({
    data: {
      equipmentId: data.equipmentId,
      gatewayId: data.gatewayId,
      protocol: data.protocol,
      host: data.host ?? null,
      port: data.port ?? null,
      config: data.config ?? Prisma.JsonNull,
    },
  })
  revalidatePath("/app/mes/equipment-connections")
}

export async function updateConnection(
  id: string,
  data: UpdateConnectionInput
) {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "UPDATE")
  const actor = await requireDeveloper()
  const owned = await prisma.equipmentConnection.findFirst({
    where: { id, equipment: { tenantId: actor.tenantId } },
    select: { id: true },
  })
  if (!owned) throw new Error("설비 연결을 찾을 수 없습니다.")

  await prisma.equipmentConnection.update({
    where: { id },
    data: {
      ...(data.protocol !== undefined && { protocol: data.protocol }),
      ...(data.host !== undefined && { host: data.host }),
      ...(data.port !== undefined && { port: data.port }),
      ...(data.config !== undefined && { config: data.config ?? Prisma.JsonNull }),
    },
  })
  revalidatePath("/app/mes/equipment-connections")
}

export async function deleteConnection(id: string) {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "DELETE")
  const actor = await requireDeveloper()
  const owned = await prisma.equipmentConnection.findFirst({
    where: { id, equipment: { tenantId: actor.tenantId } },
    select: { id: true },
  })
  if (!owned) throw new Error("설비 연결을 찾을 수 없습니다.")

  const tagCount = await prisma.dataTag.count({ where: { connectionId: id } })
  if (tagCount > 0) {
    throw new Error("이 연결에 등록된 태그가 있어 삭제할 수 없습니다.")
  }
  await prisma.equipmentConnection.delete({ where: { id } })
  revalidatePath("/app/mes/equipment-connections")
}

export async function toggleConnectionActive(id: string, isActive: boolean) {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "UPDATE")
  const actor = await requireDeveloper()
  const owned = await prisma.equipmentConnection.findFirst({
    where: { id, equipment: { tenantId: actor.tenantId } },
    select: { id: true },
  })
  if (!owned) throw new Error("설비 연결을 찾을 수 없습니다.")

  await prisma.equipmentConnection.update({
    where: { id },
    data: { isActive },
  })
  revalidatePath("/app/mes/equipment-connections")
}

// ─── NCWatch Agent Mapping CRUD ────────────────────────────────────────────────

function normalizeMachineName(machineName: string) {
  return machineName.trim()
}

async function resolveNcwatchSiteId(
  tenantId: string,
  machineName: string,
  equipmentId?: string | null
) {
  if (equipmentId) {
    const equipment = await prisma.equipment.findFirst({
      where: { id: equipmentId, tenantId },
      select: { siteId: true },
    })
    if (!equipment) throw new Error("선택한 MES 설비를 찾을 수 없습니다.")
    return equipment.siteId
  }

  const status = await prisma.ncwatchStatus.findUnique({
    where: { tenantId_machineName: { tenantId, machineName } },
    select: { siteId: true },
  })
  return status?.siteId ?? null
}

const NCWATCH_GATEWAY_NAME = "NCWatch Agent"

const NCWATCH_DEFAULT_TAGS: NcwatchDefaultTagDefinition[] = [
  // ── 카드 요약(상위 6개) ──────────────────────────────────────────
  {
    tagCode: "STATUS",
    displayName: "운전 상태",
    dataType: "STRING",
    unit: null,
    category: "STATUS",
    plcAddress: "statusLabel",
    isVisible: true,
    isPrimary: true,
    displayOrder: 10,
  },
  {
    tagCode: "PROGRAM_NAME",
    displayName: "가공 프로그램",
    dataType: "STRING",
    unit: null,
    category: "PROCESS",
    plcAddress: "programName",
    isVisible: true,
    isPrimary: false,
    displayOrder: 20,
  },
  {
    tagCode: "MODE",
    displayName: "운전 모드",
    dataType: "STRING",
    unit: null,
    category: "STATUS",
    plcAddress: "modeCode",
    isVisible: true,
    isPrimary: false,
    displayOrder: 30,
  },
  {
    tagCode: "SPINDLE_SPEED",
    displayName: "주축 회전수",
    dataType: "INT",
    unit: "rpm",
    category: "PROCESS",
    plcAddress: "spindleSpeed",
    isVisible: true,
    isPrimary: false,
    displayOrder: 40,
  },
  {
    tagCode: "FEED_RATE",
    displayName: "이송 속도",
    dataType: "INT",
    unit: "mm/min",
    category: "PROCESS",
    plcAddress: "feedRate",
    isVisible: true,
    isPrimary: false,
    displayOrder: 50,
  },
  {
    tagCode: "PART_COUNT",
    displayName: "생산 수량",
    dataType: "INT",
    unit: "ea",
    category: "COUNTER",
    plcAddress: "partCount",
    isVisible: true,
    isPrimary: false,
    displayOrder: 60,
  },
  // ── 파라미터 상세(카드 외, 파라미터보기에서 노출) ────────────────
  {
    tagCode: "TOOL_NO",
    displayName: "공구 번호",
    dataType: "STRING",
    unit: null,
    category: "STATUS",
    plcAddress: "toolNo",
    isVisible: true,
    isPrimary: false,
    displayOrder: 70,
  },
  {
    tagCode: "RATIO",
    displayName: "진행률",
    dataType: "FLOAT",
    unit: "%",
    category: "PROCESS",
    plcAddress: "ratio",
    isVisible: true,
    isPrimary: false,
    displayOrder: 80,
  },
  {
    tagCode: "BLOCK_NUMBER",
    displayName: "블록 번호",
    dataType: "INT",
    unit: null,
    category: "PROCESS",
    plcAddress: "blockNumber",
    isVisible: true,
    isPrimary: false,
    displayOrder: 90,
  },
  {
    tagCode: "O_NUMBER",
    displayName: "프로젝트 번호",
    dataType: "STRING",
    unit: null,
    category: "PROCESS",
    plcAddress: "oNumber",
    isVisible: true,
    isPrimary: false,
    displayOrder: 100,
  },
  {
    tagCode: "ALARM_MESSAGE",
    displayName: "알람 메시지",
    dataType: "STRING",
    unit: null,
    category: "ALARM",
    plcAddress: "alarmMessage",
    isVisible: true,
    isPrimary: false,
    displayOrder: 110,
  },
  {
    tagCode: "POS_X",
    displayName: "X축 위치",
    dataType: "FLOAT",
    unit: "mm",
    category: "PROCESS",
    plcAddress: "positionX",
    isVisible: true,
    isPrimary: false,
    displayOrder: 120,
  },
  {
    tagCode: "POS_Y",
    displayName: "Y축 위치",
    dataType: "FLOAT",
    unit: "mm",
    category: "PROCESS",
    plcAddress: "positionY",
    isVisible: true,
    isPrimary: false,
    displayOrder: 130,
  },
  {
    tagCode: "POS_Z",
    displayName: "Z축 위치",
    dataType: "FLOAT",
    unit: "mm",
    category: "PROCESS",
    plcAddress: "positionZ",
    isVisible: true,
    isPrimary: false,
    displayOrder: 140,
  },
  {
    tagCode: "ALARM_CODE",
    displayName: "알람 코드",
    dataType: "STRING",
    unit: null,
    category: "ALARM",
    plcAddress: "alarmCode",
    isVisible: false,
    isPrimary: false,
    displayOrder: 150,
  },
]

async function ensureNcwatchConnectionAndDefaultTags(
  tenantId: string,
  equipmentId: string,
  machineName: string
) {
  const equipment = await prisma.equipment.findFirst({
    where: { id: equipmentId, tenantId },
    select: { id: true, siteId: true },
  })
  if (!equipment) throw new Error("선택한 MES 설비를 찾을 수 없습니다.")

  const gateway =
    (await prisma.edgeGateway.findFirst({
      where: { tenantId, siteId: equipment.siteId, name: NCWATCH_GATEWAY_NAME },
      select: { id: true },
    })) ??
    (await prisma.edgeGateway.create({
      data: {
        tenantId,
        siteId: equipment.siteId,
        name: NCWATCH_GATEWAY_NAME,
        description: "Virtual gateway for NCWatch Agent push integration",
        status: "OFFLINE",
      },
      select: { id: true },
    }))

  const connection = await prisma.equipmentConnection.upsert({
    where: {
      equipmentId_gatewayId: {
        equipmentId,
        gatewayId: gateway.id,
      },
    },
    update: {
      protocol: "NCWATCH_AGENT",
      isActive: true,
      host: null,
      port: null,
      config: { machineName },
    },
    create: {
      equipmentId,
      gatewayId: gateway.id,
      protocol: "NCWATCH_AGENT",
      host: null,
      port: null,
      config: { machineName },
      isActive: true,
    },
    select: { id: true },
  })

  await Promise.all(
    NCWATCH_DEFAULT_TAGS.map((tag) =>
      prisma.dataTag.upsert({
        where: {
          connectionId_tagCode: {
            connectionId: connection.id,
            tagCode: tag.tagCode,
          },
        },
        update: {},
        create: {
          connectionId: connection.id,
          tagCode: tag.tagCode,
          displayName: tag.displayName,
          dataType: tag.dataType,
          unit: tag.unit,
          category: tag.category,
          plcAddress: tag.plcAddress,
          samplingMs: 10000,
          isActive: true,
          isEnabled: true,
          isVisible: tag.isVisible,
          isPrimary: tag.isPrimary,
          displayOrder: tag.displayOrder,
          source: "NCWATCH",
        },
      })
    )
  )
}

export async function getNcwatchMappings(
  tenantId: string
): Promise<NcwatchMappingRow[]> {
  await assertDeveloperOnly()
  const [mappings, statuses, historyRows, syncLogs] = await Promise.all([
    prisma.ncwatchEquipmentMapping.findMany({
      where: { tenantId },
      include: {
        equipment: { select: { id: true, code: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.ncwatchStatus.findMany({
      where: { tenantId },
      orderBy: { machineName: "asc" },
    }),
    prisma.ncwatchStatusHistory.findMany({
      where: { tenantId },
      orderBy: { receivedAt: "desc" },
      take: 1000,
    }),
    prisma.ncwatchSyncLog.findMany({
      where: { tenantId, machineName: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
  ])

  const mappingByMachine = new Map(mappings.map((row) => [row.machineName, row]))
  const statusByMachine = new Map(statuses.map((row) => [row.machineName, row]))
  const historyByMachine = new Map<string, (typeof historyRows)[number]>()
  for (const row of historyRows) {
    if (!historyByMachine.has(row.machineName)) historyByMachine.set(row.machineName, row)
  }
  const syncByMachine = new Map<string, (typeof syncLogs)[number]>()
  for (const row of syncLogs) {
    if (row.machineName && !syncByMachine.has(row.machineName)) {
      syncByMachine.set(row.machineName, row)
    }
  }

  const machineNames = new Set<string>()
  for (const row of mappings) machineNames.add(row.machineName)
  for (const row of statuses) machineNames.add(row.machineName)
  for (const row of historyRows) machineNames.add(row.machineName)

  return Array.from(machineNames)
    .sort((a, b) => a.localeCompare(b))
    .map((machineName) => {
      const mapping = mappingByMachine.get(machineName)
      const current = statusByMachine.get(machineName)
      const latestHistory = historyByMachine.get(machineName)
      const latestSync = syncByMachine.get(machineName)
      const isActive = mapping?.isActive ?? true
      const equipmentId = mapping?.equipmentId ?? null
      const status: NcwatchMappingStatus = !isActive
        ? "INACTIVE"
        : equipmentId
          ? "MAPPED"
          : "UNMAPPED"

      return {
        id: mapping?.id ?? null,
        tenantId,
        siteId: mapping?.siteId ?? current?.siteId ?? null,
        machineName,
        equipmentId,
        equipment: mapping?.equipment ?? null,
        isActive,
        memo: mapping?.memo ?? null,
        status,
        statusCode: current?.statusCode ?? latestHistory?.statusCode ?? null,
        statusLabel: current?.statusLabel ?? latestHistory?.statusLabel ?? null,
        lastReceivedAt: current?.receivedAt ?? latestHistory?.receivedAt ?? null,
        lastSyncResult: latestSync?.result ?? null,
        lastSyncMessage: latestSync?.message ?? null,
        lastSyncAt: latestSync?.createdAt ?? null,
        createdAt: mapping?.createdAt ?? null,
        updatedAt: mapping?.updatedAt ?? null,
      }
    })
}

export async function upsertNcwatchMapping(input: UpsertNcwatchMappingInput) {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "UPDATE")
  const actor = await requireDeveloper()
  const tenantId = actor.tenantId
  const machineName = normalizeMachineName(input.machineName)
  if (!machineName) throw new Error("수집 기계명을 입력하세요.")

  const equipmentId = input.equipmentId?.trim() || null
  const siteId = await resolveNcwatchSiteId(tenantId, machineName, equipmentId)

  if (input.id) {
    const owned = await prisma.ncwatchEquipmentMapping.findFirst({
      where: { id: input.id, tenantId },
    })
    if (!owned) throw new Error("NCWatch 매핑을 찾을 수 없습니다.")

    const duplicated = await prisma.ncwatchEquipmentMapping.findFirst({
      where: { tenantId, machineName, id: { not: input.id } },
      select: { id: true },
    })
    if (duplicated) throw new Error("같은 수집 기계명의 NCWatch 매핑이 이미 있습니다.")

    const updated = await prisma.ncwatchEquipmentMapping.update({
      where: { id: input.id },
      data: {
        machineName,
        siteId,
        equipmentId,
        isActive: input.isActive ?? true,
        memo: input.memo?.trim() || null,
      },
    })

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "NcwatchEquipmentMapping",
        entityId: updated.id,
        action: "UPDATE",
        beforeData: owned,
        afterData: updated,
        menuName: "설비연결설정",
      },
    }).catch(() => {})

    if (equipmentId && (input.isActive ?? true)) {
      await ensureNcwatchConnectionAndDefaultTags(tenantId, equipmentId, machineName)
    }
  } else {
    const existing = await prisma.ncwatchEquipmentMapping.findUnique({
      where: { tenantId_machineName: { tenantId, machineName } },
    })
    if (existing) throw new Error("같은 수집 기계명의 NCWatch 매핑이 이미 있습니다.")

    const created = await prisma.ncwatchEquipmentMapping.create({
      data: {
        tenantId,
        siteId,
        machineName,
        equipmentId,
        isActive: input.isActive ?? true,
        memo: input.memo?.trim() || null,
      },
    })

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorLabel: actor.name,
        entityType: "NcwatchEquipmentMapping",
        entityId: created.id,
        action: "CREATE",
        afterData: created,
        menuName: "설비연결설정",
      },
    }).catch(() => {})

    if (equipmentId && (input.isActive ?? true)) {
      await ensureNcwatchConnectionAndDefaultTags(tenantId, equipmentId, machineName)
    }
  }

  revalidatePath("/app/mes/equipment-connections")
}

export async function unmapNcwatchMapping(id: string) {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "UPDATE")
  const actor = await requireDeveloper()
  const tenantId = actor.tenantId
  const owned = await prisma.ncwatchEquipmentMapping.findFirst({
    where: { id, tenantId },
  })
  if (!owned) throw new Error("NCWatch 매핑을 찾을 수 없습니다.")

  const updated = await prisma.ncwatchEquipmentMapping.update({
    where: { id },
    data: { equipmentId: null },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "NcwatchEquipmentMapping",
      entityId: id,
      action: "UPDATE",
      beforeData: owned,
      afterData: updated,
      menuName: "설비연결설정",
    },
  }).catch(() => {})

  revalidatePath("/app/mes/equipment-connections")
}

export async function toggleNcwatchMappingActive(id: string, isActive: boolean) {
  await assertDeveloperOnly()
  await requireResourcePermission("EQUIPMENT_CONNECTION", "UPDATE")
  const actor = await requireDeveloper()
  const tenantId = actor.tenantId
  const owned = await prisma.ncwatchEquipmentMapping.findFirst({
    where: { id, tenantId },
  })
  if (!owned) throw new Error("NCWatch 매핑을 찾을 수 없습니다.")

  const updated = await prisma.ncwatchEquipmentMapping.update({
    where: { id },
    data: { isActive },
  })

  await prisma.auditLog.create({
    data: {
      tenantId,
      actorId: actor.id,
      actorLabel: actor.name,
      entityType: "NcwatchEquipmentMapping",
      entityId: id,
      action: "UPDATE",
      beforeData: { isActive: owned.isActive },
      afterData: { isActive: updated.isActive },
      menuName: "설비연결설정",
    },
  }).catch(() => {})

  revalidatePath("/app/mes/equipment-connections")
}

// ─── DataTag CRUD ─────────────────────────────────────────────────────────────

export async function getTags(tenantId: string): Promise<DataTagRow[]> {
  await assertDeveloperOnly()
  const rows = await prisma.dataTag.findMany({
    where: {
      connection: {
        equipment: { tenantId },
      },
    },
    include: {
      connection: {
        select: {
          id: true,
          protocol: true,
          equipment: { select: { id: true, code: true, name: true } },
          gateway: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ connection: { equipment: { code: "asc" } } }, { tagCode: "asc" }],
  })
  return rows.map((tag) => ({
    ...tag,
    scaleFactor: tag.scaleFactor !== null ? Number(tag.scaleFactor) : null,
    offset:      tag.offset      !== null ? Number(tag.offset)      : null,
    deadband:    tag.deadband    !== null ? Number(tag.deadband)    : null,
  }))
}

export async function createTag(data: CreateTagInput) {
  await assertDeveloperOnly()
  await requireResourcePermission("TAG_MANAGEMENT", "CREATE")
  const actor = await requireDeveloper()
  const connection = await prisma.equipmentConnection.findFirst({
    where: { id: data.connectionId, equipment: { tenantId: actor.tenantId } },
    select: { id: true },
  })
  if (!connection) throw new Error("설비 연결을 찾을 수 없습니다.")

  const existing = await prisma.dataTag.findUnique({
    where: {
      connectionId_tagCode: {
        connectionId: data.connectionId,
        tagCode: data.tagCode,
      },
    },
  })
  if (existing) {
    throw new Error(`태그코드 '${data.tagCode}'는 이 연결에 이미 존재합니다.`)
  }
  await prisma.dataTag.create({
    data: {
      connectionId: data.connectionId,
      tagCode: data.tagCode,
      displayName: data.displayName,
      dataType: data.dataType,
      unit: data.unit ?? null,
      category: data.category,
      plcAddress: data.plcAddress,
      scaleFactor: data.scaleFactor ?? null,
      offset: data.offset ?? null,
      samplingMs: data.samplingMs ?? 1000,
      deadband: data.deadband ?? null,
    },
  })
  revalidatePath("/app/mes/tags")
}

export async function updateTag(id: string, data: UpdateTagInput) {
  await assertDeveloperOnly()
  await requireResourcePermission("TAG_MANAGEMENT", "UPDATE")
  const actor = await requireDeveloper()
  const owned = await prisma.dataTag.findFirst({
    where: { id, connection: { equipment: { tenantId: actor.tenantId } } },
    select: { id: true },
  })
  if (!owned) throw new Error("태그를 찾을 수 없습니다.")

  await prisma.dataTag.update({
    where: { id },
    data: {
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.dataType !== undefined && { dataType: data.dataType }),
      ...(data.unit !== undefined && { unit: data.unit }),
      ...(data.category !== undefined && { category: data.category }),
      ...(data.plcAddress !== undefined && { plcAddress: data.plcAddress }),
      ...(data.scaleFactor !== undefined && { scaleFactor: data.scaleFactor }),
      ...(data.offset !== undefined && { offset: data.offset }),
      ...(data.samplingMs !== undefined && { samplingMs: data.samplingMs }),
      ...(data.deadband !== undefined && { deadband: data.deadband }),
    },
  })
  revalidatePath("/app/mes/tags")
}

export async function deleteTag(id: string) {
  await assertDeveloperOnly()
  await requireResourcePermission("TAG_MANAGEMENT", "DELETE")
  const actor = await requireDeveloper()
  const owned = await prisma.dataTag.findFirst({
    where: { id, connection: { equipment: { tenantId: actor.tenantId } } },
    select: { id: true },
  })
  if (!owned) throw new Error("태그를 찾을 수 없습니다.")

  await prisma.tagSnapshot.deleteMany({ where: { tagId: id } })
  await prisma.tagCurrentValue.deleteMany({ where: { tagId: id } })
  await prisma.dataTag.delete({ where: { id } })
  revalidatePath("/app/mes/tags")
}

export async function toggleTagActive(id: string, isActive: boolean) {
  await assertDeveloperOnly()
  await requireResourcePermission("TAG_MANAGEMENT", "UPDATE")
  const actor = await requireDeveloper()
  const owned = await prisma.dataTag.findFirst({
    where: { id, connection: { equipment: { tenantId: actor.tenantId } } },
    select: { id: true },
  })
  if (!owned) throw new Error("태그를 찾을 수 없습니다.")

  await prisma.dataTag.update({
    where: { id },
    data: { isActive },
  })
  revalidatePath("/app/mes/tags")
}

export async function copyEquipmentTags(
  input: CopyEquipmentTagsInput
): Promise<CopyEquipmentTagResult[]> {
  await assertDeveloperOnly()
  await requireResourcePermission("TAG_MANAGEMENT", "CREATE")
  const actor = await requireDeveloper()
  const tenantId = actor.tenantId
  const targetEquipmentIds = Array.from(new Set(input.targetEquipmentIds)).filter(
    (id) => id && id !== input.sourceEquipmentId
  )

  if (!input.sourceEquipmentId) {
    throw new Error("원본 설비를 선택하세요.")
  }
  if (targetEquipmentIds.length === 0) {
    throw new Error("적용 대상 설비를 1대 이상 선택하세요.")
  }
  if (!["SKIP", "UPDATE", "REPLACE"].includes(input.conflictMode)) {
    throw new Error("중복 처리 방식을 확인하세요.")
  }

  const sourceConnection = await prisma.equipmentConnection.findFirst({
    where: {
      equipmentId: input.sourceEquipmentId,
      isActive: true,
      equipment: { tenantId },
    },
    include: {
      equipment: { select: { id: true, code: true, name: true } },
      tags: { orderBy: { tagCode: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  })

  if (!sourceConnection) {
    throw new Error("현재 tenant의 활성 원본 설비 연결을 찾을 수 없습니다.")
  }
  if (sourceConnection.tags.length === 0) {
    throw new Error("원본 설비에 복사할 태그가 없습니다.")
  }

  const targetConnections = await prisma.equipmentConnection.findMany({
    where: {
      equipmentId: { in: targetEquipmentIds },
      isActive: true,
      equipment: { tenantId },
    },
    include: {
      equipment: { select: { id: true, code: true, name: true } },
      tags: true,
    },
    orderBy: [{ equipment: { code: "asc" } }, { createdAt: "asc" }],
  })

  const targetByEquipmentId = new Map<string, (typeof targetConnections)[number]>()
  for (const connection of targetConnections) {
    if (!targetByEquipmentId.has(connection.equipmentId)) {
      targetByEquipmentId.set(connection.equipmentId, connection)
    }
  }

  if (targetByEquipmentId.size !== targetEquipmentIds.length) {
    throw new Error("현재 tenant의 활성 연결이 없는 대상 설비가 포함되어 있습니다.")
  }

  const result = await prisma.$transaction(async (tx) => {
    const results: CopyEquipmentTagResult[] = []

    for (const targetEquipmentId of targetEquipmentIds) {
      const targetConnection = targetByEquipmentId.get(targetEquipmentId)!
      const summary: CopyEquipmentTagResult = {
        equipmentId: targetConnection.equipment.id,
        equipmentCode: targetConnection.equipment.code,
        equipmentName: targetConnection.equipment.name,
        added: 0,
        updated: 0,
        skipped: 0,
        deleted: 0,
      }

      if (input.conflictMode === "REPLACE" && targetConnection.tags.length > 0) {
        const tagIds = targetConnection.tags.map((tag) => tag.id)
        await tx.tagSnapshot.deleteMany({ where: { tagId: { in: tagIds } } })
        await tx.tagCurrentValue.deleteMany({ where: { tagId: { in: tagIds } } })
        const deleted = await tx.dataTag.deleteMany({
          where: { connectionId: targetConnection.id },
        })
        summary.deleted = deleted.count
      }

      const existingTags =
        input.conflictMode === "REPLACE"
          ? []
          : targetConnection.tags
      const existingByCode = new Map(existingTags.map((tag) => [tag.tagCode, tag]))

      for (const sourceTag of sourceConnection.tags) {
        const tagData = {
          displayName: sourceTag.displayName,
          dataType: sourceTag.dataType,
          unit: sourceTag.unit,
          category: sourceTag.category,
          plcAddress: sourceTag.plcAddress,
          scaleFactor: sourceTag.scaleFactor,
          offset: sourceTag.offset,
          samplingMs: sourceTag.samplingMs,
          deadband: sourceTag.deadband,
          isActive: sourceTag.isActive,
        }
        const existing = existingByCode.get(sourceTag.tagCode)

        if (!existing) {
          await tx.dataTag.create({
            data: {
              connectionId: targetConnection.id,
              tagCode: sourceTag.tagCode,
              ...tagData,
            },
          })
          summary.added += 1
          continue
        }

        if (input.conflictMode === "UPDATE") {
          await tx.dataTag.update({
            where: { id: existing.id },
            data: tagData,
          })
          summary.updated += 1
        } else {
          summary.skipped += 1
        }
      }

      results.push(summary)
    }

    return results
  })

  revalidatePath("/app/mes/tags")
  return result
}

// ─── Lookup Helpers ───────────────────────────────────────────────────────────

export async function getSitesForGateway(tenantId: string) {
  await assertDeveloperOnly()
  return prisma.site.findMany({
    where: { tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { name: "asc" },
  })
}

export async function getEquipmentsForConnection(tenantId: string) {
  await assertDeveloperOnly()
  return prisma.equipment.findMany({
    where: { tenantId, status: "ACTIVE" },
    select: {
      id: true,
      code: true,
      name: true,
      workCenter: { select: { name: true } },
    },
    orderBy: { code: "asc" },
  })
}

export async function getGatewaysForConnection(tenantId: string) {
  await assertDeveloperOnly()
  return prisma.edgeGateway.findMany({
    where: { tenantId },
    select: { id: true, name: true, status: true },
    orderBy: { name: "asc" },
  })
}

export async function getConnectionsForTag(tenantId: string) {
  await assertDeveloperOnly()
  return prisma.equipmentConnection.findMany({
    where: {
      equipment: { tenantId },
      isActive: true,
    },
    select: {
      id: true,
      protocol: true,
      equipment: { select: { id: true, code: true, name: true } },
      gateway: { select: { name: true } },
      _count: { select: { tags: true } },
    },
    orderBy: { equipment: { code: "asc" } },
  })
}
