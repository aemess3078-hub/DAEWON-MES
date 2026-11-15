/**
 * 재공품재고 현재 재공수량 로컬 DB 검증 — 읽기 전용(조회만, 데이터 변경 없음).
 * 대상: 로컬 daewon_mes_manual (127.0.0.1:5432) 만 허용. 실제 getWipInventoryRows 결과를 SQL 직접 계산과 대조.
 * 실행: npm run verify:wip-inventory-local
 */
import Module from "node:module"
import { join } from "node:path"

for (const k of ["DATABASE_URL", "DIRECT_URL"]) {
  const u = new URL(process.env[k] ?? "postgresql://x@invalid/x")
  if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.pathname !== "/daewon_mes_manual" || u.port !== "5432") {
    console.error(`[verify-wip] ${k} 가 로컬 daewon_mes_manual 이 아닙니다. 중단합니다.`)
    process.exit(2)
  }
}
const TENANT_ID = "tenant-daewon-manual"
const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const orig = M._resolveFilename
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  return orig.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
const jar = new Map<string, string>()
function inject(modulePath: string, exports: Record<string, unknown>) {
  const filename = require.resolve(modulePath)
  const mod = new Module(filename)
  mod.filename = filename
  mod.loaded = true
  mod.exports = exports
  require.cache[filename] = mod
}
inject("next/headers", {
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    getAll: () => [],
    has: (n: string) => jar.has(n),
  }),
  headers: async () => new Map<string, string>([["x-forwarded-for", "127.0.0.1"]]),
})
inject("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: <T>(fn: T) => fn })

/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma } = require("../src/lib/db/prisma") as typeof import("../src/lib/db/prisma")
const jwtLib = require("../src/lib/jwt") as typeof import("../src/lib/jwt")
const { getWipInventoryRows } = require("../src/lib/actions/work-order.actions") as typeof import("../src/lib/actions/work-order.actions")
const { summarizeWipInventory } = require("../src/lib/actions/wip-receipt.helpers") as typeof import("../src/lib/actions/wip-receipt.helpers")

