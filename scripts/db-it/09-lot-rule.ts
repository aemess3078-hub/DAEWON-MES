/**
 * LOT 자동 채번(번호 규칙 관리의 저장 규칙) 실제 DB 통합 테스트.
 * 실제 Supabase(대원정밀 테스트 환경) + 앱의 실제 서버 액션. 테스트 데이터는 ZT6/ZT5 접두어(ZT5 픽스처 품목 재사용).
 *
 * - 사용자가 저장한 NumberingRule(LOT)을 수정하지 않는다. 규칙 없음/비활성 케이스는 트랜잭션 안에서만 바꾸고 롤백한다.
 * - 기존 업무 데이터(DW-* 품목 등)에는 쓰지 않는다. DW-7 은 번호 "미리보기(계산)"에만 쓴다.
 * 실행: DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=<로컬 *_test DB 주소> DEFAULT_TENANT_ID=<테넌트> npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/db-it/09-lot-rule.ts
 */
import type { Prisma } from "@prisma/client"
import { assertTarget, check, fixtures, info, loginAs, logout, prisma, summary, TENANT_ID, uniq } from "./lib"

const act = {
  receiving: () => require("../../src/lib/actions/receiving.actions") as typeof import("../../src/lib/actions/receiving.actions"),
  reservation: () => require("../../src/lib/actions/lot-reservation.actions") as typeof import("../../src/lib/actions/lot-reservation.actions"),
  numbering: () => require("../../src/lib/actions/numbering-rule.actions") as typeof import("../../src/lib/actions/numbering-rule.actions"),
  wo: () => require("../../src/lib/actions/work-order.actions") as typeof import("../../src/lib/actions/work-order.actions"),
  fg: () => require("../../src/lib/actions/finished-goods-lot.helpers") as typeof import("../../src/lib/actions/finished-goods-lot.helpers"),
  lib: () => require("../../src/lib/lot-numbering/tenant-lot-rule") as typeof import("../../src/lib/lot-numbering/tenant-lot-rule"),
  biz: () => require("../../src/lib/business-numbering") as typeof import("../../src/lib/business-numbering"),
}

type Fx = Awaited<ReturnType<typeof fixtures>>

async function maxSeqIn(stem: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: number | null }>>(
    `select max(s)::int as n from (
       select substring("lotNo" from ${stem.length + 1})::int as s from "Lot" where "tenantId" = $1 and "lotNo" ~ $2
       union all
       select substring("lotNo" from ${stem.length + 1})::int as s from "LotNumberReservation" where "tenantId" = $1 and "lotNo" ~ $2
     ) t`,
    TENANT_ID,
    `^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\d{3}$`,
  )
  return rows[0]?.n ?? 0
}

