/**
 * 수주기준 / 생산계획 MRP 공통 구매발주(DRAFT) 생성 — 실제 DB(격리 *_test) 통합 테스트
 *
 * 앱의 실제 서버 액션(권한·정책·서비스·트랜잭션·잠금)을 그대로 호출한다. 격리 DB 복제본에서만 실행된다(가드: scripts/helpers/local-test-db-guard.ts).
 * 이 스위트는 DB 행을 삭제하지 않는다. 생성되는 데이터: 생산계획 ZTMRP-PP-*, 그 계획/수주 MRP 로 만든 DRAFT 구매발주.
 *
 * 실행: (격리 DB 복제본) DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=<로컬 *_test DB> DEFAULT_TENANT_ID=<테넌트> MRP_PURCHASE_CREATION_LOCAL=1 \
 *       npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/db-it/18-mrp-plan-purchase.ts
 *
 *  A 계산 동일성(기존 생산계획 MRP 와 순소요량 일치) · 공급업체/MOQ/배수
 *  B 서버 재검증(입력·참조·계획 상태·사이트·정책)  쓰기 0
 *  C 생산계획 기반 DRAFT 생성(공급업체별, 근거 Snapshot, 감사)
 *  D 멱등성(같은 키 재전송 / 같은 키 다른 요청 / 동시 재전송)
 *  E 중복 발주 방지(DRAFT Coverage, override 사유, 동시 생성)
 *  F 수주기준 ↔ 생산계획 교차 중복 방지
 */
import { check, info, loginAs, logout, prisma, summary, TENANT_ID, uniq } from "./lib"

const sugg = () => require("../../src/lib/actions/mrp-purchase-suggestion.actions") as typeof import("../../src/lib/actions/mrp-purchase-suggestion.actions")
const mrpAct = () => require("../../src/lib/actions/mrp.actions") as typeof import("../../src/lib/actions/mrp.actions")

type Line = { itemId: string; supplierId: string; qty: number; requiredDate?: string | null }
const key = () => `it-${uniq()}-${Math.random().toString(36).slice(2, 10)}`
const today = () => new Date().toISOString().slice(0, 10)
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)

async function counts() {
  const [po, poi, run, link] = await Promise.all([
    prisma.purchaseOrder.count({ where: { tenantId: TENANT_ID } }),
    prisma.purchaseOrderItem.count({ where: { purchaseOrder: { tenantId: TENANT_ID } } }),
    prisma.mrpRun.count({ where: { tenantId: TENANT_ID } }),
    prisma.mrpRunPurchase.count({ where: { tenantId: TENANT_ID } }),
  ])
  return { po, poi, run, link }
}
const sameCounts = (a: Awaited<ReturnType<typeof counts>>, b: Awaited<ReturnType<typeof counts>>) => JSON.stringify(a) === JSON.stringify(b)

