"use server"

import { Prisma } from "@prisma/client"
import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/db/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { isUniqueConstraintError, kstDateParts } from "@/lib/business-numbering"
import { adjustInventoryStock } from "@/lib/actions/inventory.actions"
import {
  calcAdjustTarget,
  calcCountDiff,
  hasDriftedSinceStart,
  parseCountedQty,
  summarizeCount,
  type CountSummary,
  type StockCountStatusKey,
} from "@/lib/stock-count/stock-count-calc"

/**
 * 재고실사(창고 단위).
 *  - 시작: 해당 창고의 재고(수량 0 초과)를 스냅샷(전산수량)으로 줄로 만들고 시작시각을 기록한다.
 *  - 실사 중에도 입출고는 막지 않는다. 종료 후 조정 시 시작 이후 변동분은 보존한다(calcAdjustTarget).
 *  - 종료: 종료시각을 기록한다. 재고는 바꾸지 않는다.
 *  - 조정: 종료된 실사의 차이 줄만 기존 재고조정(adjustInventoryStock, MANAGER 이상)으로 반영한다.
 */

const PATH = "/app/mes/stock-count"
const num = (v: Prisma.Decimal | number | null | undefined) => (v == null ? null : Number(v))

export type StockCountListRow = {
  id: string
  countNo: string
  status: StockCountStatusKey
  warehouse: { id: string; code: string; name: string }
  startedAt: string
  endedAt: string | null
  startedByName: string | null
  endedByName: string | null
  note: string | null
  summary: CountSummary
}

export type StockCountLineView = {
  id: string
  balanceId: string | null
  itemCode: string
  itemName: string
  uom: string
  lotNo: string | null
  systemQty: number
  countedQty: number | null
  diffQty: number | null
  countedAt: string | null
  countedByName: string | null
  adjustedAt: string | null
  adjustedByName: string | null
  adjustTxNo: string | null
  adjustedToQty: number | null
  adjustReason: string | null
  /** 미조정 줄의 현재 재고와 실사 시작 이후 변동 여부 */
  currentQty: number | null
  drifted: boolean
}

export type StockCountDetail = StockCountListRow & {
  cancelReason: string | null
  lines: StockCountLineView[]
}

export type ActionResult<T = undefined> = { success: true; data?: T } | { success: false; error: string }

export async function getStockCountWarehouses() {
  const user = await requireResourcePermission("INVENTORY", "READ")
  return prisma.warehouse.findMany({ where: { tenantId: user.tenantId }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } })
}

export async function getStockCounts(): Promise<StockCountListRow[]> {
  const user = await requireResourcePermission("INVENTORY", "READ")
  const rows = await prisma.stockCount.findMany({
    where: { tenantId: user.tenantId },
    orderBy: { startedAt: "desc" },
    take: 300,
    include: {
      warehouse: { select: { id: true, code: true, name: true } },
      lines: { select: { systemQty: true, countedQty: true, adjustedAt: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    countNo: r.countNo,
    status: r.status,
    warehouse: r.warehouse,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt?.toISOString() ?? null,
    startedByName: r.startedByName,
    endedByName: r.endedByName,
    note: r.note,
    summary: summarizeCount(r.lines.map((l) => ({ systemQty: Number(l.systemQty), countedQty: num(l.countedQty), adjustedAt: l.adjustedAt }))),
  }))
}

export async function getStockCountDetail(id: string): Promise<StockCountDetail | null> {
  const user = await requireResourcePermission("INVENTORY", "READ")
  const sc = await prisma.stockCount.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { warehouse: { select: { id: true, code: true, name: true } }, lines: { orderBy: [{ itemCode: "asc" }, { lotNo: "asc" }] } },
  })
  if (!sc) return null

  const balanceIds = sc.lines.filter((l) => l.balanceId && !l.adjustedAt).map((l) => l.balanceId as string)
  const balances = balanceIds.length
    ? await prisma.inventoryBalance.findMany({ where: { id: { in: balanceIds }, tenantId: user.tenantId }, select: { id: true, qtyOnHand: true } })
    : []
  const currentBy = new Map(balances.map((b) => [b.id, Number(b.qtyOnHand)]))

  const lines: StockCountLineView[] = sc.lines.map((l) => {
    const systemQty = Number(l.systemQty)
    const countedQty = num(l.countedQty)
    const currentQty = l.balanceId && !l.adjustedAt ? currentBy.get(l.balanceId) ?? null : null
    return {
      id: l.id,
      balanceId: l.balanceId,
      itemCode: l.itemCode,
      itemName: l.itemName,
      uom: l.uom,
      lotNo: l.lotNo,
      systemQty,
      countedQty,
      diffQty: calcCountDiff(systemQty, countedQty),
      countedAt: l.countedAt?.toISOString() ?? null,
      countedByName: l.countedByName,
      adjustedAt: l.adjustedAt?.toISOString() ?? null,
      adjustedByName: l.adjustedByName,
      adjustTxNo: l.adjustTxNo,
      adjustedToQty: num(l.adjustedToQty),
      adjustReason: l.adjustReason,
      currentQty,
      drifted: currentQty != null && hasDriftedSinceStart(systemQty, currentQty),
    }
  })

  return {
    id: sc.id,
    countNo: sc.countNo,
    status: sc.status,
    warehouse: sc.warehouse,
    startedAt: sc.startedAt.toISOString(),
    endedAt: sc.endedAt?.toISOString() ?? null,
    startedByName: sc.startedByName,
    endedByName: sc.endedByName,
    note: sc.note,
    cancelReason: sc.cancelReason,
    summary: summarizeCount(lines.map((l) => ({ systemQty: l.systemQty, countedQty: l.countedQty, adjustedAt: l.adjustedAt }))),
    lines,
  }
}