async function main() {
  assertTarget()
  const fx: Fx = await fixtures()
  const { year2, monthText } = act.biz().kstDateParts()
  const yymm = `${year2}${monthText}`
  const stemA = `${fx.rmA.code}${yymm}-`
  const stemB = `${fx.rmB.code}${yymm}-`
  const stemFg = `${fx.fgA.code}${yymm}-`
  const no = (stem: string, n: number) => `${stem}${String(n).padStart(3, "0")}`

  // ── L1. 저장된 규칙 조회 ───────────────────────────────────────────────────
  const rule = await prisma.numberingRule.findUniqueOrThrow({ where: { tenantId_type: { tenantId: TENANT_ID, type: "LOT" } } })
  const types = (rule.tokens as Array<{ type: string; key?: string; format?: string; value?: string; digits?: number }>).map((t) => `${t.type}:${t.key ?? t.format ?? t.value ?? t.digits}`)
  check("L1", rule.isActive && types.join("|") === "CONTEXT:ITEM_CODE|DATE:YY|DATE:MM|SEPARATOR:-|SEQ:3", "저장된 활성 LOT 규칙 = 품목코드 + 연(2) + 월(2) + 하이픈 + 순번(3)", types)
  const seqRowsBefore = await prisma.numberingSequence.count({ where: { ruleId: rule.id } })

  // ── L2. 계산(미리보기)은 순번을 소비하지 않는다 ──────────────────────────────
  loginAs(fx.admin)
  const baseA = await maxSeqIn(stemA)
  const compute = (itemCode: string, itemType: string, offset = 0) =>
    act.lib().computeNextTenantRuleLotNo(prisma as never, TENANT_ID, { itemCode, itemType, lotNumberingType: "DEFAULT" }, new Date(), offset)
  const p1 = await compute(fx.rmA.code, "RAW_MATERIAL")
  const p2 = await compute(fx.rmA.code, "RAW_MATERIAL")
  check("L2", p1 === no(stemA, baseA + 1) && p2 === p1, `같은 품목 미리보기 2회 → 같은 번호(${p1}), {ITEM_CODE} 미치환 없음`, { p1, p2 })
  check("L2b", !p1.includes("{") && (await prisma.numberingSequence.count({ where: { ruleId: rule.id } })) === seqRowsBefore, "미리보기만으로 NumberingSequence 가 생성/증가하지 않음")

  // ── L3. 다른 품목 / 요구사항 예시(DW-7) ──────────────────────────────────────
  const baseB = await maxSeqIn(stemB)
  const pB = await compute(fx.rmB.code, "RAW_MATERIAL")
  check("L3", pB === no(stemB, baseB + 1), `다른 품목은 자기 stem 으로 별도 순번(${pB})`)
  const dw7 = await prisma.item.findFirst({ where: { tenantId: TENANT_ID, code: "DW-7" }, select: { code: true, itemType: true, lotNumberingType: true } })
  if (dw7) {
    const pDw = await compute(dw7.code, dw7.itemType)
    check("L3b", /^DW-7\d{4}-\d{3}$/.test(pDw) && pDw.startsWith(`DW-7${yymm}-`), `요구사항 예시: 품목 DW-7 → ${pDw} (DW-7 YY MM - 순번)`)
  } else info("L3b", "DW-7 품목 없음 — 건너뜀")

  // ── L4. 규칙 없음/비활성/깨진 규칙 → 안내 오류 (트랜잭션 롤백) ────────────────
  const rollback = new Error("ROLLBACK_MARKER")
  const inTxRule = async (mutate: (tx: Prisma.TransactionClient) => Promise<void>) => {
    let message = "(no error)"
    try {
      await prisma.$transaction(async (tx) => {
        await mutate(tx)
        try {
          await act.lib().computeNextTenantRuleLotNo(tx as never, TENANT_ID, { itemCode: fx.rmA.code, lotNumberingType: "DEFAULT" })
        } catch (e) {
          message = e instanceof Error ? e.message : String(e)
        }
        throw rollback
      })
    } catch (e) {
      if (e !== rollback) throw e
    }
    return message
  }
  const msgInactive = await inTxRule(async (tx) => void (await tx.numberingRule.update({ where: { id: rule.id }, data: { isActive: false } })))
  check("L4", msgInactive === act.lib().LOT_RULE_NOT_CONFIGURED_MESSAGE, "비활성 규칙 → 명확한 안내(번호 미발행)", msgInactive)
  const msgMissing = await inTxRule(async (tx) => void (await tx.numberingRule.delete({ where: { id: rule.id } })))
  check("L4b", msgMissing === act.lib().LOT_RULE_NOT_CONFIGURED_MESSAGE, "규칙 없음 → 명확한 안내", msgMissing)
  const msgBroken = await inTxRule(async (tx) => void (await tx.numberingRule.update({ where: { id: rule.id }, data: { tokens: [{ id: "x", type: "FIXED", value: "A" }] } })))
  check("L4c", msgBroken === act.lib().LOT_RULE_INVALID_MESSAGE, "순번 토큰이 없는 깨진 규칙 → 안내 오류", msgBroken)
  const ruleAfter = await prisma.numberingRule.findUnique({ where: { id: rule.id } })
  check("L4d", ruleAfter?.isActive === true && JSON.stringify(ruleAfter.tokens) === JSON.stringify(rule.tokens), "사용자가 저장한 규칙은 테스트 후에도 변경되지 않음(롤백 확인)")

  // ── 테스트 발주(ZT6) ─────────────────────────────────────────────────────────
  const supplier = await prisma.businessPartner.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: "ZT5-SUP" } })
  const po = await prisma.purchaseOrder.create({
    data: {
      tenantId: TENANT_ID,
      siteId: fx.site.id,
      supplierId: supplier.id,
      orderNo: `ZT6-PO-${uniq()}`,
      orderDate: new Date(),
      expectedDate: new Date(Date.now() + 7 * 86400000),
      status: "ORDERED",
      items: { create: [{ itemId: fx.rmA.id, qty: 100000, unitPrice: 10 }, { itemId: fx.rmB.id, qty: 100000, unitPrice: 20 }] },
    },
    include: { items: true },
  })
  const poItemA = po.items.find((i) => i.itemId === fx.rmA.id)!
  const receive = (lot: { lotNo?: string; lotReservationId?: string }, requestId = `zt6-${uniq()}-${uniq()}`, qty = 10) =>
    act.receiving().createReceivingInspection({
      purchaseOrderItemId: poItemA.id,
      purchaseOrderId: po.id,
      warehouseId: fx.wRm.id,
      siteId: fx.site.id,
      receivedQty: qty,
      acceptedQty: qty,
      rejectedQty: 0,
      result: "PASS",
      requestId,
      ...lot,
    })

  // ── L5. 예약(미리보기 라벨) → 순차 번호 / 취소 재사용 / 출력 후 영구 제외 ────────
  const startA = await maxSeqIn(stemA)
  const r1 = await act.reservation().reserveReceivingLotNumber({ purchaseOrderId: po.id, purchaseOrderItemId: poItemA.id })
  const r2 = await act.reservation().reserveReceivingLotNumber({ purchaseOrderId: po.id, purchaseOrderItemId: poItemA.id })
  check("L5", r1.success && r2.success && r1.lotNo === no(stemA, startA + 1) && r2.lotNo === no(stemA, startA + 2), `예약 2회 → 순차 번호(${r1.success ? r1.lotNo : r1.message}, ${r2.success ? r2.lotNo : r2.message})`)
  if (!r1.success || !r2.success) throw new Error("예약 실패로 이후 테스트를 진행할 수 없습니다.")
  // 라벨 미출력 예약 취소 → 번호 재사용
  const rel = await act.reservation().releaseLotReservation({ reservationId: r2.reservationId })
  const r2b = await act.reservation().reserveReceivingLotNumber({ purchaseOrderId: po.id, purchaseOrderItemId: poItemA.id })
  check("L6", rel.success && r2b.success && r2b.lotNo === r2.lotNo, "라벨 미출력 예약 취소 → 같은 번호 재사용 가능")
  if (!r2b.success) throw new Error("재예약 실패")
  // 라벨 출력 후 취소 → 영구 제외
  const mark = await act.reservation().markLotReservationPrinted({ reservationId: r2b.reservationId, purchaseOrderItemId: poItemA.id })
  const rel2 = await act.reservation().releaseLotReservation({ reservationId: r2b.reservationId })
  const r3 = await act.reservation().reserveReceivingLotNumber({ purchaseOrderId: po.id, purchaseOrderItemId: poItemA.id })
  const keptRow = await prisma.lotNumberReservation.findFirst({ where: { tenantId: TENANT_ID, lotNo: r2b.lotNo } })
  check("L7", mark.success && rel2.success && keptRow?.status === "RELEASED" && r3.success && r3.lotNo === no(stemA, startA + 3), "라벨 출력 후 취소 → RELEASED 로 남아 번호 영구 제외, 다음 번호 발행", { r3, status: keptRow?.status })
  if (!r3.success) throw new Error("재예약 실패")

  // ── L8. 예약 확정(입고) → Lot 생성, 예약 CONSUMED ────────────────────────────
  const c1 = await receive({ lotReservationId: r1.reservationId, lotNo: r1.lotNo })
  const lot1 = await prisma.lot.findFirst({ where: { tenantId: TENANT_ID, lotNo: r1.lotNo } })
  const res1 = await prisma.lotNumberReservation.findUnique({ where: { id: r1.reservationId } })
  check("L8", c1.success && lot1?.itemId === fx.rmA.id && res1?.status === "CONSUMED" && c1.lotNo === r1.lotNo, `예약 확정 → 같은 번호로 Lot 생성(${r1.lotNo}), 예약 CONSUMED`, c1)

  // ── L9. 예약 없이 AUTO 입고 → 규칙으로 서버 발행, 멱등 재전송 ──────────────────
  const reqId = `zt6-auto-${uniq()}-${uniq()}`
  const a1 = await receive({}, reqId)
  const lotsAfterA1 = await prisma.lot.count({ where: { tenantId: TENANT_ID, lotNo: { startsWith: stemA } } })
  const a1again = await receive({}, reqId)
  const lotsAfterRetry = await prisma.lot.count({ where: { tenantId: TENANT_ID, lotNo: { startsWith: stemA } } })
  check("L9", a1.success && /^.+\d{4}-\d{3}$/.test(a1.lotNo ?? "") && a1.lotNo!.startsWith(stemA) && a1.lotNo! > r3.lotNo, `예약 없는 AUTO 입고 → 규칙 번호 발행(${a1.lotNo}), 예약된 번호와 겹치지 않음`, a1)
  check("L9b", a1again.success && lotsAfterA1 === lotsAfterRetry, "같은 requestId 재전송 → 새 LOT 없이 기존 결과(멱등)", a1again)

  // ── L10. 수동 LOT 입력은 그대로 ───────────────────────────────────────────────
  const manualNo = `ZT6-MAN-${uniq()}`
  const m1 = await receive({ lotNo: manualNo })
  const manualLot = await prisma.lot.findFirst({ where: { tenantId: TENANT_ID, lotNo: manualNo } })
  check("L10", m1.success && !!manualLot, "수동 LOT 입력 입고는 입력값 그대로 사용")

  // ── L11. 동시 발행 중복 방지 ──────────────────────────────────────────────────
  const before = await maxSeqIn(stemA)
  // 같은 발주품목의 입고는 기존 설계대로 행 잠금으로 직렬화되고(원격 DB 에서는 5초 트랜잭션 제한에 걸릴 수 있다 —
  // 수동 LOT 입고 6건 동시도 같은 이유로 일부가 시간 초과된다, 이번 변경과 무관), 그래서 요청마다 별도 발주품목으로 보낸다.
  const BURST = 4
  const burstPos = await Promise.all(
    Array.from({ length: BURST }, (_, i) =>
      prisma.purchaseOrder.create({
        data: { tenantId: TENANT_ID, siteId: fx.site.id, supplierId: supplier.id, orderNo: `ZT6-PO-${uniq()}-${i}`, orderDate: new Date(), expectedDate: new Date(), status: "ORDERED", items: { create: [{ itemId: fx.rmA.id, qty: 1000, unitPrice: 10 }] } },
        include: { items: true },
      }),
    ),
  )
  const lotsBeforeBurst = await prisma.lot.count({ where: { tenantId: TENANT_ID, lotNo: { startsWith: stemA } } })
  const burstReqs = burstPos.map((p) => ({
    purchaseOrderItemId: p.items[0].id, purchaseOrderId: p.id, warehouseId: fx.wRm.id, siteId: fx.site.id,
    receivedQty: 5, acceptedQty: 5, rejectedQty: 0, result: "PASS" as const, requestId: `zt6-${uniq()}-${uniq()}`,
  }))
  const burst = await Promise.all(burstReqs.map((r) => act.receiving().createReceivingInspection(r)))
  // 입고는 (tenant, 날짜) 거래번호 advisory lock 으로 직렬화되어 원격 DB 에서는 일부가 5초 트랜잭션 제한으로 UNKNOWN 이 될 수 있다(기존 설계, 수동 LOT 도 동일).
  // UNKNOWN 은 같은 requestId 로 재전송하면 서버가 중복 없이 처리한다 — 재전송까지 포함해 LOT 번호 중복/누락이 없는지 확인한다.
  const timedOut = burst.filter((r) => !r.success).length
  for (let i = 0; i < burst.length; i++) {
    if (!burst[i].success) burst[i] = await act.receiving().createReceivingInspection(burstReqs[i])
  }
  const burstLots = await prisma.lot.findMany({ where: { tenantId: TENANT_ID, lotNo: { startsWith: stemA } }, select: { lotNo: true } })
  const newBurstLots = burstLots.length - lotsBeforeBurst
  const burstNos = burst.map((r) => r.lotNo).filter(Boolean) as string[]
  check("L11", burst.every((r) => r.success) && newBurstLots === BURST && new Set(burstLots.map((l) => l.lotNo)).size === burstLots.length && new Set(burstNos).size === burstNos.length, `AUTO 입고 ${BURST}건 동시(서로 다른 발주품목, 시간 초과 ${timedOut}건은 같은 requestId 로 재전송) → 모두 성공, 새 LOT 정확히 ${BURST}개, 번호 중복 없음(${burstNos.sort().join(", ")})`, burst.filter((r) => !r.success))
  const afterBurst = await maxSeqIn(stemA)
  check("L11b", afterBurst >= before + BURST, `동시 발행 후 최대 순번 증가(${before} → ${afterBurst})`)
  const reserveBurst = await Promise.all(Array.from({ length: 5 }, () => act.reservation().reserveReceivingLotNumber({ purchaseOrderId: po.id, purchaseOrderItemId: poItemA.id })))
  const reserveNos = reserveBurst.flatMap((r) => (r.success ? [r.lotNo] : []))
  check("L11c", reserveNos.length === 5 && new Set(reserveNos).size === 5, `예약 5건 동시 → 모두 성공, 번호 중복 없음(${reserveNos.sort().join(", ")})`, reserveBurst.filter((r) => !r.success))
  for (const r of [...reserveBurst, r3]) if (r.success) await act.reservation().releaseLotReservation({ reservationId: r.reservationId })

  // ── L12. 기존 LOT 와 중복 방지(수동으로 미래 순번 선점) ───────────────────────
  const cur = await maxSeqIn(stemB)
  const squat = no(stemB, cur + 1)
  await prisma.lot.create({ data: { tenantId: TENANT_ID, itemId: fx.rmB.id, lotNo: squat, status: "ACTIVE", manufactureDate: new Date() } })
  const pAfter = await compute(fx.rmB.code, "RAW_MATERIAL")
  check("L12", pAfter === no(stemB, cur + 2), `이미 존재하는 LOT(${squat}) 다음 번호(${pAfter})를 발행 — 기존 LOT 와 중복 없음`)

  // ── L13. LOT 등록 화면(generateLotNumberForItem) ───────────────────────────────
  const g1 = await act.numbering().generateLotNumberForItem(TENANT_ID, fx.rmA.id, { ITEM_CODE: "HACKED-CODE" })
  const expectA = no(stemA, (await maxSeqIn(stemA)) + 1)
  check("L13", g1.success && g1.lotNo === expectA, `LOT 등록 화면 자동생성: 품목코드는 서버 품목값 사용(클라이언트 값 무시) → ${g1.success ? g1.lotNo : g1.message}`)
  const gBad = await act.numbering().generateLotNumberForItem(TENANT_ID, "no-such-item")
  check("L13b", !gBad.success, "존재하지 않는 품목 → 실패 결과(번호 미발행)", gBad)
  loginAs(fx.viewer)
  const gViewer = await act.numbering().generateLotNumberForItem(TENANT_ID, fx.rmA.id)
  check("L13c", !gViewer.success, "LOT 등록 권한 없는 사용자 → 거부", gViewer)
  logout()
  const gAnon = await act.numbering().generateLotNumberForItem(TENANT_ID, fx.rmA.id)
  check("L13d", !gAnon.success, "비로그인 → 거부", gAnon)
  loginAs(fx.admin)

  // ── L14. 완제품 LOT(제조번호 없음) → 규칙 발행 / 동시 발행 ─────────────────────
  const { createFinishedGoodsLot } = act.fg()
  const baseFg = await maxSeqIn(stemFg)
  const fgLot = await prisma.$transaction((tx) => createFinishedGoodsLot(tx, { tenantId: TENANT_ID, workOrder: { orderNo: `ZT6-WO-${uniq()}`, manufacturingNo: null, itemId: fx.fgA.id } }))
  check("L14", fgLot.lotNo === no(stemFg, baseFg + 1) && fgLot.itemId === fx.fgA.id, `완제품 LOT(제조번호 없음) → 규칙 번호 ${fgLot.lotNo}`)
  const fgBurst = await Promise.allSettled(
    Array.from({ length: 4 }, () => prisma.$transaction((tx) => createFinishedGoodsLot(tx, { tenantId: TENANT_ID, workOrder: { orderNo: `ZT6-WO-${uniq()}`, manufacturingNo: null, itemId: fx.fgA.id } }), { timeout: 20000 })),
  )
  const fgNos = fgBurst.flatMap((r) => (r.status === "fulfilled" ? [r.value.lotNo] : []))
  check("L14b", fgBurst.every((r) => r.status === "fulfilled") && new Set(fgNos).size === 4, `완제품 LOT 4건 동시 발행 → 중복 없음(${fgNos.sort().join(", ")})`, fgBurst.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.message))
  const fgMfg = await prisma.$transaction((tx) => createFinishedGoodsLot(tx, { tenantId: TENANT_ID, workOrder: { orderNo: `ZT6-WO-${uniq()}`, manufacturingNo: `ZT6-MFG-${uniq()}`, itemId: fx.fgA.id } }))
  check("L14c", fgMfg.lotNo.startsWith("ZT6-MFG-"), "제조번호가 있으면 기존대로 제조번호 기반 완제품 LOT(규칙 미적용)")

  // ── L15. 제조번호는 LOT 규칙을 쓰지 않는다 / CNS 규칙 미적용 ────────────────────
  let mfgMsg = "(no error)"
  try {
    await act.wo().generateManufacturingNo(TENANT_ID, fx.rmA.id)
  } catch (e) {
    mfgMsg = e instanceof Error ? e.message : String(e)
  }
  check("L15", mfgMsg.includes("대원정밀 LOT 채번 규칙이 설정되지 않았습니다"), "제조번호 자동 발행은 계속 차단(LOT 규칙을 제조번호에 적용하지 않음)", mfgMsg)
  const lotNos = (await prisma.lot.findMany({ where: { tenantId: TENANT_ID, createdAt: { gte: new Date(Date.now() - 3600_000) } }, select: { lotNo: true } })).map((l) => l.lotNo)
  check("L15b", lotNos.every((n) => !/^C\d{2}[A-L]\d{3}$/.test(n) && !/^\d{2}[A-L]\d{2}-\d+$/.test(n)), "이번 테스트로 만들어진 LOT 에 CNS 형식(C26K001, 26K28-1)이 없음")

  summary("09 LOT 규칙 자동 채번")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error("실패:", e instanceof Error ? e.stack?.split("\n").slice(0, 6).join("\n") : e)
  process.exitCode = 1
  await prisma.$disconnect()
})
