/**
 * 5단계 2: 원자재 입고 → LOT/재고 → QR LOT 조회 → 자재출고(수동 vs QR) → 재고 차감 → 수불 이력 → WIP 생성·연결.
 * 실제 Supabase DB + 앱의 실제 서버 액션. 테스트 데이터는 ZT5 접두어.
 */
import { assertTarget, check, fixtures, info, loginAs, prisma, summary, TENANT_ID, uniq } from "./lib"

type Fx = Awaited<ReturnType<typeof fixtures>>
const a = {
  receiving: () => require("../../src/lib/actions/receiving.actions") as typeof import("../../src/lib/actions/receiving.actions"),
  wo: () => require("../../src/lib/actions/work-order.actions") as typeof import("../../src/lib/actions/work-order.actions"),
  issue: () => require("../../src/lib/actions/material-issue.actions") as typeof import("../../src/lib/actions/material-issue.actions"),
  lookup: () => require("../../src/lib/actions/material-issue-lot-lookup.actions") as typeof import("../../src/lib/actions/material-issue-lot-lookup.actions"),
}

async function receive(fx: Fx, itemId: string, qty: number, requestId = `zt5-rcv-${uniq()}-${uniq()}`, lotNo = `ZT5-L-${uniq()}`) {
  const poItem = fx.po.items.find((i) => i.itemId === itemId)!
  return a.receiving().createReceivingInspection({
    purchaseOrderItemId: poItem.id,
    purchaseOrderId: fx.po.id,
    warehouseId: fx.wRm.id,
    siteId: fx.site.id,
    receivedQty: qty,
    acceptedQty: qty,
    rejectedQty: 0,
    result: "PASS",
    requestId,
    lotNo,
  })
}

async function newWorkOrder(fx: Fx, qty: number) {
  loginAs(fx.admin) // 작업지시 생성/릴리즈는 관리자 권한(OPERATOR 에는 WORK_ORDER CREATE 권한 없음)
  const orderNo = `ZT5-WO-${uniq()}`
  const mfg = `ZT5-MFG-${uniq()}`
  const r = await a.wo().createWorkOrder(
    {
      siteId: fx.site.id,
      itemId: fx.fgA.id,
      bomId: fx.bom.id,
      routingId: fx.routing.id,
      orderNo,
      manufacturingNo: mfg,
      plannedQty: qty,
      status: "DRAFT",
      operations: fx.routing.operations.map((o, i) => ({ routingOperationId: o.id, seq: (i + 1) * 10, plannedQty: qty })),
    },
    TENANT_ID,
  )
  if (!(r as { success?: boolean }).success) throw new Error(`작업지시 생성 실패: ${JSON.stringify(r).slice(0, 300)}`)
  const wo = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, manufacturingNo: mfg } })
  const rel = await a.wo().releaseWorkOrder(wo.id)
  if (!rel.success) throw new Error(`릴리즈 실패: ${rel.error}`)
  loginAs(fx.operator)
  return prisma.workOrder.findFirstOrThrow({ where: { id: wo.id } })
}