// ─── 시작 ────────────────────────────────────────────────────────────────────

export async function startStockCount(input: { warehouseId: string; note?: string | null }): Promise<ActionResult<{ id: string; countNo: string }>> {
  const user = await requireResourcePermission("INVENTORY", "CREATE")
  const tenantId = user.tenantId
  const warehouseId = input.warehouseId?.trim()
  if (!warehouseId) return { success: false, error: "실사할 창고를 선택해 주세요." }
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, tenantId }, select: { id: true, code: true, name: true } })
  if (!warehouse) return { success: false, error: "창고를 찾을 수 없습니다." }

  const running = await prisma.stockCount.findFirst({ where: { tenantId, warehouseId, status: "IN_PROGRESS" }, select: { countNo: true } })
  if (running) return { success: false, error: `이 창고에는 이미 진행 중인 실사(${running.countNo})가 있습니다.` }

  const { yyyymmdd } = kstDateParts()
  const prefix = `SC-${yyyymmdd}-`
  const note = input.note?.trim() || null

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const last = await prisma.stockCount.findFirst({ where: { tenantId, countNo: { startsWith: prefix } }, orderBy: { countNo: "desc" }, select: { countNo: true } })
    const seq = last ? (parseInt(last.countNo.slice(prefix.length), 10) || 0) + 1 : 1
    const countNo = `${prefix}${String(seq).padStart(3, "0")}`
    try {
      const created = await prisma.$transaction(async (tx) => {
        const balances = await tx.inventoryBalance.findMany({
          where: { tenantId, warehouseId, qtyOnHand: { gt: 0 } },
          select: { id: true, itemId: true, lotId: true, qtyOnHand: true, item: { select: { code: true, name: true, uom: true } }, lot: { select: { lotNo: true } } },
          orderBy: [{ item: { code: "asc" } }],
        })
        const sc = await tx.stockCount.create({
          data: { tenantId, warehouseId, countNo, note, startedById: user.profileId, startedByName: user.name },
        })
        if (balances.length) {
          await tx.stockCountLine.createMany({
            data: balances.map((b) => ({
              stockCountId: sc.id,
              balanceId: b.id,
              itemId: b.itemId,
              itemCode: b.item.code,
              itemName: b.item.name,
              uom: String(b.item.uom),
              lotId: b.lotId,
              lotNo: b.lot?.lotNo ?? null,
              systemQty: b.qtyOnHand,
            })),
          })
        }
        await recordAuditLog(tx, {
          tenantId,
          actor: user,
          entityType: "StockCount",
          entityId: sc.id,
          action: "CREATE",
          menuName: "재고실사",
          afterData: { countNo, warehouse: warehouse.name, lineCount: balances.length, note },
        })
        return sc
      })
      revalidatePath(PATH)
      return { success: true, data: { id: created.id, countNo } }
    } catch (e) {
      if (isUniqueConstraintError(e, ["tenantId", "warehouseId"])) return { success: false, error: "이 창고에는 이미 진행 중인 실사가 있습니다." }
      if (isUniqueConstraintError(e, ["tenantId", "countNo"]) && attempt < 4) continue
      return { success: false, error: e instanceof Error ? e.message : "실사 시작 중 오류가 발생했습니다." }
    }
  }
  return { success: false, error: "실사번호 생성에 실패했습니다. 다시 시도해 주세요." }
}

