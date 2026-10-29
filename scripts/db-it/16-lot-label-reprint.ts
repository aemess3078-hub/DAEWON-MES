/**
 * LOT 관리 [라벨 출력](등록된 LOT 라벨 재출력) 서버 동작 — 실제 PostgreSQL(대원정밀 ZT5 테스트 데이터) + 앱의 실제 서버 액션.
 *  - 입고는 실제 입고 처리(createReceivingInspection)로 만든 뒤, 입고 처리를 다시 하지 않고 LOT 기준으로 라벨 정보를 조회·출력 기록한다.
 *  - 확인: 원본 입고 건의 수량·일자 · 최초 출력(사유 없음) · 재출력(사유 필수) · QR 동일 · 다른 LOT/권한 · 업무 데이터 불변.
 *  - 쓰기: ZT5 테스트 LOT 3개(입고 3건) + AuditLog(LotLabel) 기록. 삭제는 하지 않는다.
 * 실행: DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=<로컬 *_test DB 주소> DEFAULT_TENANT_ID=<테넌트> npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/db-it/16-lot-label-reprint.ts
 */
import { assertTarget, check, fixtures, info, loginAs, logout, prisma, summary, TENANT_ID, uniq } from "./lib"

type Fx = Awaited<ReturnType<typeof fixtures>>
const a = {
  receiving: () => require("../../src/lib/actions/receiving.actions") as typeof import("../../src/lib/actions/receiving.actions"),
  label: () => require("../../src/lib/actions/lot-label.actions") as typeof import("../../src/lib/actions/lot-label.actions"),
  source: () => require("../../src/lib/actions/lot-label-reprint.actions") as typeof import("../../src/lib/actions/lot-label-reprint.actions"),
  lot: () => require("../../src/lib/actions/lot.actions") as typeof import("../../src/lib/actions/lot.actions"),
}

async function receive(fx: Fx, itemId: string, qty: number, lotNo: string) {
  const poItem = fx.po.items.find((i) => i.itemId === itemId)!
  const r = await a.receiving().createReceivingInspection({
    purchaseOrderItemId: poItem.id,
    purchaseOrderId: fx.po.id,
    warehouseId: fx.wRm.id,
    siteId: fx.site.id,
    receivedQty: qty,
    acceptedQty: qty,
    rejectedQty: 0,
    result: "PASS",
    requestId: `zt7-rcv-${uniq()}-${uniq()}`,
    lotNo,
  })
  if (!r.success) throw new Error(`입고 실패 ${JSON.stringify(r).slice(0, 200)}`)
}

/** LOT 와 연결된 업무 데이터 스냅샷(라벨 출력 전후 비교용). */
async function snapshot(lotId: string, poId: string) {
  const [lot, balances, txs, inspections, po, wip, shipItems, fgReceipts, genealogy, consumption] = await Promise.all([
    prisma.lot.findUniqueOrThrow({ where: { id: lotId } }),
    prisma.inventoryBalance.findMany({ where: { lotId }, orderBy: { id: "asc" }, select: { id: true, qtyOnHand: true, qtyAvailable: true } }),
    prisma.inventoryTransaction.findMany({ where: { lotId }, orderBy: { txNo: "asc" }, select: { txNo: true, txType: true, qty: true, txAt: true } }),
    prisma.receivingInspection.count({ where: { purchaseOrderItem: { purchaseOrderId: poId } } }),
    prisma.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, select: { status: true, items: { select: { id: true, receivedQty: true }, orderBy: { id: "asc" } } } }),
    prisma.wipUnit.count({ where: { lotId } }),
    prisma.shipmentItem.count({ where: { lotId } }),
    prisma.finishedGoodsReceipt.count({ where: { lotId } }),
    prisma.lotGenealogy.count({ where: { OR: [{ parentLotId: lotId }, { childLotId: lotId }] } }),
    prisma.materialConsumption.count({ where: { lotId } }),
  ])
  return JSON.stringify({ lot, balances, txs, inspections, po, wip, shipItems, fgReceipts, genealogy, consumption })
}

const auditRows = (lotId: string) =>
  prisma.auditLog.findMany({ where: { tenantId: TENANT_ID, entityType: "LotLabel", entityId: lotId }, orderBy: { actedAt: "asc" }, select: { afterData: true } })