let pass = 0
let failed = 0
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) pass++
  else failed++
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`)
}
const r6 = (v: number) => Math.round(v * 1e6) / 1e6

async function main() {
  const admin = await prisma.userCredential.findFirst({
    where: {
      tenantId: TENANT_ID,
      profile: { tenantUsers: { some: { tenantId: TENANT_ID, role: "OWNER", isActive: true } } },
      NOT: { loginId: "test" },
    },
    include: { profile: true },
  })
  if (!admin) throw new Error("로컬 OWNER 계정 없음")
  jar.set(
    jwtLib.NMES_SESSION_COOKIE,
    jwtLib.signAuthToken({
      profileId: admin.profileId,
      loginId: admin.loginId,
      email: admin.profile.email,
      name: admin.profile.name,
      tenantId: TENANT_ID,
      role: "OWNER",
      mustChangePw: false,
    })
  )

  const rows = await getWipInventoryRows(TENANT_ID)
  const current = rows.filter((r) => r.isCurrentWip)
  const summary = summarizeWipInventory(
    rows.map((r) => ({
      workOrderId: r.workOrder.id,
      category: r.wipCategory,
      wipQty: r.wipQty,
      availableReceiptQty: r.availableReceiptQty,
      blocked: r.receiptStatus === "ON_HOLD",
      isCurrent: r.isCurrentWip,
    }))
  )
  console.log(`전체 WipUnit 행 ${rows.length}, 현재 재공 행 ${current.length}`, summary)

  // SQL 직접 계산 (WipUnit·FinishedGoodsReceipt)
  type R = { wo: string; q: number; st: string; root: boolean; fin: boolean; rcv: number }
  const raw: R[] = await prisma.$queryRawUnsafe(`
    select u."workOrderId" wo, u.qty::float q, u.status::text st,
      (u."parentWipUnitId" is null and u."sourceProductionResultId" is null) root,
      (u."workOrderOperationId" = (select o.id from "WorkOrderOperation" o where o."workOrderId"=u."workOrderId" order by o.seq desc limit 1)) fin,
      (select coalesce(sum(r."receiptQty"),0)::float from "FinishedGoodsReceipt" r where r."workOrderId"=u."workOrderId") rcv
    from "WipUnit" u join "WorkOrder" w on w.id=u."workOrderId"
    where u."tenantId"='${TENANT_ID}' and w.status in ('RELEASED','IN_PROGRESS','COMPLETED')`)
  const byWo = new Map<string, R[]>()
  for (const r of raw) byWo.set(r.wo, [...(byWo.get(r.wo) ?? []), r])
  let expInProcess = 0
  let expAwait = 0
  let expRework = 0
  const expOrders = new Set<string>()
  for (const [wo, list] of Array.from(byWo)) {
    const rcv = list[0].rcv
    const finRootsQty = list.filter((x) => x.root && x.st === "COMPLETED" && x.fin).reduce((s, x) => s + x.q, 0)
    const pending = Math.max(0, finRootsQty - rcv)
    if (pending > 1e-6) {
      expAwait += pending
      expOrders.add(wo)
    }
    for (const x of list) {
      if (x.root && x.st === "COMPLETED" && x.fin) continue
      if (x.st === "SCRAPPED" || (x.st === "COMPLETED" && !x.root)) continue
      if (x.st === "REWORK") {
        expRework += x.q
        expOrders.add(wo)
        continue
      }
      expInProcess += x.q
      expOrders.add(wo)
    }
  }
  check(r6(summary.inProcessQty) === r6(expInProcess), "공정 진행 재공수량 = SQL 직접 계산", `${summary.inProcessQty} / ${r6(expInProcess)}`)
  check(r6(summary.awaitingReceiptQty) === r6(expAwait), "입고 대기(미입고 잔량) = SQL 직접 계산", `${summary.awaitingReceiptQty} / ${r6(expAwait)}`)
  check(r6(summary.reworkHoldQty) === r6(expRework), "재작업 보류 수량 = SQL 직접 계산", `${summary.reworkHoldQty} / ${r6(expRework)}`)
  check(summary.currentOrderCount === expOrders.size, "현재 재공 작업지시 수 = SQL 직접 계산", `${summary.currentOrderCount} / ${expOrders.size}`)

  // 입고 완료·폐기 완료 제외
  const receivedRoots = rows.filter((r) => r.wipCategory === "RECEIVED")
  check(receivedRoots.every((r) => !r.isCurrentWip && r.wipQty === 0), `입고 완료 ${receivedRoots.length}건 모두 현재 재공 제외`)
  const scrapped = rows.filter((r) => r.wipStatus === "SCRAPPED")
  check(scrapped.every((r) => !r.isCurrentWip && r.wipQty === 0), `폐기 완료 ${scrapped.length}건 모두 현재 재공 제외`)
  check(current.every((r) => r.wipQty > 0), "현재 재공 목록의 수량은 모두 0 초과")
  check(rows.filter((r) => r.wipStatus === "REWORK").every((r) => r.wipCategory === "REWORK_HOLD"), "재작업 보류는 별도 구분")

  // 작업지시별 입고 배분 합 ≤ 입고 누적 (중복 집계 방지)
  const recvByWo = new Map<string, number>()
  for (const r of rows) if (r.unitType === "ROOT") recvByWo.set(r.workOrder.id, (recvByWo.get(r.workOrder.id) ?? 0) + r.receivedQty)
  let dup = 0
  for (const [wo, sumRecv] of Array.from(recvByWo)) if (sumRecv > (byWo.get(wo)?.[0].rcv ?? 0) + 1e-6) dup++
  check(dup === 0, "작업지시별 입고 배분 합이 입고 누적을 넘지 않음(중복 집계 없음)")

  // 수량 정합성: 입고 누적 ≤ 최종공정 완료 root 재공
  type W = { ord: string; rootDone: number; rcv: number }
  const w: W[] = await prisma.$queryRawUnsafe(`
    select wo."orderNo" ord,
      (select coalesce(sum(u.qty),0)::float from "WipUnit" u where u."workOrderId"=wo.id and u."parentWipUnitId" is null and u."sourceProductionResultId" is null and u.status='COMPLETED') "rootDone",
      (select coalesce(sum(r."receiptQty"),0)::float from "FinishedGoodsReceipt" r where r."workOrderId"=wo.id) rcv
    from "WorkOrder" wo where wo."tenantId"='${TENANT_ID}' and exists (select 1 from "FinishedGoodsReceipt" r where r."workOrderId"=wo.id)`)
  const over = w.filter((x) => x.rcv > x.rootDone + 1e-6)
  check(over.length === 0, `입고 누적 ≤ 최종공정 완료 재공 (입고 있는 작업지시 ${w.length}건)`, over.map((x) => x.ord).join(","))

  // 입고 LOT 의 재고(InventoryBalance) 잔량이 입고수량을 넘지 않고 음수가 아님
  const lot: { ord: string; rcv: number; onhand: number }[] = await prisma.$queryRawUnsafe(`
    select wo."orderNo" ord, sum(r."receiptQty")::float rcv,
      coalesce((select sum(b."qtyOnHand") from "InventoryBalance" b where b."lotId" in (select r2."lotId" from "FinishedGoodsReceipt" r2 where r2."workOrderId"=wo.id and r2."lotId" is not null)),0)::float onhand
    from "FinishedGoodsReceipt" r join "WorkOrder" wo on wo.id=r."workOrderId"
    where r."tenantId"='${TENANT_ID}' group by wo.id, wo."orderNo"`)
  const bad = lot.filter((x) => x.onhand > x.rcv + 1e-6 || x.onhand < -1e-6)
  check(bad.length === 0, `입고 LOT 재고(InventoryBalance) 잔량이 입고수량 범위 내 (${lot.length}개 작업지시)`, bad.map((x) => `${x.ord}:${x.onhand}/${x.rcv}`).join(","))

  console.log(`\n${pass} 통과 / ${failed} 실패`)
  if (failed) process.exitCode = 1
}
main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