// ─── 실사수량 저장 ────────────────────────────────────────────────────────────

export async function saveStockCountQuantities(input: { stockCountId: string; counts: Array<{ lineId: string; countedQty: string | number | null }> }): Promise<ActionResult<{ saved: number }>> {
  const user = await requireResourcePermission("INVENTORY", "UPDATE")
  const sc = await prisma.stockCount.findFirst({ where: { id: input.stockCountId, tenantId: user.tenantId }, select: { id: true, status: true } })
  if (!sc) return { success: false, error: "실사를 찾을 수 없습니다." }
  if (sc.status !== "IN_PROGRESS") return { success: false, error: "진행 중인 실사만 수량을 입력할 수 있습니다." }

  const parsed: Array<{ lineId: string; qty: number | null }> = []
  for (const c of input.counts) {
    const q = parseCountedQty(c.countedQty)
    if (q === undefined) return { success: false, error: "실사수량은 0 이상의 숫자여야 합니다." }
    parsed.push({ lineId: c.lineId, qty: q })
  }
  const lineIds = Array.from(new Set(parsed.map((p) => p.lineId)))
  const valid = await prisma.stockCountLine.findMany({ where: { id: { in: lineIds }, stockCountId: sc.id }, select: { id: true } })
  if (valid.length !== lineIds.length) return { success: false, error: "실사 줄을 찾을 수 없습니다." }

  const now = new Date()
  await prisma.$transaction(
    parsed.map((p) =>
      prisma.stockCountLine.update({
        where: { id: p.lineId },
        data: p.qty == null ? { countedQty: null, countedAt: null, countedByName: null } : { countedQty: p.qty, countedAt: now, countedByName: user.name },
      }),
    ),
  )
  revalidatePath(PATH)
  return { success: true, data: { saved: parsed.length } }
}

// ─── 종료 / 취소 ──────────────────────────────────────────────────────────────

export async function finishStockCount(stockCountId: string): Promise<ActionResult<{ endedAt: string }>> {
  const user = await requireResourcePermission("INVENTORY", "UPDATE")
  const tenantId = user.tenantId
  try {
    const endedAt = await prisma.$transaction(async (tx) => {
      const sc = await tx.stockCount.findFirst({ where: { id: stockCountId, tenantId }, include: { lines: { select: { systemQty: true, countedQty: true, adjustedAt: true } } } })
      if (!sc) throw new Error("실사를 찾을 수 없습니다.")
      if (sc.status !== "IN_PROGRESS") throw new Error("진행 중인 실사만 종료할 수 있습니다.")
      const summary = summarizeCount(sc.lines.map((l) => ({ systemQty: Number(l.systemQty), countedQty: num(l.countedQty), adjustedAt: l.adjustedAt })))
      const now = new Date()
      await tx.stockCount.update({ where: { id: sc.id }, data: { status: "COMPLETED", endedAt: now, endedById: user.profileId, endedByName: user.name } })
      await recordAuditLog(tx, {
        tenantId, actor: user, entityType: "StockCount", entityId: sc.id, action: "UPDATE", menuName: "재고실사",
        beforeData: { status: "IN_PROGRESS" },
        afterData: { status: "COMPLETED", countNo: sc.countNo, endedAt: now.toISOString(), ...summary },
      })
      return now
    })
    revalidatePath(PATH)
    return { success: true, data: { endedAt: endedAt.toISOString() } }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "실사 종료 중 오류가 발생했습니다." }
  }
}

export async function cancelStockCount(input: { stockCountId: string; reason: string }): Promise<ActionResult> {
  const user = await requireResourcePermission("INVENTORY", "UPDATE")
  const reason = input.reason?.trim()
  if (!reason) return { success: false, error: "취소 사유를 입력해 주세요." }
  try {
    await prisma.$transaction(async (tx) => {
      const sc = await tx.stockCount.findFirst({ where: { id: input.stockCountId, tenantId: user.tenantId } })
      if (!sc) throw new Error("실사를 찾을 수 없습니다.")
      if (sc.status !== "IN_PROGRESS") throw new Error("진행 중인 실사만 취소할 수 있습니다.")
      await tx.stockCount.update({ where: { id: sc.id }, data: { status: "CANCELLED", endedAt: new Date(), endedById: user.profileId, endedByName: user.name, cancelReason: reason } })
      await recordAuditLog(tx, { tenantId: user.tenantId, actor: user, entityType: "StockCount", entityId: sc.id, action: "UPDATE", menuName: "재고실사", beforeData: { status: "IN_PROGRESS" }, afterData: { status: "CANCELLED", countNo: sc.countNo, reason } })
    })
    revalidatePath(PATH)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "실사 취소 중 오류가 발생했습니다." }
  }
}

