/**
 * 5단계 4: 완제품 입고 → 완제품 LOT/재고 → 출하 QR LOT 조회 → 품목 일치 → Multi-LOT → 출하예정 등록(예약) → 출하 확정(재고 차감)
 * → 수불·출하 결과. 수동 선택 vs QR 선택 결과 비교, 스캔만으로 등록/확정/재고 변경이 없는지, 거부 사례, 동시성(예약·확정).
 * 실제 Supabase DB + 앱의 실제 서버 액션.
 */
import { assertTarget, check, cookieJar, fixtures, info, loginAs, logout, preflight, prisma, summary, TENANT_ID, testPopPin, uniq, withTimeout } from "./lib"
import { workOrderWithWip } from "./03-wip-pop"

const mod = {
  pop: () => require("../../src/lib/actions/pop.actions") as typeof import("../../src/lib/actions/pop.actions"),
  fg: () => require("../../src/lib/actions/finished-goods.actions") as typeof import("../../src/lib/actions/finished-goods.actions"),
  ship: () => require("../../src/lib/actions/shipment.actions") as typeof import("../../src/lib/actions/shipment.actions"),
  look: () => require("../../src/lib/actions/shipment-lot-lookup.actions") as typeof import("../../src/lib/actions/shipment-lot-lookup.actions"),
}
type Fx = Awaited<ReturnType<typeof fixtures>>

export async function produceAll(fx: Fx, woId: string, qty: number) {
  logout()
  const w = await mod.pop().popLogin(testPopPin(), TENANT_ID)
  if (!w) throw new Error("POP 로그인 실패(03 시나리오가 PIN 을 설정해야 합니다)")
  const ops = await prisma.workOrderOperation.findMany({ where: { workOrderId: woId }, orderBy: { seq: "asc" } })
  for (const op of ops) {
    const s = await mod.pop().startOperation(op.id)
    if (!s.success) throw new Error(`공정 시작 실패 ${s.error}`)
    const r = await mod.pop().submitProductionResult({ workOrderOperationId: op.id, goodQty: qty, defectQty: 0, reworkQty: 0 })
    if (!r.success) throw new Error(`실적 실패 ${r.error}`)
  }
  cookieJar().delete("nmes-pop-worker-session")
  loginAs(fx.operator)
}

async function receiveFg(fx: Fx, woId: string, qty: number) {
  loginAs(fx.operator)
  return mod.fg().createFinishedGoodsReceiptAction({ workOrderId: woId, itemId: fx.fgA.id, siteId: fx.site.id, warehouseId: fx.wFg.id, receiptQty: qty }, TENANT_ID)
}

const balanceOf = async (lotId: string, warehouseId: string) => {
  const b = await prisma.inventoryBalance.findFirst({ where: { tenantId: TENANT_ID, lotId, warehouseId } })
  return b ? { onHand: Number(b.qtyOnHand), avail: Number(b.qtyAvailable) } : null
}