async function main() {
  assertTarget()
  const fx = await fixtures()
  loginAs(fx.operator)

  // ── 1. 원자재 입고(LOT 자동 생성) ──────────────────────────────────────────
  // 반복 실행 안전: 이번 실행이 만든 LOT 만 대상으로 한다(실행 식별자 포함 LOT 번호). DB 에 이전 실행/다른 테스트의 LOT·수불이 쌓여 있어도 영향이 없다.
  const run = uniq()
  const runLotNos = [1, 2, 3].map((n) => `ZT5-L-${run}-A${n}`).concat(`ZT5-L-${run}-B1`)
  const r1 = await receive(fx, fx.rmA.id, 300, undefined, runLotNos[0])
  const r2 = await receive(fx, fx.rmA.id, 400, undefined, runLotNos[1])
  const r3 = await receive(fx, fx.rmA.id, 300, undefined, runLotNos[2])
  const r4 = await receive(fx, fx.rmB.id, 500, undefined, runLotNos[3])
  check("R1", [r1, r2, r3, r4].every((r) => r.success), "원자재 입고 4건 성공(RM-A 3 LOT, RM-B 1 LOT)", [r1, r2, r3, r4].filter((r) => !r.success))
  const lots = await prisma.lot.findMany({ where: { tenantId: TENANT_ID, lotNo: { in: runLotNos } }, orderBy: { createdAt: "asc" } })
  check("R2", lots.length === 4 && new Set(lots.map((l) => l.lotNo)).size === lots.length, `LOT 4개 생성, LOT 번호 유일(예: ${lots.at(-1)?.lotNo})`)
  const balances = await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID, lotId: { in: lots.map((l) => l.id) } } })
  const bal = (lotId: string) => balances.find((b) => b.lotId === lotId)
  check("R3", lots.every((l) => bal(l.id)) && Number(bal(lots.filter((l) => l.itemId === fx.rmA.id)[1].id)?.qtyOnHand) === 400, "LOT별 재고 행 생성(입고수량 = 현재고)")
  const txs = await prisma.inventoryTransaction.findMany({ where: { tenantId: TENANT_ID, lotId: { in: lots.map((l) => l.id) } } })
  check("R4", txs.length >= 4 && txs.every((t) => t.txType === "RECEIPT"), `수불 이력 RECEIPT ${txs.length}건`)

  // ── 2. 멱등성: 같은 requestId 재전송 ───────────────────────────────────────
  const rid = `zt5-idem-${uniq()}-${uniq()}`
  const idemLot = `ZT5-L-${uniq()}`
  const i1 = await receive(fx, fx.rmB.id, 50, rid, idemLot)
  const lotCountMid = await prisma.lot.count({ where: { tenantId: TENANT_ID, itemId: fx.rmB.id } })
  const i2 = await receive(fx, fx.rmB.id, 50, rid, idemLot)
  const lotCountAfter = await prisma.lot.count({ where: { tenantId: TENANT_ID, itemId: fx.rmB.id } })
  check("R5", i1.success && i2.success && lotCountMid === lotCountAfter, "같은 requestId 재전송 → 새 LOT/입고 없이 기존 결과(멱등)", { i1, i2 })

  // ── 3. 작업지시 2건(수동용/QR용) ────────────────────────────────────────────
  const woManual = await newWorkOrder(fx, 10) // RM-A 20, RM-B 10 필요
  const woQr = await newWorkOrder(fx, 10)
  const list = await a.issue().getWorkOrdersForIssue(TENANT_ID)
  const mm = list.find((w) => w.id === woManual.id)
  check("R6", !!mm && mm.materials.length === 2 && mm.materials.find((m) => m.itemId === fx.rmA.id)?.requiredQty === 20, "자재출고 대상 조회: BOM 자재 2종 · RM-A 필요 20", mm?.materials)

  // ── 4. QR LOT 조회 vs 수동 LOT 목록 ────────────────────────────────────────
  const rmALots = lots.filter((l) => l.itemId === fx.rmA.id)
  const manual = (await a.issue().getLotStockByItems([fx.rmA.id, fx.rmB.id], TENANT_ID))[fx.rmA.id] ?? []
  const q1 = await a.lookup().lookupLotForMaterialIssue({ workOrderId: woQr.id, lotNo: rmALots[0].lotNo })
  check("R7", q1.ok && q1.options.length === 1 && manual.some((m) => JSON.stringify(m) === JSON.stringify((q1 as { options: unknown[] }).options[0])), "QR 조회 결과가 수동 선택 목록의 같은 LOT 행과 동일(실제 DB 쿼리)", q1)
  const bogus = await a.lookup().lookupLotForMaterialIssue({ workOrderId: woQr.id, lotNo: "ZT5-NO-SUCH-LOT" })
  const fgLot = await a.lookup().lookupLotForMaterialIssue({ workOrderId: woQr.id, lotNo: "ZT5-NO-SUCH-LOT" })
  check("R8", !bogus.ok && bogus.code === "LOT_NOT_FOUND" && !fgLot.ok, "없는 LOT 거부(실제 DB)")

  // ── 5. 출고: 수동 선택 vs QR 선택(같은 LOT·수량) ───────────────────────────
  const issueBody = (woId: string, lotIdA: string, lotIdB: string) => ({
    workOrderId: woId,
    siteId: fx.site.id,
    items: [
      { itemId: fx.rmA.id, lots: [{ lotId: lotIdA, warehouseId: fx.wRm.id, quantity: 20 }], issueQty: 20, requiredQty: 20, reservationId: null },
      { itemId: fx.rmB.id, lots: [{ lotId: lotIdB, warehouseId: fx.wRm.id, quantity: 10 }], issueQty: 10, requiredQty: 10, reservationId: null },
    ],
  })
  const rmBLot = lots.find((l) => l.itemId === fx.rmB.id)!
  const snap = async () =>
    JSON.stringify(
      (await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID, lotId: { in: [rmALots[0].id, rmALots[1].id, rmBLot.id] } }, orderBy: { id: "asc" } })).map((b) => [b.lotId, Number(b.qtyOnHand), Number(b.qtyAvailable)]),
    )
  const s0 = await snap()
  // 수동: 수동 목록에서 고른 LOT(rmALots[0])
  const resManual = await a.issue().issueMaterialsForWorkOrder(issueBody(woManual.id, rmALots[0].id, rmBLot.id), TENANT_ID)
  const s1 = await snap()
  // QR: QR 조회가 돌려준 LOT(rmALots[1]) — 다른 LOT 이지만 같은 수량. 결과 형태를 비교한다.
  const q2 = await a.lookup().lookupLotForMaterialIssue({ workOrderId: woQr.id, lotNo: rmALots[1].lotNo })
  const qrLotId = q2.ok ? q2.options[0].lotId : ""
  const qrBLot = await a.lookup().lookupLotForMaterialIssue({ workOrderId: woQr.id, lotNo: rmBLot.lotNo })
  check("R9", q2.ok && qrBLot.ok && q2.lotId === rmALots[1].id, "QR 로 각 자재의 LOT 확인(실제 DB)", { q2, qrBLot })
  check("R10", s0 === (await snap().then(() => s0)) && resManual.ok, "수동 출고 성공", resManual)
  const s1Parsed = JSON.parse(s1) as Array<[string, number, number]>
  const delta = (before: string, after: string, lotId: string) => {
    const b = (JSON.parse(before) as Array<[string, number, number]>).find((x) => x[0] === lotId)!
    const f = (JSON.parse(after) as Array<[string, number, number]>).find((x) => x[0] === lotId)!
    return [b[1] - f[1], b[2] - f[2]]
  }
  check("R11", delta(s0, s1, rmALots[0].id).join() === "20,20" && delta(s0, s1, rmBLot.id).join() === "10,10", "수동 출고 → 해당 LOT 재고(현재고·가용) 정확히 20/10 차감")
  const sBeforeQr = s1
  const resQr = await a.issue().issueMaterialsForWorkOrder(issueBody(woQr.id, qrLotId, qrBLot.ok ? qrBLot.lotId : ""), TENANT_ID)
  const s2 = await snap()
  check("R12", resQr.ok && delta(sBeforeQr, s2, rmALots[1].id).join() === "20,20" && delta(sBeforeQr, s2, rmBLot.id).join() === "10,10", "QR 로 고른 LOT 출고 → 같은 규칙으로 차감(20/10)", resQr)

  // ── 6. 수불 이력·WIP·추적 비교 ─────────────────────────────────────────────
  const shape = async (woId: string) => {
    const issueTx = await prisma.inventoryTransaction.findMany({ where: { tenantId: TENANT_ID, refType: "WORK_ORDER", refId: woId }, orderBy: { qty: "asc" } })
    const wips = await prisma.wipUnit.findMany({ where: { workOrderId: woId } })
    const mlots = await prisma.workOrderMaterialLot.findMany({ where: { workOrderId: woId } })
    const wipLinks = wips.length ? await prisma.wipUnitMaterialLot.findMany({ where: { wipUnitId: { in: wips.map((w) => w.id) } } }) : []
    const moves = wips.length ? await prisma.wipMovement.findMany({ where: { wipUnitId: { in: wips.map((w) => w.id) } } }) : []
    return {
      tx: issueTx.map((t) => `${t.txType}:${Number(t.qty)}:${t.refType}`),
      wip: wips.map((w) => `${w.status}:${Number(w.qty)}`),
      materialLots: mlots.length,
      wipLinks: wipLinks.length,
      moves: moves.map((m) => `${m.movementType}:${m.sourceType}`),
    }
  }
  const sm = await shape(woManual.id)
  const sq = await shape(woQr.id)
  info("R13-DETAIL", `수동 ${JSON.stringify(sm)} / QR ${JSON.stringify(sq)}`)
  check("R13", JSON.stringify(sm) === JSON.stringify(sq) && sm.tx.length === 2 && sm.wip.length === 1 && sm.materialLots === 2 && sm.wipLinks === 2 && sm.moves.join() === "CREATED:MATERIAL_ISSUE", "수동/QR 출고의 수불(2건 ISSUE)·WIP 1건 생성·자재 LOT 추적·WIP 연결·이력이 동일")

  // ── 7. 재고 부족/중복 LOT 거부 + 롤백 ──────────────────────────────────────
  const woFail = await newWorkOrder(fx, 10)
  const sFail0 = await snap()
  const txCount0 = await prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID, refType: "WORK_ORDER", refId: woFail.id } })
  const tooMuch = await a.issue().issueMaterialsForWorkOrder(
    { workOrderId: woFail.id, siteId: fx.site.id, items: [{ itemId: fx.rmA.id, lots: [{ lotId: rmALots[2].id, warehouseId: fx.wRm.id, quantity: 9999 }], issueQty: 9999, requiredQty: 20, reservationId: null }] },
    TENANT_ID,
  )
  const txCount1 = await prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID, refType: "WORK_ORDER", refId: woFail.id } })
  check("R14", !tooMuch.ok && (await snap()) === sFail0 && txCount0 === txCount1, "재고 초과 출고 거부 → 재고·수불 변화 없음(롤백)", tooMuch)
  const dup = await a.issue().issueMaterialsForWorkOrder(
    { workOrderId: woFail.id, siteId: fx.site.id, items: [{ itemId: fx.rmA.id, lots: [{ lotId: rmALots[2].id, warehouseId: fx.wRm.id, quantity: 5 }, { lotId: rmALots[2].id, warehouseId: fx.wRm.id, quantity: 5 }], issueQty: 10, requiredQty: 20, reservationId: null }] },
    TENANT_ID,
  )
  check("R15", !dup.ok && (await snap()) === sFail0, "같은 LOT 중복 선택 거부(서버 규칙)", dup)

  // ── 8. 읽기 전용: QR 조회가 재고를 바꾸지 않음 ─────────────────────────────
  const sQ0 = await snap()
  for (let i = 0; i < 5; i++) await a.lookup().lookupLotForMaterialIssue({ workOrderId: woFail.id, lotNo: rmALots[2].lotNo })
  check("R16", (await snap()) === sQ0, "QR 조회를 반복해도 재고 불변(실제 DB)")
  console.log("IDS " + JSON.stringify({ woManual: woManual.id, woQr: woQr.id, woFail: woFail.id, rmALots: rmALots.map((l) => l.lotNo), rmBLot: rmBLot.lotNo }))
  summary("raw-material")
}
if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-6).join(" | "))
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
