/**
 * MRP 회귀(AI 제거 후) 실제 DB 테스트: AI 서버 액션 부재/외부 AI 호출 0건 + 기존 MRP 기능 정상.
 * 실제 Supabase(대원정밀 테스트 환경) + 앱의 실제 서버 액션. 생성 데이터: 생산계획 ZT6-PP-*, 일반 발주 1건(ZT5-RM-A 품목).
 * 실행: DAEWON_DB_IT_CONFIRM=aquqetajewvhyirmewfy npx ts-node --compiler-options '{"module":"commonjs"}' --project tsconfig.json scripts/db-it/10-mrp-regression.ts
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { assertTarget, check, fixtures, loginAs, prisma, summary, TENANT_ID, uniq } from "./lib"

const root = join(__dirname, "..", "..")
const act = {
  mrp: () => require("../../src/lib/actions/mrp.actions") as typeof import("../../src/lib/actions/mrp.actions"),
  order: () => require("../../src/lib/actions/mrp-order.actions") as typeof import("../../src/lib/actions/mrp-order.actions"),
  sugg: () => require("../../src/lib/actions/mrp-purchase-suggestion.actions") as typeof import("../../src/lib/actions/mrp-purchase-suggestion.actions"),
  sim: () => require("../../src/lib/actions/mrp-simulation.actions") as typeof import("../../src/lib/actions/mrp-simulation.actions"),
  run: () => require("../../src/lib/actions/mrp-run.actions") as typeof import("../../src/lib/actions/mrp-run.actions"),
}

async function main() {
  assertTarget()
  const fx = await fixtures()
  loginAs(fx.admin)

  // 외부 AI 호출 감시(전역 fetch): MRP 전 과정에서 openai 호스트 호출은 0건이어야 한다.
  const aiCalls: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url
    if (/openai|anthropic/i.test(url)) aiCalls.push(url)
    return realFetch(input, init)
  }) as typeof fetch

  // ── AI 제거 ────────────────────────────────────────────────────────────────
  const mrpActions = act.mrp() as Record<string, unknown>
  check("M1", typeof mrpActions.getAISuggestion === "undefined" && !Object.keys(mrpActions).some((k) => /ai/i.test(k)), "MRP 서버 액션에 AI 함수가 없음(직접 호출 불가)", Object.keys(mrpActions))
  check("M2", !existsSync(join(root, "src/app/app/mes/mrp/ai-suggestion-panel.tsx")) && !existsSync(join(root, "src/lib/services/mrp-ai.service.ts")), "AI 발주 제안 패널·서비스 파일 삭제됨")
  const mrpFiles = [join(root, "src/app/app/mes/mrp"), join(root, "src/lib/services"), join(root, "src/lib/actions")]
    .flatMap((d) => readdirSync(d).filter((f) => /mrp/i.test(f) && /\.(ts|tsx)$/.test(f)).map((f) => join(d, f)))
  const aiRefs = mrpFiles.filter((f) => /openai|AISuggestion|getAISuggestion|suggestOptimalOrder|AI 발주|AI 분석|jsonCompletion/.test(readFileSync(f, "utf8")))
  check("M3", aiRefs.length === 0, `MRP 관련 ${mrpFiles.length}개 파일에 AI 참조 없음`, aiRefs)

  // ── 생산계획 기반 MRP ───────────────────────────────────────────────────────
  // 생산계획 MRP 는 기본(Default) BOM 만 전개한다. ZT5 테스트 BOM(ZT5-1)이 Default 가 아니면 테스트 데이터에 한해 Default 로 지정한다.
  if (!fx.bom.isDefault) await prisma.bOM.update({ where: { id: fx.bom.id }, data: { isDefault: true } })
  const plan = await prisma.productionPlan.create({
    data: {
      tenantId: TENANT_ID, siteId: fx.site.id, planNo: `ZT6-PP-${uniq()}`, planType: "MONTHLY", startDate: new Date(), endDate: new Date(Date.now() + 30 * 86400000), status: "CONFIRMED",
      items: { create: [{ itemId: fx.fgA.id, bomId: fx.bom.id, routingId: fx.routing.id, plannedQty: 10 }] },
    },
  })
  const plans = await act.mrp().getPlansForMRP()
  check("M4", plans.some((p) => p.id === plan.id), "계획 목록에 새 생산계획 표시")
  const result = await act.mrp().runMRP(plan.id)
  const rmA = result.items.find((i) => i.itemId === fx.rmA.id)
  const rmB = result.items.find((i) => i.itemId === fx.rmB.id)
  check("M5", !!rmA && !!rmB && rmA.grossRequirement === 20 && rmB.grossRequirement === 10, `BOM 전개: 완제품 10개 → RM-A ${rmA?.grossRequirement}, RM-B ${rmB?.grossRequirement} (BOM ZT5-1: 2:1)`, result.items.map((i) => [i.itemCode, i.grossRequirement]))
  // 기존 계산식(mrp-plan.service.ts, 이번 변경에서 수정 없음): 순소요 = 총소요 − 가용재고 − 발주잔량, 발주제안 = max(0, 순소요),
  // 상태: 순소요 ≤ 0 → SUFFICIENT / 순소요 < 총소요의 50% → SHORTAGE / 그 외 CRITICAL
  const expectStatus = (i: (typeof result.items)[number]) => (i.netRequirement <= 0 ? "SUFFICIENT" : i.netRequirement < i.grossRequirement * 0.5 ? "SHORTAGE" : "CRITICAL")
  check("M6", result.items.every((i) => Math.abs(i.netRequirement - (i.grossRequirement - i.availableStock - i.onOrder)) < 1e-6 && Math.abs(i.suggestedOrderQty - Math.max(0, i.netRequirement)) < 1e-6 && i.status === expectStatus(i)), "순소요량·발주제안수량·결품 상태가 기존 계산식과 일치(결품 예측)", result.items)

  // ── 수주기준 MRP · 발주제안 · 시뮬레이션 · 실행이력 ───────────────────────────
  const order = await act.order().runOrderBasedMrp({})
  const orderMat = order.view.materials.find((m) => m.componentItemId === fx.rmA.id)
  check("M7", order.view.mode === "NORMAL" && order.view.materials.length > 0, `수주기준 MRP 정상(자재 ${order.view.materials.length}건${orderMat ? ", ZT5-RM-A 포함" : ""})`)
  const sugg = await act.sugg().getPurchaseSuggestions({})
  check("M8", Array.isArray(sugg.rows) && typeof sugg.summary.finalShortageCount === "number", `일반(규칙 기반) 발주제안 조회 정상(제안 ${sugg.rows.length}행)`)
  const sim = await act.sim().runMrpSimulation({ items: [{ itemId: fx.fgA.id, qty: 10 }] })
  check("M9", !!sim.view, "품목 시뮬레이션 정상")
  const runs = await act.run().listOrderMrpRuns({ page: 1, pageSize: 5 })
  check("M10", !!runs && ("rows" in (runs as object) || "runs" in (runs as object) || "items" in (runs as object) || "success" in (runs as object)), "MRP 실행이력 조회 정상")

  // ── 발주서 생성(일반) ────────────────────────────────────────────────────────
  const before = await prisma.purchaseOrderItem.count({ where: { itemId: fx.rmA.id } })
  const po = await act.mrp().createPurchaseOrdersFromMRP([{ itemId: fx.rmA.id, qty: 7 }], undefined, fx.site.id)
  const after = await prisma.purchaseOrderItem.count({ where: { itemId: fx.rmA.id } })
  check("M11", po.success && after === before + 1 && !!po.orderNo, `발주서 생성 정상(${po.orderNo ?? po.error}, 품목 ZT5-RM-A 7)`, po)
  const created = po.orderNo ? await prisma.purchaseOrder.findFirst({ where: { tenantId: TENANT_ID, orderNo: po.orderNo }, include: { items: true } }) : null
  check("M12", created?.items.length === 1 && Number(created.items[0].qty) === 7 && created.items[0].itemId === fx.rmA.id, "생성된 발주서 내용 일치(품목·수량)")

  check("M13", aiCalls.length === 0, `MRP 전 과정에서 외부 AI(OpenAI 등) 호출 0건`, aiCalls)
  globalThis.fetch = realFetch
  summary("10 MRP 회귀")
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error("실패:", e instanceof Error ? e.stack?.split("\n").slice(0, 6).join("\n") : e)
  process.exitCode = 1
  await prisma.$disconnect()
})