async function main() {
  assertTarget()
  await preflight("완제품 입고·출하 통합 테스트(04)")
  const fx = await fixtures()

  // ═══ A. 완제품 입고(분할 입고 → LOT 2개) ═════════════════════════════════
  const t = await workOrderWithWip(fx, 100)
  await produceAll(fx, t.wo.id, 100)
  const rc1 = await receiveFg(fx, t.wo.id, 60)
  const rc2 = await receiveFg(fx, t.wo.id, 40)
  check("F1", rc1.ok && rc2.ok, "완제품 입고 2회(60 + 40) 성공", { rc1, rc2 })
  const receipts = await prisma.finishedGoodsReceipt.findMany({ where: { tenantId: TENANT_ID, workOrderId: t.wo.id }, include: { lot: true }, orderBy: { receiptAt: "asc" } })
  check("F2", receipts.length === 2 && receipts.every((r) => r.lot?.itemId === fx.fgA.id && r.lot.status === "ACTIVE"), `FG 입고 이력 2건, 각각 ACTIVE 완제품 LOT 연결(${receipts.map((r) => r.lot?.lotNo).join(", ")})`)
  const lotA = receipts[0].lot!
  const lotB = receipts[1].lot!
  check("F3", lotA.id !== lotB.id, "분할 입고 → 서로 다른 LOT 2개(Multi-LOT 대상)")
  const balA = await balanceOf(lotA.id, fx.wFg.id)
  const balB = await balanceOf(lotB.id, fx.wFg.id)
  check("F4", balA?.onHand === 60 && balB?.onHand === 40, "LOT별 재고 생성(60 / 40)", { balA, balB })
  const fgTx = await prisma.inventoryTransaction.findMany({ where: { tenantId: TENANT_ID, lotId: { in: [lotA.id, lotB.id] } } })
  check("F5", fgTx.length === 2 && fgTx.every((x) => x.txType === "RECEIPT"), "완제품 입고 수불 2건")

  // 보조 데이터(직접 INSERT, 정합성: 같은 tenant/품목/창고 관계): 다른 품목 LOT, 다른 창고 LOT
  const mkLot = (lotNo: string, itemId: string) => prisma.lot.create({ data: { tenantId: TENANT_ID, itemId, lotNo, status: "ACTIVE" } })
  const mkBal = (itemId: string, lotId: string, warehouseId: string, qty: number) =>
    prisma.inventoryBalance.create({ data: { tenantId: TENANT_ID, siteId: fx.site.id, warehouseId, itemId, lotId, qtyOnHand: qty, qtyAvailable: qty } })
  const lotOtherItem = await mkLot(`ZT5-FGB-${uniq()}`, fx.fgB.id)
  await mkBal(fx.fgB.id, lotOtherItem.id, fx.wFg.id, 25)
  const lotOtherWh = await mkLot(`ZT5-FGA-WH2-${uniq()}`, fx.fgA.id)
  await mkBal(fx.fgA.id, lotOtherWh.id, fx.wFg2.id, 15)
  const lotQuar = await mkLot(`ZT5-FGA-QUAR-${uniq()}`, fx.fgA.id)
  await mkBal(fx.fgA.id, lotQuar.id, fx.wFg.id, 10)
  await prisma.lot.update({ where: { id: lotQuar.id }, data: { status: "QUARANTINE" } })
  const lotEmpty = await mkLot(`ZT5-FGA-EMPTY-${uniq()}`, fx.fgA.id)
  await mkBal(fx.fgA.id, lotEmpty.id, fx.wFg.id, 0)
  const rawLot = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, itemId: fx.rmA.id } })

  // ═══ B. 수동 목록 vs QR 조회 ══════════════════════════════════════════════
  loginAs(fx.operator)
  const snapshotAll = async () =>
    JSON.stringify({
      bal: (await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID, itemId: { in: [fx.fgA.id, fx.fgB.id] } }, orderBy: { id: "asc" }, select: { id: true, qtyOnHand: true, qtyAvailable: true } })).map((b) => [b.id, Number(b.qtyOnHand), Number(b.qtyAvailable)]),
      ship: await prisma.shipmentOrder.count({ where: { tenantId: TENANT_ID } }),
      shipItems: await prisma.shipmentItem.count({ where: { shipmentOrder: { tenantId: TENANT_ID } } }),
      tx: await prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID } }),
      soShipped: (await prisma.salesOrderItem.findMany({ where: { salesOrderId: fx.so.id }, orderBy: { id: "asc" } })).map((i) => Number(i.shippedQty)),
    })
  const s0 = await snapshotAll()
  const manualAll = (await mod.ship().getAvailableFinishedGoodsLots(TENANT_ID, fx.wFg.id, [fx.fgA.id])).lotsByItem[fx.fgA.id] ?? []
  const qrA = await mod.look().lookupLotForShipment({ warehouseId: fx.wFg.id, itemId: fx.fgA.id, lotNo: lotA.lotNo })
  const qrB = await mod.look().lookupLotForShipment({ warehouseId: fx.wFg.id, itemId: fx.fgA.id, lotNo: lotB.lotNo })
  check("Q1", qrA.ok && qrB.ok && qrA.itemId === fx.fgA.id, "[정상] 완제품 LOT QR 2개 조회 성공 · 품목 일치(FG-A)", { qrA, qrB })
  check("Q2", qrA.ok && qrB.ok && [qrA.lot, qrB.lot].every((l) => manualAll.some((m) => JSON.stringify(m) === JSON.stringify(l))), "[QR = 수동] QR 조회의 LOT 행이 수동 선택 목록(getAvailableFinishedGoodsLots)의 같은 행과 완전히 동일(실제 DB)")
  check("Q3", qrA.ok && qrA.lot.qtyAvailable === 60 && qrB.ok && qrB.lot.qtyAvailable === 40, "가용 수량 60 / 40 (예약 없음)")
  const rejects: Array<[string, string, Awaited<ReturnType<typeof mod.look>>]> = []
  void rejects
  const rej = async (label: string, lotNo: string, expected: string, extra: { warehouseId?: string; itemId?: string } = {}) => {
    const r = await mod.look().lookupLotForShipment({ warehouseId: extra.warehouseId ?? fx.wFg.id, itemId: extra.itemId ?? fx.fgA.id, lotNo })
    check(`Q-${label}`, !r.ok && r.code === expected, `[거부] ${label} → ${expected}`, r)
  }
  await rej("원자재 LOT", rawLot.lotNo, "NOT_FINISHED_GOODS")
  await rej("다른 품목(FG-B) LOT", lotOtherItem.lotNo, "ITEM_MISMATCH")
  await rej("없는 LOT", "ZT5-NO-SUCH-LOT", "LOT_NOT_FOUND")
  await rej("다른 창고 LOT", lotOtherWh.lotNo, "OTHER_WAREHOUSE")
  await rej("격리 LOT", lotQuar.lotNo, "LOT_RESTRICTED")
  await rej("재고 0 LOT", lotEmpty.lotNo, "NO_STOCK")
  await rej("잘못된 LOT 번호", "A\nB", "INVALID")
  const otherWh = await mod.look().lookupLotForShipment({ warehouseId: fx.wFg2.id, itemId: fx.fgA.id, lotNo: lotOtherWh.lotNo })
  check("Q-창고맞춤", otherWh.ok, "출하 창고를 그 창고로 선택하면 같은 LOT 가 선택 가능", otherWh)
  logout()
  const anon = await mod.look().lookupLotForShipment({ warehouseId: fx.wFg.id, itemId: fx.fgA.id, lotNo: lotA.lotNo })
  check("Q-세션없음", !anon.ok && anon.code === "UNAUTHORIZED", "로그인 없이 조회 거부", anon)
  loginAs(fx.operator)
  check("Q-스캔무변경", (await snapshotAll()) === s0, "[스캔만으로 등록/확정/재고 변경 없음] 위 조회들 후 재고·출하·출하품목·수불·수주 출하수량 변화 없음")

  // ═══ C. 출하예정 등록: 수동 선택 vs QR 선택(같은 LOT 구성) ═══════════════
  const soItem = fx.so.items.find((i) => i.itemId === fx.fgA.id)!
  const planned = async (lotId: string) => (await mod.ship().getAvailableFinishedGoodsLots(TENANT_ID, fx.wFg.id, [fx.fgA.id])).lotsByItem[fx.fgA.id]?.find((l) => l.lotId === lotId)?.qtyAvailable ?? 0
  const body = (lines: Array<{ lotId: string; qty: number }>) => ({
    salesOrderId: fx.so.id,
    plannedDate: new Date(),
    warehouseId: fx.wFg.id,
    note: "zt5",
    items: lines.map((l) => ({ salesOrderItemId: soItem.id, itemId: fx.fgA.id, lotId: l.lotId, qty: l.qty })),
  })
  const shipsBefore = await prisma.shipmentOrder.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } })
  // 수동: 목록에서 고른 LOT A 20 + LOT B 10 (Multi-LOT)
  await mod.ship().createShipment(TENANT_ID, body([{ lotId: lotA.id, qty: 20 }, { lotId: lotB.id, qty: 10 }]))
  const sManual = (await prisma.shipmentOrder.findMany({ where: { tenantId: TENANT_ID, id: { notIn: shipsBefore.map((s) => s.id) } }, include: { items: true } }))[0]
  check("H1", !!sManual && sManual.status === "PLANNED" && sManual.items.length === 2, "[수동] 출하예정 등록(PLANNED) · Multi-LOT 2행", sManual)
  check("H2", (await planned(lotA.id)) === 40 && (await planned(lotB.id)) === 30, "예약 수량 반영: 가용 A 60→40, B 40→30 (실재고는 그대로)")
  check("H3", (await balanceOf(lotA.id, fx.wFg.id))?.onHand === 60, "예약만으로 실재고(현재고) 차감 없음")
  // QR: QR 조회가 확인해 준 LOT 로 같은 구성의 두 번째 출하예정 등록
  const q1 = await mod.look().lookupLotForShipment({ warehouseId: fx.wFg.id, itemId: fx.fgA.id, lotNo: lotA.lotNo })
  const q2 = await mod.look().lookupLotForShipment({ warehouseId: fx.wFg.id, itemId: fx.fgA.id, lotNo: lotB.lotNo })
  check("H4", q1.ok && q2.ok && q1.lot.qtyAvailable === 40 && q2.lot.qtyAvailable === 30, "QR 조회가 예약 반영된 가용(40/30)을 보여 준다 — 수동 목록과 동일 기준")
  const shipsMid = await prisma.shipmentOrder.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } })
  if (q1.ok && q2.ok) await mod.ship().createShipment(TENANT_ID, body([{ lotId: q1.lotId, qty: 20 }, { lotId: q2.lotId, qty: 10 }]))
  const sQr = (await prisma.shipmentOrder.findMany({ where: { tenantId: TENANT_ID, id: { notIn: shipsMid.map((s) => s.id) } }, include: { items: true } }))[0]
  const shape = (s: typeof sManual) => JSON.stringify({ status: s.status, warehouse: s.warehouseId, items: s.items.map((i) => [i.lotId, Number(i.qty), i.itemId, i.salesOrderItemId]).sort() })
  check("H5", !!sQr && shape(sQr) === shape(sManual), "[QR = 수동] QR 로 고른 LOT 로 등록한 출하예정과 수동 등록의 결과 구조(LOT·수량·품목·수주 품목·창고·상태)가 동일", { m: shape(sManual), q: sQr && shape(sQr) })
  check("H6", (await planned(lotA.id)) === 20 && (await planned(lotB.id)) === 20, "두 번째 예약 후 가용 A 20, B 20")
  // 예약 초과 거부
  const tooMany = await mod.ship().createShipment(TENANT_ID, body([{ lotId: lotA.id, qty: 21 }])).then(() => "ok", (e: Error) => e.message)
  check("H7", tooMany !== "ok" && String(tooMany).includes("예약 가능"), "예약 가능 수량 초과 등록 거부", tooMany)
  const dupLot = await mod.ship().createShipment(TENANT_ID, body([{ lotId: lotA.id, qty: 1 }, { lotId: lotA.id, qty: 1 }])).then(() => "ok", (e: Error) => e.message)
  check("H8", dupLot !== "ok", "같은 수주품목·같은 LOT 중복 거부", dupLot)
  const quarShip = await mod.ship().createShipment(TENANT_ID, body([{ lotId: lotQuar.id, qty: 1 }])).then(() => "ok", (e: Error) => e.message)
  check("H9", quarShip !== "ok", "격리 LOT 는 QR/수동 구분 없이 등록 서버 검증에서 거부", quarShip)

  // ═══ D. 출하 확정 ═══════════════════════════════════════════════════════
  const soBefore = Number((await prisma.salesOrderItem.findFirstOrThrow({ where: { id: soItem.id } })).shippedQty)
  const confirmed = async (shipId: string) => {
    const r = await mod.ship().confirmShipment(shipId).then(() => "ok", (e: Error) => e.message)
    return r
  }
  const c1 = await confirmed(sManual.id)
  check("C1", c1 === "ok", "[수동 출하] 출하 확정", c1)
  const afterManual = { a: await balanceOf(lotA.id, fx.wFg.id), b: await balanceOf(lotB.id, fx.wFg.id) }
  check("C2", afterManual.a?.onHand === 40 && afterManual.a.avail === 40 && afterManual.b?.onHand === 30 && afterManual.b.avail === 30, "출하 확정 → LOT 실재고 차감(A 60→40, B 40→30)", afterManual)
  const c2 = await confirmed(sQr!.id)
  check("C3", c2 === "ok", "[QR 선택 출하] 출하 확정", c2)
  const afterQr = { a: await balanceOf(lotA.id, fx.wFg.id), b: await balanceOf(lotB.id, fx.wFg.id) }
  check("C4", afterQr.a?.onHand === 20 && afterQr.b?.onHand === 20, "QR 선택 출하도 같은 규칙으로 차감(A 40→20, B 30→20)", afterQr)
  const issueTx = async (shipId: string) => {
    const items = await prisma.shipmentItem.findMany({ where: { shipmentOrderId: shipId }, select: { id: true } })
    return (await prisma.inventoryTransaction.findMany({ where: { tenantId: TENANT_ID, refType: "SHIPMENT_ITEM", refId: { in: items.map((i) => i.id) } } })).map((x) => `${x.txType}:${Number(x.qty)}`).sort()
  }
  const txM = await issueTx(sManual.id)
  const txQ = await issueTx(sQr!.id)
  check("C5", txM.join() === "ISSUE:10,ISSUE:20" && txM.join() === txQ.join(), "수불 이력: 수동/QR 모두 ISSUE 20·10 각 2건 — 동일", { txM, txQ })
  const soAfter = Number((await prisma.salesOrderItem.findFirstOrThrow({ where: { id: soItem.id } })).shippedQty)
  const so = await prisma.salesOrder.findFirstOrThrow({ where: { id: fx.so.id } })
  check("C6", soAfter - soBefore === 60 && so.status === "PARTIAL_SHIPPED", `수주 출하수량 +60 · 수주 상태 ${so.status}`)
  const sd = await prisma.shipmentOrder.findMany({ where: { id: { in: [sManual.id, sQr!.id] } } })
  check("C7", sd.every((s) => s.status === "SHIPPED" && s.shippedDate), "출하 상태 SHIPPED · 출하일 기록")
  const again = await confirmed(sManual.id)
  check("C8", again !== "ok" && (await balanceOf(lotA.id, fx.wFg.id))?.onHand === 20, "이미 확정된 출하 재확정 거부 · 재고 추가 차감 없음", again)

  // ═══ E. 동시성 ═══════════════════════════════════════════════════════════
  // E1. 같은 LOT(가용 20)에 대해 동시 출하예정 등록(각 15) → 한 건만 성공
  const raceBody = (n: number) => body([{ lotId: lotA.id, qty: n }])
  const race = await withTimeout("동시 예약", 60000, () => Promise.all([0, 1, 2, 3].map(() => mod.ship().createShipment(TENANT_ID, raceBody(15)).then(() => "ok", (e: Error) => e.message.slice(0, 40)))))
  const raceOk = race.filter((r) => r === "ok").length
  check("K1", raceOk === 1 && (await planned(lotA.id)) === 5, `같은 LOT 동시 출하예정 등록 4건(각 15, 가용 20) → 성공 정확히 1건 · 가용 20→5 (초과 예약 없음)`, race)
  // E2. 같은 출하의 동시 확정 → 한 건만 성공
  const reserved = await prisma.shipmentOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, status: "PLANNED", items: { some: { lotId: lotA.id } } } })
  const onHandBefore = (await balanceOf(lotA.id, fx.wFg.id))!.onHand
  const confirms = await withTimeout("동시 확정", 60000, () => Promise.all([0, 1, 2, 3].map(() => mod.ship().confirmShipment(reserved.id).then(() => "ok", (e: Error) => e.message.slice(0, 30)))))
  const cOk = confirms.filter((r) => r === "ok").length
  check("K2", cOk === 1 && (await balanceOf(lotA.id, fx.wFg.id))!.onHand === onHandBefore - 15, "같은 출하 동시 확정 4건 → 성공 1건 · 재고 정확히 15만 차감(이중 차감 없음)", confirms)
  // E3. 서로 다른 출하(같은 LOT 두 건 예약 후)를 동시에 확정 → 합계 차감, 음수 없음
  const s3 = await mod.ship().createShipment(TENANT_ID, body([{ lotId: lotB.id, qty: 8 }])).then(() => "ok", (e: Error) => e.message)
  const s4 = await mod.ship().createShipment(TENANT_ID, body([{ lotId: lotB.id, qty: 7 }])).then(() => "ok", (e: Error) => e.message)
  const pend = await prisma.shipmentOrder.findMany({ where: { tenantId: TENANT_ID, status: "PLANNED", items: { some: { lotId: lotB.id } } } })
  const bBefore = (await balanceOf(lotB.id, fx.wFg.id))!.onHand
  const both = await withTimeout("동시 확정(서로 다른 출하)", 60000, () => Promise.all(pend.map((p) => mod.ship().confirmShipment(p.id).then(() => "ok", (e: Error) => e.message.slice(0, 30)))))
  const bAfter = await balanceOf(lotB.id, fx.wFg.id)
  check("K3", s3 === "ok" && s4 === "ok" && both.every((x) => x === "ok") && bAfter!.onHand === bBefore - 15 && bAfter!.avail >= 0, "같은 LOT 의 서로 다른 출하 2건 동시 확정 → 모두 성공 · 합계 15 정확 차감 · 음수 없음", { s3, s4, both, bAfter })
  // E4. 확정 중 LOT 상태 변경(격리) — 확정 직전에 LOT 를 격리하면 확정 거부
  const s5 = await mod.ship().createShipment(TENANT_ID, body([{ lotId: lotB.id, qty: 2 }])).then(() => "ok", (e: Error) => e.message)
  const s5Ship = await prisma.shipmentOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, status: "PLANNED", items: { some: { lotId: lotB.id } } } })
  await prisma.lot.update({ where: { id: lotB.id }, data: { status: "QUARANTINE" } })
  const c5 = await confirmed(s5Ship.id)
  const stillPlanned = await prisma.shipmentOrder.findFirstOrThrow({ where: { id: s5Ship.id } })
  check("K4", s5 === "ok" && c5 !== "ok" && stillPlanned.status === "PLANNED", "예약 후 LOT 가 격리되면 출하 확정 거부 · 출하는 PLANNED 로 롤백 유지", { s5, c5, status: stillPlanned.status })
  const lookQuar = await mod.look().lookupLotForShipment({ warehouseId: fx.wFg.id, itemId: fx.fgA.id, lotNo: lotB.lotNo })
  check("K5", !lookQuar.ok && lookQuar.code === "LOT_RESTRICTED", "격리된 LOT 의 QR 조회도 거부(상태 변경이 즉시 반영)", lookQuar)
  await prisma.lot.update({ where: { id: lotB.id }, data: { status: "ACTIVE" } })
  const c5b = await confirmed(s5Ship.id)
  check("K6", c5b === "ok", "LOT 가 ACTIVE 로 복구되면 같은 출하를 정상 확정(잔여 잠금·상태 오염 없음)", c5b)
  // E5. 재고 부족(예약은 가능했으나 실재고를 외부에서 줄인 경우) 확정 시 롤백
  const s6 = await mod.ship().createShipment(TENANT_ID, body([{ lotId: lotA.id, qty: 4 }])).then(() => "ok", (e: Error) => e.message)
  const s6Ship = await prisma.shipmentOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, status: "PLANNED", items: { some: { lotId: lotA.id } } } })
  const balRow = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotId: lotA.id, warehouseId: fx.wFg.id } })
  await prisma.inventoryBalance.update({ where: { id: balRow.id }, data: { qtyOnHand: 2, qtyAvailable: 2 } }) // 테스트용 재고 임의 감소
  const txBefore = await prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID } })
  const c6 = await confirmed(s6Ship.id)
  const st6 = await prisma.shipmentOrder.findFirstOrThrow({ where: { id: s6Ship.id } })
  check("K7", s6 === "ok" && c6 !== "ok" && st6.status === "PLANNED" && (await prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID } })) === txBefore && (await balanceOf(lotA.id, fx.wFg.id))?.onHand === 2, "실재고 부족 시 확정 실패 → 출하 PLANNED 유지 · 수불/재고 변경 없음(트랜잭션 롤백)", { s6, c6, status: st6.status })

  console.log("IDS " + JSON.stringify({ wo: t.wo.id, lotA: lotA.lotNo, lotB: lotB.lotNo, shipManual: sManual.shipmentNo, shipQr: sQr?.shipmentNo }))
  info("DONE", "테스트 출하/재고는 ZT5 접두어 데이터로 남아 있다")
  summary("fg-shipment")
}
if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-6).join(" | "))
      summary("fg-shipment (중단 — 여기까지의 결과)")
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