// ─── 조정 (실사 종료 후) ──────────────────────────────────────────────────────

type Actor = Awaited<ReturnType<typeof requireResourcePermission>>

async function adjustOneLine(user: Actor, lineId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const line = await prisma.stockCountLine.findFirst({
    where: { id: lineId, stockCount: { tenantId: user.tenantId } },
    include: { stockCount: { select: { id: true, countNo: true, status: true } } },
  })
  if (!line) return { ok: false, error: "실사 줄을 찾을 수 없습니다." }
  if (line.stockCount.status !== "COMPLETED") return { ok: false, error: "실사 종료 후에 조정할 수 있습니다." }
  if (line.adjustedAt) return { ok: false, error: "이미 조정된 줄입니다." }
  const systemQty = Number(line.systemQty)
  const counted = num(line.countedQty)
  const diff = calcCountDiff(systemQty, counted)
  if (counted == null || diff == null) return { ok: false, error: `${line.itemCode}: 실사수량이 입력되지 않았습니다.` }
  if (diff === 0) return { ok: false, error: `${line.itemCode}: 차이가 없습니다.` }
  if (!line.balanceId) return { ok: false, error: `${line.itemCode}: 재고 행을 찾을 수 없습니다.` }

  const balance = await prisma.inventoryBalance.findFirst({ where: { id: line.balanceId, tenantId: user.tenantId }, select: { qtyOnHand: true } })
  if (!balance) return { ok: false, error: `${line.itemCode}: 재고 행을 찾을 수 없습니다.` }
  const target = calcAdjustTarget(counted, systemQty, Number(balance.qtyOnHand))

  const res = await adjustInventoryStock({
    balanceId: line.balanceId,
    physicalQty: target,
    reason,
    note: `재고실사 ${line.stockCount.countNo}`,
  })
  if (!res.success) return { ok: false, error: `${line.itemCode}: ${res.error ?? "재고조정 실패"}` }

  await prisma.stockCountLine.update({
    where: { id: line.id },
    data: { adjustedAt: new Date(), adjustedByName: user.name, adjustTxNo: res.txNo ?? null, adjustedToQty: target, adjustReason: reason },
  })
  return { ok: true }
}

export async function adjustStockCountLine(input: { lineId: string; reason: string }): Promise<ActionResult> {
  const user = await requireResourcePermission("INVENTORY", "UPDATE")
  const reason = input.reason?.trim()
  if (!reason) return { success: false, error: "재고조정 사유를 입력해 주세요." }
  const r = await adjustOneLine(user, input.lineId, reason)
  revalidatePath(PATH)
  revalidatePath("/app/mes/inventory")
  return r.ok ? { success: true } : { success: false, error: r.error }
}

/** 실사 종료된 건의 차이 줄을 한 번에 조정한다. 일부 실패해도 성공한 줄은 반영되고 실패 목록을 돌려준다. */
export async function adjustAllStockCountLines(input: { stockCountId: string; reason: string }): Promise<ActionResult<{ adjusted: number; failed: string[] }>> {
  const user = await requireResourcePermission("INVENTORY", "UPDATE")
  const reason = input.reason?.trim()
  if (!reason) return { success: false, error: "재고조정 사유를 입력해 주세요." }
  const sc = await prisma.stockCount.findFirst({ where: { id: input.stockCountId, tenantId: user.tenantId }, include: { lines: true } })
  if (!sc) return { success: false, error: "실사를 찾을 수 없습니다." }
  if (sc.status !== "COMPLETED") return { success: false, error: "실사 종료 후에 조정할 수 있습니다." }

  let adjusted = 0
  const failed: string[] = []
  for (const l of sc.lines) {
    if (l.adjustedAt) continue
    const diff = calcCountDiff(Number(l.systemQty), num(l.countedQty))
    if (diff == null || diff === 0) continue
    const r = await adjustOneLine(user, l.id, reason)
    if (r.ok) adjusted += 1
    else failed.push(r.error)
  }
  revalidatePath(PATH)
  revalidatePath("/app/mes/inventory")
  return { success: true, data: { adjusted, failed } }
}