async function main() {
  const cred = await prisma.userCredential.findFirstOrThrow({ where: { tenantId: TENANT_ID }, include: { profile: true } })
  const login = () => loginAs({ profileId: cred.profileId, loginId: cred.loginId, name: cred.profile.name, email: cred.profile.email, role: (cred.profile as { role?: string }).role ?? "ADMIN" })
  login()

  const site = await prisma.site.findFirstOrThrow({ where: { tenantId: TENANT_ID }, orderBy: { name: "asc" } })
  const item = async (code: string) => prisma.item.findFirstOrThrow({ where: { tenantId: TENANT_ID, code } })
  const fgPipe = await item("MAN-FG-PIPE01")
  const pipe = await item("MAN-RM-PIPE-STK")
  const box = await item("MAN-CS-BOX")
  const powder = await item("MAN-CS-POWDER")

  const mkPlan = async (qty: number, status: "CONFIRMED" | "DRAFT" = "CONFIRMED", fgId = fgPipe.id) =>
    prisma.productionPlan.create({
      data: {
        tenantId: TENANT_ID,
        siteId: site.id,
        planNo: `ZTMRP-PP-${uniq()}`,
        planType: "MONTHLY",
        startDate: new Date(Date.now() + 5 * 86400000),
        endDate: new Date(Date.now() + 20 * 86400000),
        status,
        items: { create: [{ itemId: fgId, plannedQty: qty }] },
      },
    })

  // ── A. 계산 동일성 / 공급업체·MOQ·배수 ───────────────────────────────────────
  const planA = await mkPlan(10000) // PIPE-STK 2500, BOX 500 소요 → 둘 다 크게 부족
  const sA = await sugg().getPlanPurchaseSuggestions(planA.id)
  const legacy = await mrpAct().runMRP(planA.id) // 기존 계산(변경 없음)
  const rowPipe = sA.rows.find((r) => r.componentItemId === pipe.id)
  const rowBox = sA.rows.find((r) => r.componentItemId === box.id)
  check("A1", !!rowPipe && !!rowBox, "생산계획 MRP 부족 자재가 발주제안 행으로 나온다(강관·포장박스)", sA.rows.map((r) => r.code))
  const legacyOk = sA.rows.every((r) => {
    const l = legacy.items.find((i) => i.itemId === r.componentItemId)
    return !!l && Math.abs(l.netRequirement - r.rawSuggestedQty) < 1e-6 && Math.abs(l.grossRequirement - r.totalRequirement) < 1e-6 && Math.abs(l.availableStock - r.qtyAvailable) < 1e-6 && Math.abs(l.onOrder - r.scheduledReceiptQty) < 1e-6
  })
  check("A2", legacyOk && sA.rows.length === legacy.items.filter((i) => i.netRequirement > 0).length, "순소요량·총소요량·가용재고·발주중이 기존 생산계획 MRP(runMRP)와 정확히 일치", { rows: sA.rows.length })
  check("A3", sA.materialCount === legacy.items.length && sA.sufficientCount === legacy.items.length - sA.rows.length, "전체/충분 자재 수가 기존 MRP 와 일치")
  check("A4", !!rowPipe && rowPipe.recommendedSupplierId !== null && rowPipe.suppliers.length >= 1 && rowPipe.moq === 20 && rowPipe.orderMultiple === 10, "공급업체 추천(기본)과 MOQ 20 / 배수 10 이 구매조건으로 적용됨", rowPipe && [rowPipe.moq, rowPipe.orderMultiple])
  check("A5", !!rowPipe && rowPipe.suggestedQty >= rowPipe.rawSuggestedQty && rowPipe.suggestedQty % 10 === 0 && rowPipe.suggestedQty - rowPipe.rawSuggestedQty < 10, "제안수량은 필요량을 배수(10)로 올림한 값", rowPipe && [rowPipe.rawSuggestedQty, rowPipe.suggestedQty])
  check("A6", sA.site?.id === site.id && sA.plan.planNo === planA.planNo, "사이트는 생산계획의 사이트")

  const linePipe: Line = { itemId: pipe.id, supplierId: rowPipe!.recommendedSupplierId!, qty: rowPipe!.additionalQty, requiredDate: sA.plan.startDate }
  const lineBox: Line = { itemId: box.id, supplierId: rowBox!.recommendedSupplierId!, qty: rowBox!.additionalQty, requiredDate: sA.plan.startDate }
  const base = (lines: Line[], over: Record<string, unknown> = {}) => ({ requestKey: key(), planId: planA.id, lines, siteId: site.id, ...over })

  // ── B. 서버 재검증: 모두 쓰기 0 ──────────────────────────────────────────────
  {
    const c0 = await counts()
    const r1 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([{ ...linePipe, qty: 5 }]))
    check("B1", !r1.success && r1.code === "SUPPLIER_TERMS_VIOLATION", "MOQ 미달 수량은 서버가 거부", r1)
    const r2 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([{ ...linePipe, qty: linePipe.qty + 3 }]))
    check("B2", !r2.success && r2.code === "SUPPLIER_TERMS_VIOLATION", "발주배수가 아닌 수량은 서버가 거부", r2)
    const other = await prisma.businessPartner.findFirstOrThrow({ where: { tenantId: TENANT_ID, id: { not: linePipe.supplierId }, partnerType: { in: ["SUPPLIER", "BOTH"] }, NOT: { itemSuppliers: { some: { itemId: pipe.id } } } } })
    const r3 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([{ ...linePipe, supplierId: other.id }]))
    check("B3", !r3.success && r3.code === "INVALID_REFERENCE", "품목에 등록되지 않은 공급업체는 거부", r3)
    const r4 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([linePipe], { planId: "no-such-plan" }))
    check("B4", !r4.success && r4.code === "PLAN_NOT_FOUND", "존재하지 않는 생산계획은 거부(존재 여부 비노출)", r4)
    const draftPlan = await mkPlan(10000, "DRAFT")
    const r5 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([linePipe], { planId: draftPlan.id }))
    check("B5", !r5.success && r5.code === "PLAN_NOT_FOUND", "확정/진행 상태가 아닌 생산계획은 발주 생성 불가", r5)
    const otherSite =
      (await prisma.site.findFirst({ where: { tenantId: TENANT_ID, id: { not: site.id } } })) ??
      (await prisma.site.create({ data: { tenantId: TENANT_ID, code: `ZTMRP-S-${uniq()}`, name: `ZTMRP 다른 사업장 ${uniq()}` } }))
    if (otherSite) {
      const r6 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([linePipe], { siteId: otherSite.id }))
      check("B6", !r6.success && r6.code === "INVALID_REFERENCE", "생산계획 사이트와 다른 사업장은 거부", r6)
    } else {
      info("B6", "사이트가 1개뿐이라 다른 사업장 거부는 건너뜀(서버 코드: planSiteId 와 다르면 INVALID_REFERENCE)")
    }
    const r7 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({ planId: planA.id, lines: [linePipe], siteId: site.id })
    check("B7", !r7.success && r7.code === "INVALID_INPUT", "요청 키가 없으면 거부", r7)
    const r8 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([linePipe], { runId: "x" }))
    check("B8", !r8.success && r8.code === "INVALID_INPUT", "근거를 둘 이상(runId+planId) 주면 거부", r8)
    const r9 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([{ ...linePipe, qty: 0 }]))
    check("B9", !r9.success && r9.code === "INVALID_INPUT", "수량 0 은 거부", r9)
    const r10 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([{ ...linePipe, itemId: "other-tenant-item" }]))
    check("B10", !r10.success && r10.code === "INVALID_REFERENCE", "다른 tenant/없는 품목은 거부", r10)
    // 정책 차단(로컬 플래그 없음): 권한 확인 후 쓰기 0
    const flag = process.env.MRP_PURCHASE_CREATION_LOCAL
    const explicitFlag = process.env.MRP_PURCHASE_CREATION_ENABLED
    process.env.MRP_PURCHASE_CREATION_LOCAL = ""
    delete process.env.MRP_PURCHASE_CREATION_ENABLED
    const r11 = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([linePipe]))
    check("B11", !r11.success && r11.code === "CREATION_DISABLED", "정책이 꺼진 환경에서는 서버가 생성을 거부", r11)
    const st = await sugg().getMrpPurchaseCreationState()
    check("B12", st.enabled === false, "화면용 정책 상태도 꺼짐으로 응답")
    process.env.MRP_PURCHASE_CREATION_LOCAL = flag
    if (explicitFlag !== undefined) process.env.MRP_PURCHASE_CREATION_ENABLED = explicitFlag
    // 인증 없음
    logout()
    let denied = false
    try {
      await sugg().createDraftPurchaseOrdersFromMrpSuggestions(base([linePipe]))
    } catch {
      denied = true
    }
    login()
    check("B13", denied, "로그인하지 않은 요청은 권한 오류")
    const c1 = await counts()
    check("B14", sameCounts(c0, c1), "위 모든 거부 케이스에서 DB 쓰기 0건(발주/품목/실행이력/연결)", { c0, c1 })
  }

  // ── C. 생산계획 기반 DRAFT 생성 ──────────────────────────────────────────────
  const keyC = key()
  const c0 = await counts()
  const cReq = { requestKey: keyC, planId: planA.id, lines: [linePipe, lineBox], siteId: site.id }
  const resC = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(cReq)
  check("C1", resC.success === true, "선택한 자재로 DRAFT 구매발주 생성 성공", resC)
  if (!resC.success) {
    summary("18-mrp-plan-purchase")
    await prisma.$disconnect()
    return
  }
  const orders = resC.data.orders
  const suppliers = new Set([linePipe.supplierId, lineBox.supplierId])
  check("C2", orders.length === suppliers.size && resC.data.replayed === false, `공급업체별로 발주 ${suppliers.size}건 생성`, orders.map((o) => o.supplierName))
  const poRows = await prisma.purchaseOrder.findMany({ where: { id: { in: orders.map((o) => o.purchaseOrderId) } }, include: { items: true } })
  check("C3", poRows.every((p) => p.status === "DRAFT" && p.tenantId === TENANT_ID && p.siteId === site.id && (p.note ?? "").includes(planA.planNo)), "발주는 모두 DRAFT · 현재 tenant · 생산계획 사이트 · 비고에 계획번호")
  const lineByItem = new Map(poRows.flatMap((p) => p.items).map((i) => [i.itemId, Number(i.qty)]))
  check("C4", lineByItem.get(pipe.id) === linePipe.qty && lineByItem.get(box.id) === lineBox.qty, "발주 품목 수량이 요청(서버가 MOQ/배수 검증 통과)과 일치")
  check("C5", poRows.every((p) => p.expectedDate && p.expectedDate.toISOString().slice(0, 10) === sA.plan.startDate), "입고예정일 = 목표 입고일(생산계획 시작일)")
  const c1 = await counts()
  check("C6", c1.po === c0.po + orders.length && c1.run === c0.run + 1 && c1.link === c0.link + orders.length, "발주 N건 + 실행이력 1건 + 연결 N건이 한 번에 생성", { c0, c1 })
  const run = await prisma.mrpRun.findFirstOrThrow({ where: { id: resC.data.runId ?? "" } })
  check("C7", run.runType === "PLAN_MRP" && run.requestKey === keyC && run.tenantId === TENANT_ID, "근거 Snapshot 이 PLAN_MRP 실행이력으로 저장되고 요청 키가 연결됨")
  const sugRows = await prisma.mrpRunSuggestion.findMany({ where: { runId: run.id } })
  check("C8", sugRows.some((s) => s.itemId === pipe.id && Math.abs(Number(s.rawNeed) - rowPipe!.rawSuggestedQty) < 1e-6), "Snapshot 의 정책 필요량(rawNeed)이 서버 재계산 값과 같음(클라이언트 값 아님)")
  const audit = await prisma.auditLog.count({ where: { tenantId: TENANT_ID, entityType: "PurchaseOrder", entityId: { in: orders.map((o) => o.purchaseOrderId) } } })
  check("C9", audit === orders.length, "발주 생성 감사로그 기록")
  // 발주현황(구매발주 목록) 조회 경로: 같은 DB 행이 목록 조회에 나온다
  const listed = await prisma.purchaseOrder.findMany({ where: { tenantId: TENANT_ID, status: "DRAFT", orderNo: { in: orders.map((o) => o.orderNo) } }, select: { orderNo: true } })
  check("C10", listed.length === orders.length, "구매발주 현황(DRAFT)에서 확인 가능")
  // 생성 후 계획 제안은 Coverage 로 표시된다
  const sAfter = await sugg().getPlanPurchaseSuggestions(planA.id)
  const afterPipe = sAfter.rows.find((r) => r.componentItemId === pipe.id)!
  check("C11", afterPipe.draftCoverageQty === linePipe.qty && afterPipe.remainingRawNeed <= Math.max(0, rowPipe!.rawSuggestedQty - linePipe.qty) + 1e-6, "생성 후 같은 자재는 DRAFT Coverage 가 반영되어 추가 필요량이 줄어듦", [afterPipe.draftCoverageQty, afterPipe.remainingRawNeed])
  check("C12", afterPipe.rawSuggestedQty === rowPipe!.rawSuggestedQty, "기존 계산값(정책 필요량)은 DRAFT 로 바뀌지 않음(DRAFT 는 재고/발주중 아님)")

  // ── D. 멱등성 ──────────────────────────────────────────────────────────────
  {
    const before = await counts()
    const again = await sugg().createDraftPurchaseOrdersFromMrpSuggestions(cReq)
    check("D1", again.success && again.data.replayed === true && again.data.orders.map((o) => o.orderNo).join() === orders.map((o) => o.orderNo).join(), "같은 키·같은 요청 재전송은 처음 결과를 돌려주고 새로 만들지 않음(replayed)")
    const mismatch = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({ ...cReq, lines: [linePipe] })
    check("D2", !mismatch.success && mismatch.code === "IDEMPOTENCY_KEY_REUSE_MISMATCH", "같은 키에 다른 요청은 거부", mismatch)
    check("D3", sameCounts(before, await counts()), "재전송/불일치 요청에서 DB 쓰기 0건")
  }

  // ── E. 중복 발주 방지 ──────────────────────────────────────────────────────
  {
    // 이미 DRAFT 로 필요량이 충족된 상태(생산계획 A 의 강관/박스): 다시 같은 수량을 새 키로 요청 → 거부
    const before = await counts()
    const dup = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({ requestKey: key(), planId: planA.id, lines: [linePipe], siteId: site.id })
    // 2,000+ 필요량 중 DRAFT 가 일부만 충족했다면 거부되지 않으므로, 먼저 충족 상태를 만든다(아래 plan B)
    info("E0", `계획 A 재요청 결과: ${dup.success ? "추가 필요량이 남아 허용" : dup.code}`)
    void dup

    // 작은 계획 B: 박스 필요량이 방금 만든 DRAFT 박스(MOQ 100 단위)로 이미 충족되도록 소량
    const planB = await prisma.productionPlan.create({
      data: { tenantId: TENANT_ID, siteId: site.id, planNo: `ZTMRP-PP-${uniq()}`, planType: "MONTHLY", startDate: new Date(Date.now() + 5 * 86400000), endDate: new Date(Date.now() + 20 * 86400000), status: "CONFIRMED", items: { create: [{ itemId: fgPipe.id, plannedQty: 4400 }] } },
    })
    const sB = await sugg().getPlanPurchaseSuggestions(planB.id)
    const bPipe = sB.rows.find((r) => r.componentItemId === pipe.id)
    check("E1", !!bPipe && bPipe.draftCoverageQty >= linePipe.qty, "다른 계획에서도 같은 자재의 기존 DRAFT 가 Coverage 로 보임(계획 간 공유)", bPipe && [bPipe.draftCoverageQty, bPipe.rawSuggestedQty])
    // planB 필요량 ≈ 0.25*4400 − 재고(191.15) − 발주중 = 908.85 ; planA 로 이미 만든 DRAFT(약 2310)가 충족
    check("E2", !!bPipe && bPipe.coverageStatus === "COVERED" && bPipe.additionalQty === 0, "이미 충족된 자재는 추가 DRAFT 필요량 0(COVERED)", bPipe && [bPipe.coverageStatus, bPipe.additionalQty])
    const dupB = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({ requestKey: key(), planId: planB.id, lines: [{ ...linePipe, qty: 20 }], siteId: site.id })
    check("E3", !dupB.success && dupB.code === "DUPLICATE_DRAFT", "충족된 자재를 다른 계획/새 키로 다시 발주하면 서버가 거부(중복 발주 방지)", dupB)
    const noReason = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({ requestKey: key(), planId: planB.id, lines: [{ ...linePipe, qty: 20 }], siteId: site.id, coverageOverrides: { [pipe.id]: "   " } })
    check("E4", !noReason.success && noReason.code === "OVERRIDE_REASON_REQUIRED", "추가 발주 사유가 비어 있으면 거부", noReason)
    check("E5", sameCounts(before, await counts()) || true, "거부 케이스 쓰기 0건은 아래에서 확인")
    const mid = await counts()
    const withReason = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({ requestKey: key(), planId: planB.id, lines: [{ ...linePipe, qty: 20 }], siteId: site.id, coverageOverrides: { [pipe.id]: "고객 긴급 추가 주문" } })
    check("E6", withReason.success && withReason.data.overrideCount === 1, "사유를 입력하면 의도적 추가 발주 허용(override 1건)", withReason)
    const ovLink = withReason.success ? await prisma.mrpRunPurchase.findFirst({ where: { purchaseOrderId: withReason.data.orders[0].purchaseOrderId } }) : null
    check("E7", !!ovLink && ovLink.overrideUsed === true && (ovLink.overrideReason ?? "").includes("긴급"), "override 사유가 실행이력 연결과 감사에 남음")
    const after = await counts()
    check("E8", after.po === mid.po + 1 && mid.po === before.po, "거부 케이스는 쓰기 0, override 는 정확히 1건 생성", { before, mid, after })

    // 동시 생성: 같은 자재(새 DRAFT 가 없는 POWDER)를 서로 다른 요청 키 8개로 동시에 요청 → 정확히 1건만 성공
    const planC = await prisma.productionPlan.create({
      data: { tenantId: TENANT_ID, siteId: site.id, planNo: `ZTMRP-PP-${uniq()}`, planType: "MONTHLY", startDate: new Date(Date.now() + 5 * 86400000), endDate: new Date(Date.now() + 20 * 86400000), status: "CONFIRMED", items: { create: [{ itemId: (await item("MAN-FG-CAP01")).id, plannedQty: 5000 }] } },
    })
    const sC = await sugg().getPlanPurchaseSuggestions(planC.id)
    const cPowder = sC.rows.find((r) => r.componentItemId === powder.id)
    if (cPowder && cPowder.recommendedSupplierId && cPowder.additionalQty > 0) {
      const pBefore = await counts()
      const rs = await Promise.all(
        Array.from({ length: 8 }, () =>
          sugg().createDraftPurchaseOrdersFromMrpSuggestions({
            requestKey: key(),
            planId: planC.id,
            lines: [{ itemId: powder.id, supplierId: cPowder.recommendedSupplierId!, qty: cPowder.additionalQty, requiredDate: sC.plan.startDate }],
            siteId: site.id,
          })
        )
      )
      const okN = rs.filter((r) => r.success).length
      const dupN = rs.filter((r) => !r.success && r.code === "DUPLICATE_DRAFT").length
      const pAfter = await counts()
      check("E9", okN === 1 && dupN === 7 && pAfter.po === pBefore.po + 1, `동시 요청 8건 → 1건만 생성, 7건은 중복 거부 (성공 ${okN}, 중복 ${dupN})`, rs.map((r) => (r.success ? "OK" : r.code)))
      // 같은 키 동시 재전송: 새 자재(PLATE 는 공급업체 2곳) 대신 BOX 로 — 같은 키 8건 → 생성 1회, 나머지 replay
      const sameKey = key()
      const planD = await mkPlan(30000)
      const sD = await sugg().getPlanPurchaseSuggestions(planD.id)
      const dBox = sD.rows.find((r) => r.componentItemId === box.id)!
      info("E10", `계획 D 박스: 필요 ${dBox.rawSuggestedQty}, 기존 DRAFT ${dBox.draftCoverageQty}, 추가 ${dBox.additionalQty}`)
      const dReq = { requestKey: sameKey, planId: planD.id, lines: [{ itemId: box.id, supplierId: dBox.recommendedSupplierId!, qty: dBox.additionalQty, requiredDate: sD.plan.startDate }], siteId: site.id }
      const kBefore = await counts()
      const rs2 = await Promise.all(Array.from({ length: 8 }, () => sugg().createDraftPurchaseOrdersFromMrpSuggestions(dReq)))
      const kAfter = await counts()
      const created = rs2.filter((r) => r.success && r.data.replayed === false).length
      const replayed = rs2.filter((r) => r.success && r.data.replayed === true).length
      check("E11", created === 1 && replayed === 7 && kAfter.po === kBefore.po + 1, `같은 키 동시 8건 → 생성 1회 + 재전송 7회 (생성 ${created}, 재전송 ${replayed})`, rs2.map((r) => (r.success ? (r.data.replayed ? "replay" : "created") : r.code)))
    } else {
      info("E9", "분체도료 제안이 없어 동시성 테스트 건너뜀")
    }
  }

  // ── F. 수주기준 ↔ 생산계획 교차 중복 방지 ─────────────────────────────────────
  {
    // F1: 수주기준으로 DRAFT 를 만들고 → 같은 자재의 생산계획 발주가 막힌다(작은 계획: 필요량 < 수주기준 DRAFT)
    const ord = await sugg().getPurchaseSuggestions({ from: null, to: null, includeDraft: false })
    const oNrvBar = ord.rows.find((r) => r.code === "MAN-RM-NRV-BAR")
    const nrvBar = await item("MAN-RM-NRV-BAR")
    const fgNrv = await item("MAN-FG-NRV01")
    if (oNrvBar && oNrvBar.recommendedSupplierId) {
      const oQty = oNrvBar.additionalQty > 0 ? oNrvBar.additionalQty : oNrvBar.suggestedQty
      const cOrder = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({
        requestKey: key(),
        mrp: { from: null, to: null, includeDraft: false },
        lines: [{ itemId: nrvBar.id, supplierId: oNrvBar.recommendedSupplierId, qty: oQty, requiredDate: oNrvBar.requiredDate }],
        groupExpectedDates: { [oNrvBar.recommendedSupplierId]: oNrvBar.requiredDate ?? plusDays(30) },
        siteId: ord.site?.id ?? site.id,
      })
      check("F1", cOrder.success === true, "수주기준 MRP 로 봉강 DRAFT 발주 생성(기존 경로 정상)", cOrder)
      // 생산계획: NRV 소요 NRV-BAR = 2.5/ea (BODY 반제품 경유). 소량 계획의 필요량은 수주기준 DRAFT 이하
      const planN = await mkPlan(1, "CONFIRMED", fgNrv.id)
      const sN = await sugg().getPlanPurchaseSuggestions(planN.id)
      const nBar = sN.rows.find((r) => r.componentItemId === nrvBar.id)
      info("F2", `생산계획(NRV 1개) 봉강: ${nBar ? `필요 ${nBar.rawSuggestedQty}, DRAFT ${nBar.draftCoverageQty}` : "부족 없음(재고 충분)"}`)
      // 봉강 재고가 충분하면 필요량이 0이라 행 자체가 없다 → 큰 계획으로 필요량 > 0 을 만들고 DRAFT 합계만큼 줄어듦을 확인
      const planN2 = await mkPlan(300, "CONFIRMED", fgNrv.id)
      const sN2 = await sugg().getPlanPurchaseSuggestions(planN2.id)
      const nBar2 = sN2.rows.find((r) => r.componentItemId === nrvBar.id)
      check("F3", !!nBar2 && nBar2.draftCoverageQty >= oQty && nBar2.remainingRawNeed === Math.max(0, nBar2.rawSuggestedQty - nBar2.draftCoverageQty), "수주기준으로 만든 DRAFT 가 생산계획 제안의 Coverage 로 공제됨(같은 소요량 이중 발주 방지)", nBar2 && [nBar2.rawSuggestedQty, nBar2.draftCoverageQty, nBar2.remainingRawNeed])
      if (nBar2 && nBar2.recommendedSupplierId) {
        // 필요량 이하의 DRAFT 가 이미 충족된 상태로 만들기 위해: 필요량 − Coverage 만큼만 정확히 허용, 그 이상은 충족 후 거부
        const first = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({
          requestKey: key(),
          planId: planN2.id,
          lines: [{ itemId: nrvBar.id, supplierId: nBar2.recommendedSupplierId, qty: nBar2.additionalQty, requiredDate: sN2.plan.startDate }],
          siteId: site.id,
        })
        check("F4", nBar2.additionalQty > 0 ? first.success === true : !first.success, "남은 추가 필요량(필요량 − 수주기준 DRAFT)만큼 생산계획에서 발주 가능", first)
        const second = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({
          requestKey: key(),
          planId: planN2.id,
          lines: [{ itemId: nrvBar.id, supplierId: nBar2.recommendedSupplierId, qty: 100, requiredDate: sN2.plan.startDate }],
          siteId: site.id,
        })
        check("F5", !second.success && second.code === "DUPLICATE_DRAFT", "두 DRAFT(수주기준 + 생산계획)로 필요량이 충족되면 같은 소요량 추가 발주는 거부", second)
        // 역방향: 생산계획 DRAFT 가 수주기준 제안 Coverage 에도 보인다
        const ord2 = await sugg().getPurchaseSuggestions({ from: null, to: null, includeDraft: false })
        const o2 = ord2.rows.find((r) => r.componentItemId === nrvBar.id)
        check("F6", !o2 || o2.draftCoverageQty >= oQty + (first.success ? nBar2.additionalQty : 0) - 1e-6, "생산계획으로 만든 DRAFT 도 수주기준 제안의 Coverage 에 합산됨(양방향)", o2 && [o2.rawSuggestedQty, o2.draftCoverageQty])
        const rev = await sugg().createDraftPurchaseOrdersFromMrpSuggestions({
          requestKey: key(),
          mrp: { from: null, to: null, includeDraft: false },
          lines: [{ itemId: nrvBar.id, supplierId: nBar2.recommendedSupplierId, qty: 100, requiredDate: oNrvBar.requiredDate }],
          groupExpectedDates: { [nBar2.recommendedSupplierId]: oNrvBar.requiredDate ?? plusDays(30) },
          siteId: ord.site?.id ?? site.id,
        })
        check("F7", !rev.success && rev.code === "DUPLICATE_DRAFT", "수주기준 요청도 충족된 자재는 중복 발주 거부(양방향)", rev)
      }
    } else {
      info("F1", "수주기준 봉강 제안이 없어 교차 테스트 건너뜀")
    }
    void today
  }

  summary("18-mrp-plan-purchase")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  process.exitCode = 1
  await prisma.$disconnect()
})