async function main() {
  assertTarget()
  const fx = await fixtures()
  loginAs(fx.operator)
  const run = uniq()

  // ═══ 1. 입고 확정 → 라벨 출력 없이 창을 닫음 → LOT 관리에서 최초 출력 ═══════════════
  const lotNoA = `ZT7-L-${run}-A`
  await receive(fx, fx.rmA.id, 30, lotNoA)
  const lotA = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotNo: lotNoA } })
  const srcA = await a.source().getLotLabelSource({ lotId: lotA.id })
  check("R1", srcA.ok && srcA.receipts.length === 1 && srcA.receipts[0].qty === 30 && srcA.receipts[0].kind === "PURCHASE" && srcA.receipts[0].refNo === fx.po.orderNo, "[원자재] 입고 이력 1건: 원래 입고수량 30 · 근거 발주번호", srcA.ok ? srcA.receipts : srcA)
  if (!srcA.ok) throw new Error("source A 실패")
  const ageMs = Math.abs(Date.now() - new Date(srcA.receipts[0].at).getTime())
  check("R2", ageMs < 15 * 60 * 1000 && srcA.lot.lotNo === lotNoA && srcA.lot.itemCode === fx.rmA.code && srcA.lot.itemName === fx.rmA.name && srcA.labelType === "RAW_LOT" && srcA.lot.spec === (fx.rmA.spec ?? null), "라벨 데이터(품목코드·품목명·LOT번호·유형)는 서버 저장값이고 입고 시각이 입고 건에서 온다")

  const before = await snapshot(lotA.id, fx.po.id)
  check("R3", (await auditRows(lotA.id)).length === 0, "입고 후 라벨을 출력하지 않았으므로 출력 요청 이력이 없다")
  const chk0 = await a.label().checkLotLabelPrintable({ lotNos: [lotNoA] })
  check("R4", chk0.ok && chk0.reprintLotNos.length === 0, "[최초 출력] 이력 없음 → 재출력 사유 불필요", chk0)
  const rec1 = await a.label().recordLotLabelPrint({ lotNos: [lotNoA], purpose: "RECEIPT", context: "LOT관리 라벨 출력 · test" })
  check("R5", rec1.ok && rec1.results[0].event === "LABEL_PRINT" && rec1.results[0].printCount === 1 && rec1.results[0].qrPayload === `DAEWON|LOT|1|${lotNoA}`, "최초 출력 요청이 LABEL_PRINT(1회)로 기록되고 QR 은 DAEWON|LOT|1|<LOT번호>", rec1)
  const rowsA1 = await auditRows(lotA.id)
  const dataA1 = rowsA1[0]?.afterData as { event?: string; reason?: unknown; context?: string; qrPayload?: string; lotNo?: string } | undefined
  check("R6", rowsA1.length === 1 && dataA1?.event === "LABEL_PRINT" && !dataA1.reason &&dataA1.context === "LOT관리 라벨 출력 · test" && dataA1.lotNo === lotNoA, "AuditLog(LotLabel)에 최초 출력이 1건, 사유 없음, 출력 맥락과 함께 남는다", dataA1)

  // ═══ 2. 재출력: 사유 필수, QR 동일 ═══════════════════════════════════════════════
  const chk1 = await a.label().checkLotLabelPrintable({ lotNos: [lotNoA] })
  check("R7", chk1.ok && chk1.reprintLotNos.join() === lotNoA, "[재출력] 출력 요청 이력이 있으면 재출력 대상으로 판정", chk1)
  const noReason = await a.label().recordLotLabelPrint({ lotNos: [lotNoA], purpose: "RECEIPT" })
  check("R8", !noReason.ok && noReason.code === "REASON_REQUIRED" && (await auditRows(lotA.id)).length === 1, "사유 없이 재출력하면 거부되고 감사 이력은 늘지 않는다", noReason)
  const rec2 = await a.label().recordLotLabelPrint({ lotNos: [lotNoA], purpose: "RECEIPT", reason: "라벨 인쇄 실패 후 재출력", context: "LOT관리 라벨 출력 · test" })
  check("R9", rec1.ok && rec2.ok && rec2.results[0].event === "LABEL_REPRINT" && rec2.results[0].printCount === 2 && rec2.results[0].qrPayload === rec1.results[0].qrPayload, "사유를 넣은 재출력은 LABEL_REPRINT(2회)로 기록되고 QR 값이 최초와 같다", rec2)
  const rowsA2 = await auditRows(lotA.id)
  const dataA2 = rowsA2[1]?.afterData as { reason?: string; event?: string } | undefined
  check("R10", rowsA2.length === 2 && dataA2?.event === "LABEL_REPRINT" && dataA2.reason === "라벨 인쇄 실패 후 재출력", "재출력 사유가 감사 이력에 저장된다", dataA2)
  const after = await snapshot(lotA.id, fx.po.id)
  check("R11", before === after, "[불변] 최초 출력·재출력 전후로 LOT(번호·상태·수정시각)·재고·입고·수불·발주 입고수량·WIP·출하·생산입고·계보가 동일")

  // ═══ 3. 입고 직후 출력(기존 입고 라벨 흐름) 이후 LOT 관리 출력 = 재출력 ═══════════════
  const lotNoB = `ZT7-L-${run}-B`
  await receive(fx, fx.rmB.id, 20, lotNoB)
  const lotB = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotNo: lotNoB } })
  const recvPrint = await a.label().recordLotLabelPrint({ lotNos: [lotNoB], purpose: "RECEIPT" }) // 입고 창의 [인쇄]와 같은 호출(맥락 없음)
  check("R12", recvPrint.ok && recvPrint.results[0].event === "LABEL_PRINT", "[기존 입고 직후 라벨 출력 유지] 입고 창에서의 인쇄 요청은 그대로 최초 출력으로 기록된다")
  const chkB = await a.label().checkLotLabelPrintable({ lotNos: [lotNoB] })
  check("R13", chkB.ok && chkB.reprintLotNos.join() === lotNoB, "입고 직후 한 번 출력했다면 LOT 관리에서 다시 출력할 때 재출력 사유가 필요하다")

  // ═══ 4. 입고 이력이 여러 건인 LOT: 현재 재고가 아닌 입고 건별 값 ═════════════════════
  await receive(fx, fx.rmA.id, 12, lotNoA) // 같은 LOT 에 2번째 입고(실제 입고 처리)
  const srcA2 = await a.source().getLotLabelSource({ lotId: lotA.id })
  const balA = await prisma.inventoryBalance.aggregate({ where: { lotId: lotA.id }, _sum: { qtyOnHand: true } })
  check("R14", srcA2.ok && srcA2.receipts.map((r) => r.qty).join() === "30,12" && Number(balA._sum.qtyOnHand) === 42, "[입고 이력 여러 건] 입고 건이 30, 12 로 구분되어 조회되고 현재 재고(42)와 다르다 — 현재 재고를 입고수량으로 쓰지 않는다", srcA2.ok ? srcA2.receipts.map((r) => r.qty) : srcA2)
  check("R15", srcA2.ok && new Set(srcA2.receipts.map((r) => r.key)).size === 2 && srcA2.receipts[0].at <= srcA2.receipts[1].at, "입고 건은 서로 다른 키(수불)로 오래된 순 정렬되어 라벨 대상 건을 선택할 수 있다")

  // ═══ 5. 입고 이력이 없는 LOT(수동 등록) ═════════════════════════════════════════════
  loginAs(fx.admin)
  const lotNoC = `ZT7-L-${run}-C`
  await a.lot().createLot({ itemId: fx.rmA.id, lotNo: lotNoC, qty: 0 }, TENANT_ID)
  loginAs(fx.operator)
  const lotC = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotNo: lotNoC } })
  const srcC = await a.source().getLotLabelSource({ lotId: lotC.id })
  check("R16", srcC.ok && srcC.receipts.length === 0, "[원본 입고정보 없음] 수동 등록 LOT 는 입고 이력이 비어 있다 — 수량·일자를 만들어 내지 않는다", srcC)

  // ═══ 6. 완제품 LOT (실제 생산입고로 만들어진 기존 ZT5 LOT) ══════════════════════════════
  const fgReceipt = await prisma.finishedGoodsReceipt.findFirst({ where: { tenantId: TENANT_ID, lotId: { not: null }, item: { code: "ZT5-FG-A" } }, orderBy: { receiptAt: "desc" }, include: { lot: true, workOrder: { select: { orderNo: true } } } })
  if (!fgReceipt?.lot) {
    info("R17", "기존 ZT5 완제품 입고 LOT 가 없어 완제품 조회 확인을 건너뜀(04 를 먼저 실행하세요)")
  } else {
    const fgLotId = fgReceipt.lot.id
    const allFgReceipts = await prisma.finishedGoodsReceipt.findMany({ where: { lotId: fgLotId }, select: { receiptQty: true } })
    const srcFg = await a.source().getLotLabelSource({ lotId: fgLotId })
    const fgBefore = JSON.stringify(await prisma.inventoryBalance.findMany({ where: { lotId: fgLotId }, orderBy: { id: "asc" }, select: { qtyOnHand: true, qtyAvailable: true } }))
    check("R17", srcFg.ok && srcFg.labelType === "FG_LOT" && srcFg.receipts.length === allFgReceipts.length && srcFg.receipts.every((r) => r.kind === "PRODUCTION") && srcFg.receipts.map((r) => r.qty).sort().join() === allFgReceipts.map((r) => Number(r.receiptQty)).sort().join(), `[완제품] ${fgReceipt.lot.lotNo}: 생산입고(FinishedGoodsReceipt) ${allFgReceipts.length}건의 수량과 일치 · 유형 FG_LOT · 근거 작업지시`, srcFg)
    const fgRecordBefore = (await auditRows(fgLotId)).length
    const fgCheck = await a.label().checkLotLabelPrintable({ lotNos: [fgReceipt.lot.lotNo] })
    check("R18", fgCheck.ok, "완제품 LOT 도 같은 출력 가능 확인(checkLotLabelPrintable)을 통과한다")
    const fgRec = await a.label().recordLotLabelPrint({ lotNos: [fgReceipt.lot.lotNo], purpose: "RECEIPT", reason: fgRecordBefore > 0 ? "테스트 재출력" : undefined, context: "LOT관리 라벨 출력 · test" })
    check("R19", fgRec.ok && fgRec.results[0].qrPayload === `DAEWON|LOT|1|${fgReceipt.lot.lotNo}` && fgRec.results[0].event === (fgRecordBefore > 0 ? "LABEL_REPRINT" : "LABEL_PRINT"), "완제품 LOT 출력 요청 기록(QR 동일 형식, 이력에 따라 최초/재출력)", fgRec)
    const fgAfter = JSON.stringify(await prisma.inventoryBalance.findMany({ where: { lotId: fgLotId }, orderBy: { id: "asc" }, select: { qtyOnHand: true, qtyAvailable: true } }))
    check("R20", fgBefore === fgAfter, "완제품 LOT 출력 전후 재고 동일")
  }

  // ═══ 7. 잘못된 LOT · 다른 tenant · 권한 ═══════════════════════════════════════════════
  const bogus = await a.source().getLotLabelSource({ lotId: "does-not-exist" })
  check("R21", !bogus.ok && bogus.code === "NOT_FOUND", "존재하지 않는 LOT 는 조회 거부(NOT_FOUND)", bogus)
  const bogusCheck = await a.label().checkLotLabelPrintable({ lotNos: [`ZT7-NOPE-${run}`] })
  const bogusRecord = await a.label().recordLotLabelPrint({ lotNos: [`ZT7-NOPE-${run}`], purpose: "RECEIPT" })
  const stray = await prisma.auditLog.count({ where: { tenantId: TENANT_ID, entityType: "LotLabel", afterData: { path: ["lotNo"], equals: `ZT7-NOPE-${run}` } } })
  check("R22", !bogusCheck.ok && bogusCheck.code === "LOT_NOT_PERSISTED" && !bogusRecord.ok && bogusRecord.code === "LOT_NOT_PERSISTED" && stray === 0, "등록되지 않은 LOT 번호는 출력 확인·기록 모두 거부되고 감사 기록이 남지 않는다")
  const foreign = await prisma.lot.findFirst({ where: { tenantId: { not: TENANT_ID } }, select: { id: true, lotNo: true } })
  if (!foreign) {
    info("R23", "다른 tenant 의 LOT 가 DB 에 없어 tenant 격리 확인은 건너뜀(소스 검사로 세션 tenant 조건 확인)")
  } else {
    const f = await a.source().getLotLabelSource({ lotId: foreign.id })
    const fc = await a.label().checkLotLabelPrintable({ lotNos: [foreign.lotNo] })
    check("R23", !f.ok && f.code === "NOT_FOUND" && (!fc.ok ? true : false), "다른 tenant 의 LOT 는 조회·출력 확인 모두 '없음'과 같은 응답")
  }
  logout()
  const anonSrc = await a.source().getLotLabelSource({ lotId: lotA.id })
  const anonCheck = await a.label().checkLotLabelPrintable({ lotNos: [lotNoA] })
  const anonRec = await a.label().recordLotLabelPrint({ lotNos: [lotNoA], purpose: "RECEIPT", reason: "x" })
  check("R24", !anonSrc.ok && anonSrc.code === "UNAUTHORIZED" && !anonCheck.ok && anonCheck.code === "UNAUTHORIZED" && !anonRec.ok && anonRec.code === "UNAUTHORIZED" && (await auditRows(lotA.id)).length === 2, "로그인 없이는 조회·확인·기록 모두 거부되고 감사 기록이 늘지 않는다")
  loginAs(fx.viewer)
  const viewerSrc = await a.source().getLotLabelSource({ lotId: lotA.id })
  info("R25", `조회 전용 사용자(viewer)의 LOT 라벨 정보 조회: ${viewerSrc.ok ? "허용(LOT 화면 조회 권한과 동일)" : `거부(${viewerSrc.code})`}`)

  // ═══ 8. 최종 불변 확인 ═════════════════════════════════════════════════════════════
  const lotAfter = await prisma.lot.findFirstOrThrow({ where: { id: lotB.id } })
  check("R26", lotAfter.lotNo === lotNoB && String(lotAfter.status) === "ACTIVE" && lotAfter.updatedAt.getTime() === lotB.updatedAt.getTime(), "출력 확인·기록 후에도 LOT 번호·상태·수정시각이 그대로다(번호 재채번 없음)")
  summary("lot-label-reprint")
  await prisma.$disconnect()
}
main().catch(async (e) => {
  console.error("실패:", (e as Error).message.split("\n").slice(-3).join(" | "))
  process.exitCode = 1
  await prisma.$disconnect()
})
