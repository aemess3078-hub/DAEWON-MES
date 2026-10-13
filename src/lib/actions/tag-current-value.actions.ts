"use server"

import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { isSchemaCompatibilityError } from "@/lib/db/prisma-error"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

export type TagCurrentValueRow = {
  tagId: string
  tagCode: string
  displayName: string
  unit: string | null
  value: string
  numericValue: number | null
  quality: string
  timestamp: Date
  equipmentId: string
  equipmentName: string
}

// ─── Upsert latest value for a single tag ─────────────────────────────────────

export async function upsertTagCurrentValue(
  tagId: string,
  value: string,
  numericValue: number | null,
  quality: string,
  timestamp: Date
): Promise<void> {
  await assertDaewonFeatureScope()
  await prisma.tagCurrentValue.upsert({
    where: { tagId },
    update: { value, numericValue, quality, timestamp },
    create: { tagId, value, numericValue, quality, timestamp },
  })
}

// ─── Get current values for all tags of an equipment ──────────────────────────

export async function getCurrentTagValuesByEquipment(
  equipmentId: string
): Promise<TagCurrentValueRow[]> {
  await assertDaewonFeatureScope()
  try {
    const rows = await prisma.tagCurrentValue.findMany({
      where: {
        tag: {
          connection: { equipmentId },
          isActive: true,
          isEnabled: true,
          isVisible: true,
        },
      },
      include: {
        tag: {
          select: {
            tagCode: true,
            displayName: true,
            unit: true,
            connection: {
              select: {
                equipment: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { tag: { tagCode: "asc" } },
    })

    return rows.map((r) => ({
      tagId: r.tagId,
      tagCode: r.tag.tagCode,
      displayName: r.tag.displayName,
      unit: r.tag.unit,
      value: r.value,
      numericValue: r.numericValue !== null ? Number(r.numericValue) : null,
      quality: r.quality,
      timestamp: r.timestamp,
      equipmentId: r.tag.connection.equipment.id,
      equipmentName: r.tag.connection.equipment.name,
    }))
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) throw error
    const rows = await prisma.tagCurrentValue.findMany({
      where: {
        tag: {
          connection: { equipmentId },
          isActive: true,
        },
      },
      include: {
        tag: {
          select: {
            tagCode: true,
            displayName: true,
            unit: true,
            connection: {
              select: {
                equipment: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { tag: { tagCode: "asc" } },
    })

    return rows.map((r) => ({
      tagId: r.tagId,
      tagCode: r.tag.tagCode,
      displayName: r.tag.displayName,
      unit: r.tag.unit,
      value: r.value,
      numericValue: r.numericValue !== null ? Number(r.numericValue) : null,
      quality: r.quality,
      timestamp: r.timestamp,
      equipmentId: r.tag.connection.equipment.id,
      equipmentName: r.tag.connection.equipment.name,
    }))
  }
}

// ─── Parameter page types ─────────────────────────────────────────────────────

export type ParameterRow = {
  tagId: string
  tagCode: string
  displayName: string
  category: string
  dataType: string
  unit: string | null
  plcAddress: string
  currentValue: string | null
  numericValue: number | null
  quality: string | null
  receivedAt: Date | null
  equipmentId: string
  equipmentCode: string
  equipmentName: string
}

export type ParameterPageSummary = {
  totalEquipment: number
  connectedEquipment: number
  totalTags: number
  receivedTags: number
  noValueTags: number
}

// ─── Get all active tags with current values (optional equipment filter) ────────
//   - includes tags WITHOUT a current value (미수신) unlike getCurrentTagValuesByEquipment

export async function getParameterRows(equipmentId?: string): Promise<ParameterRow[]> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()

  try {
    const tags = await prisma.dataTag.findMany({
      where: {
        isActive: true,
        isEnabled: true,
        isVisible: true,
        connection: {
          isActive: true,
          equipment: {
            tenantId,
            ...(equipmentId ? { id: equipmentId } : {}),
          },
        },
      },
      include: {
        currentValue: true,
        connection: {
          select: {
            equipment: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: [
        { connection: { equipment: { code: "asc" } } },
        { category: "asc" },
        { tagCode: "asc" },
      ],
    })

    return tags.map((tag) => ({
      tagId: tag.id,
      tagCode: tag.tagCode,
      displayName: tag.displayName,
      category: tag.category as string,
      dataType: tag.dataType as string,
      unit: tag.unit,
      plcAddress: tag.plcAddress,
      currentValue: tag.currentValue?.value ?? null,
      numericValue:
        tag.currentValue?.numericValue != null
          ? Number(tag.currentValue.numericValue)
          : null,
      quality: tag.currentValue?.quality ?? null,
      receivedAt: tag.currentValue?.timestamp ?? null,
      equipmentId: tag.connection.equipment.id,
      equipmentCode: tag.connection.equipment.code,
      equipmentName: tag.connection.equipment.name,
    }))
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) throw error
    const tags = await prisma.dataTag.findMany({
      where: {
        isActive: true,
        connection: {
          isActive: true,
          equipment: {
            tenantId,
            ...(equipmentId ? { id: equipmentId } : {}),
          },
        },
      },
      include: {
        currentValue: true,
        connection: {
          select: {
            equipment: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: [
        { connection: { equipment: { code: "asc" } } },
        { category: "asc" },
        { tagCode: "asc" },
      ],
    })

    return tags.map((tag) => ({
      tagId: tag.id,
      tagCode: tag.tagCode,
      displayName: tag.displayName,
      category: tag.category as string,
      dataType: tag.dataType as string,
      unit: tag.unit,
      plcAddress: tag.plcAddress,
      currentValue: tag.currentValue?.value ?? null,
      numericValue:
        tag.currentValue?.numericValue != null
          ? Number(tag.currentValue.numericValue)
          : null,
      quality: tag.currentValue?.quality ?? null,
      receivedAt: tag.currentValue?.timestamp ?? null,
      equipmentId: tag.connection.equipment.id,
      equipmentCode: tag.connection.equipment.code,
      equipmentName: tag.connection.equipment.name,
    }))
  }
}

// ─── Summary stats for parameter page ─────────────────────────────────────────

export async function getParameterPageSummary(): Promise<ParameterPageSummary> {
  await assertDaewonFeatureScope()
  const tenantId = await getTenantId()

  let totalEquipment: number
  let connectedEquipment: number
  let totalTags: number
  let receivedTags: number

  try {
    ;[totalEquipment, connectedEquipment, totalTags, receivedTags] =
      await Promise.all([
        prisma.equipment.count({ where: { tenantId } }),
        prisma.equipment.count({
          where: { tenantId, connections: { some: { isActive: true } } },
        }),
        prisma.dataTag.count({
          where: {
            isActive: true,
            isEnabled: true,
            isVisible: true,
            connection: { isActive: true, equipment: { tenantId } },
          },
        }),
        prisma.tagCurrentValue.count({
          where: {
            tag: {
              isActive: true,
              isEnabled: true,
              isVisible: true,
              connection: { isActive: true, equipment: { tenantId } },
            },
          },
        }),
      ])
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) throw error
    ;[totalEquipment, connectedEquipment, totalTags, receivedTags] =
      await Promise.all([
        prisma.equipment.count({ where: { tenantId } }),
        prisma.equipment.count({
          where: { tenantId, connections: { some: { isActive: true } } },
        }),
        prisma.dataTag.count({
          where: {
            isActive: true,
            connection: { isActive: true, equipment: { tenantId } },
          },
        }),
        prisma.tagCurrentValue.count({
          where: {
            tag: {
              isActive: true,
              connection: { isActive: true, equipment: { tenantId } },
            },
          },
        }),
      ])
  }

  return {
    totalEquipment,
    connectedEquipment,
    totalTags,
    receivedTags,
    noValueTags: Math.max(0, totalTags - receivedTags),
  }
}

// ─── Get current values for a specific list of tagIds ─────────────────────────

export async function getCurrentTagValuesByTags(
  tagIds: string[]
): Promise<TagCurrentValueRow[]> {
  await assertDaewonFeatureScope()
  if (tagIds.length === 0) return []

  try {
    const rows = await prisma.tagCurrentValue.findMany({
      where: {
        tagId: { in: tagIds },
        tag: {
          isActive: true,
          isEnabled: true,
          isVisible: true,
        },
      },
      include: {
        tag: {
          select: {
            tagCode: true,
            displayName: true,
            unit: true,
            connection: {
              select: {
                equipment: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { tag: { tagCode: "asc" } },
    })

    return rows.map((r) => ({
      tagId: r.tagId,
      tagCode: r.tag.tagCode,
      displayName: r.tag.displayName,
      unit: r.tag.unit,
      value: r.value,
      numericValue: r.numericValue !== null ? Number(r.numericValue) : null,
      quality: r.quality,
      timestamp: r.timestamp,
      equipmentId: r.tag.connection.equipment.id,
      equipmentName: r.tag.connection.equipment.name,
    }))
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) throw error
    const rows = await prisma.tagCurrentValue.findMany({
      where: {
        tagId: { in: tagIds },
        tag: {
          isActive: true,
        },
      },
      include: {
        tag: {
          select: {
            tagCode: true,
            displayName: true,
            unit: true,
            connection: {
              select: {
                equipment: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { tag: { tagCode: "asc" } },
    })

    return rows.map((r) => ({
      tagId: r.tagId,
      tagCode: r.tag.tagCode,
      displayName: r.tag.displayName,
      unit: r.tag.unit,
      value: r.value,
      numericValue: r.numericValue !== null ? Number(r.numericValue) : null,
      quality: r.quality,
      timestamp: r.timestamp,
      equipmentId: r.tag.connection.equipment.id,
      equipmentName: r.tag.connection.equipment.name,
    }))
  }
}
