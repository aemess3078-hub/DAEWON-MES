/**
 * 5단계 5: 자재출고 동시성·잠금(실제 PostgreSQL).
 *  K-A 같은 LOT 동시 출고(재고 한도), K-B 여러 LOT 반대 순서 동시 출고(교착 없음), K-C LOT FOR SHARE 의미(상태 변경 대기·공유 잠금끼리 비충돌),
 *  K-D 출고 중 LOT 상태 변경 경합(불변식), K-E 격리 LOT 출고 거부·롤백.
 * 모든 대기에는 시간 제한을 둔다(withTimeout / lock_timeout).
 */
import { assertTarget, check, fixtures, info, loginAs, preflight, prisma, sleep, summary, TENANT_ID, uniq, withTimeout } from "./lib"

const mod = {
  rcv: () => require("../../src/lib/actions/receiving.actions") as typeof import("../../src/lib/actions/receiving.actions"),
  wo: () => require("../../src/lib/actions/work-order.actions") as typeof import("../../src/lib/actions/work-order.actions"),
  issue: () => require("../../src/lib/actions/material-issue.actions") as typeof import("../../src/lib/actions/material-issue.actions"),
  qc: () => require("../../src/lib/quantity-concurrency") as typeof import("../../src/lib/quantity-concurrency"),
}
type Fx = Awaited<ReturnType<typeof fixtures>>

async function receiveLot(fx: Fx, itemId: string, qty: number) {
  loginAs(fx.operator)
  const lotNo = `ZT5-L-${uniq()}`
  const poItem = fx.po.items.find((i) => i.itemId === itemId)!
  const r = await mod.rcv().createReceivingInspection({ purchaseOrderItemId: poItem.id, purchaseOrderId: fx.po.id, warehouseId: fx.wRm.id, siteId: fx.site.id, receivedQty: qty, acceptedQty: qty, rejectedQty: 0, result: "PASS", requestId: `zt5-r-${uniq()}-${uniq()}`, lotNo })
  if (!r.success) throw new Error(`입고 실패 ${JSON.stringify(r)}`)
  return prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotNo } })
}
async function newWo(fx: Fx, qty: number) {
  loginAs(fx.admin)
  const mfg = `ZT5-MFG-${uniq()}`
  const c = await mod.wo().createWorkOrder({ siteId: fx.site.id, itemId: fx.fgA.id, bomId: fx.bom.id, routingId: fx.routing.id, orderNo: `ZT5-WO-${uniq()}`, manufacturingNo: mfg, plannedQty: qty, status: "DRAFT", operations: fx.routing.operations.map((o, i) => ({ routingOperationId: o.id, seq: (i + 1) * 10, plannedQty: qty })) }, TENANT_ID)
  if (!(c as { success?: boolean }).success) throw new Error(`WO 생성 실패 ${JSON.stringify(c)}`)
  const wo = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, manufacturingNo: mfg } })
  const rel = await mod.wo().releaseWorkOrder(wo.id)
  if (!rel.success) throw new Error(rel.error)
  loginAs(fx.operator)
  return wo
}
const onHand = async (lotId: string) => {
  const b = await prisma.inventoryBalance.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotId } })
  return { onHand: Number(b.qtyOnHand), avail: Number(b.qtyAvailable) }
}
const issueTxCount = (lotId: string) => prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID, lotId, txType: "ISSUE" } })

async function main() {
  assertTarget()
  await preflight("자재출고 동시성 테스트(05)")
  const fx = await fixtures()
  // 기준 LOT: RM-B 는 충분히 크게(각 시나리오가 소비)
  const lotBig = await receiveLot(fx, fx.rmB.id, 2000)

  // ═══ K-A. 같은 LOT 동시 출고: LOT X 100, 작업지시 4건이 각 40(RM-A) 요청 → 최대 2건 성공 ═══
  const lotX = await receiveLot(fx, fx.rmA.id, 100)
  const wos = await Promise.all([0, 1, 2, 3].map(() => newWo(fx, 20)))
  loginAs(fx.operator)
  const bodyFor = (woId: string, a: Array<{ lotId: string; q: number }>, bQty: number) => ({
    workOrderId: woId,
    siteId: fx.site.id,
    items: [
      { itemId: fx.rmA.id, lots: a.map((x) => ({ lotId: x.lotId, warehouseId: fx.wRm.id, quantity: x.q })), issueQty: a.reduce((s, x) => s + x.q, 0), requiredQty: a.reduce((s, x) => s + x.q, 0), reservationId: null },
      { itemId: fx.rmB.id, lots: [{ lotId: lotBig.id, warehouseId: fx.wRm.id, quantity: bQty }], issueQty: bQty, requiredQty: bQty, reservationId: null },
    ],
  })
  const t0 = Date.now()
  const resA = await withTimeout("K-A 동시 출고", 90000, () => Promise.all(wos.map((w) => mod.issue().issueMaterialsForWorkOrder(bodyFor(w.id, [{ lotId: lotX.id, q: 40 }], 20), TENANT_ID))))
  const okA = resA.filter((r) => r.ok).length
  const balX = await onHand(lotX.id)
  info("KA-DETAIL", `${resA.map((r) => (r.ok ? "OK" : (r.error ?? "").slice(0, 28))).join(" | ")} · ${Date.now() - t0}ms`)
  check("KA1", okA === 2 && balX.onHand === 20 && balX.avail === 20, `같은 LOT(100)에 4건×40 동시 출고 → 성공 정확히 2건, 잔량 20(음수·초과 출고 없음)`, { okA, balX })
  check("KA2", (await issueTxCount(lotX.id)) === 2, "출고 수불(ISSUE)은 성공 건수와 같은 2건만 기록(실패 건은 롤백)")
  const failedWos = wos.filter((_, i) => !resA[i].ok)
  const failedWip = await prisma.wipUnit.count({ where: { workOrderId: { in: failedWos.map((w) => w.id) } } })
  check("KA3", failedWip === 0, "실패한 출고는 WIP 도 만들지 않음(부분 커밋 없음)", failedWip)

  // ═══ K-B. 여러 LOT 반대 순서 동시 출고(교착 확인) ═══════════════════════════════
  const lotP = await receiveLot(fx, fx.rmA.id, 200)
  const lotQ = await receiveLot(fx, fx.rmA.id, 200)
  let deadlocks = 0
  let allOk = true
  for (let round = 0; round < 3; round++) {
    const pair = await Promise.all([newWo(fx, 30), newWo(fx, 30)])
    loginAs(fx.operator)
    const res = await withTimeout(`K-B round ${round}`, 90000, () =>
      Promise.all([
        mod.issue().issueMaterialsForWorkOrder(bodyFor(pair[0].id, [{ lotId: lotP.id, q: 30 }, { lotId: lotQ.id, q: 30 }], 30), TENANT_ID),
        mod.issue().issueMaterialsForWorkOrder(bodyFor(pair[1].id, [{ lotId: lotQ.id, q: 30 }, { lotId: lotP.id, q: 30 }], 30), TENANT_ID),
      ]),
    )
    deadlocks += res.filter((r) => !r.ok && /deadlock|교착/i.test(r.error ?? "")).length
    allOk &&= res.every((r) => r.ok)
  }
  const bp = await onHand(lotP.id)
  const bq = await onHand(lotQ.id)
  check("KB1", allOk && deadlocks === 0 && bp.onHand === 200 - 180 && bq.onHand === 200 - 180, `LOT 순서가 반대인 출고 2건을 3라운드 동시 실행 → 모두 성공 · 교착 0건 · P/Q 각 200→20 (6건×30)`, { allOk, deadlocks, bp, bq })

  // ═══ K-C. LOT 행 FOR SHARE 의미(앱의 lockLotForShare 그대로) ══════════════════
  const lotS = await receiveLot(fx, fx.rmA.id, 50)
  const lockedAt: number[] = []
  const holder = prisma.$transaction(
    async (tx) => {
      await mod.qc().lockLotForShare(tx, TENANT_ID, lotS.id)
      lockedAt.push(Date.now())
      // 공유 잠금끼리는 충돌하지 않는다: 다른 연결에서 같은 LOT 를 FOR SHARE 잠가도 즉시 통과해야 한다
      const t = Date.now()
      await prisma.$transaction(async (tx2) => {
        await mod.qc().lockLotForShare(tx2, TENANT_ID, lotS.id)
      })
      lockedAt.push(Date.now() - t)
      // 잠금을 쥔 채 대기 — LOT 상태 변경(UPDATE)은 여기서 막혀야 한다
      await sleep(4500)
    },
    { maxWait: 10000, timeout: 20000 },
  )
  await sleep(1200)
  const upd0 = Date.now()
  const blockedUpdate = await withTimeout("LOT 상태 변경 대기", 30000, () =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', '1500ms', true)`
      await tx.lot.update({ where: { id: lotS.id }, data: { status: "ON_HOLD" } })
    }).then(() => "UPDATED", (e: Error) => (/lock timeout|canceling statement|55P03/i.test(e.message) ? "LOCK_TIMEOUT" : `ERR:${e.message.slice(0, 80)}`)),
  )
  check("KC1", lockedAt.length === 2 && lockedAt[1] < 2500, `FOR SHARE 끼리 비충돌 — 두 번째 공유 잠금이 ${lockedAt[1]}ms 만에 통과`, lockedAt)
  check("KC2", blockedUpdate === "LOCK_TIMEOUT" && Date.now() - upd0 < 6000, `공유 잠금 보유 중 LOT 상태 변경(UPDATE)은 막힘 → ${blockedUpdate} (lock_timeout 1.5초, 무한 대기 없음)`)
  await holder
  const lotSAfter = await prisma.lot.findFirstOrThrow({ where: { id: lotS.id } })
  check("KC3", lotSAfter.status === "ACTIVE", "실패한 상태 변경은 반영되지 않음 · 잠금 해제 후 정상", lotSAfter.status)

  // ═══ K-D. 출고와 LOT 상태 변경 경합(불변식) ═══════════════════════════════════
  // 격리 시점을 출고 시작 직후~트랜잭션 중간 사이에서 바꿔 가며(여러 라운드) 일관성 불변식을 확인한다.
  const outcomes: string[] = []
  let consistent = true
  let lastLot = lotS
  for (const offset of [0, 120, 250, 400, 600]) {
    const lotR = await receiveLot(fx, fx.rmA.id, 200)
    lastLot = lotR
    const wR = await Promise.all([newWo(fx, 10), newWo(fx, 10)])
    loginAs(fx.operator)
    const raceRes = await withTimeout("K-D 경합", 90000, () =>
      Promise.all([
        ...wR.map((w) => mod.issue().issueMaterialsForWorkOrder(bodyFor(w.id, [{ lotId: lotR.id, q: 20 }], 10), TENANT_ID)),
        sleep(offset).then(() => prisma.lot.update({ where: { id: lotR.id }, data: { status: "QUARANTINE" } }).then(() => ({ ok: true, error: "STATUS" }))),
      ]),
    )
    const issued = raceRes.slice(0, 2).filter((r) => r.ok).length
    const balR = await onHand(lotR.id)
    const txR = await issueTxCount(lotR.id)
    const wipCount = await prisma.wipUnit.count({ where: { workOrderId: { in: wR.map((w) => w.id) } } })
    consistent &&= balR.onHand === 200 - issued * 20 && txR === issued && wipCount === issued
    outcomes.push(`+${offset}ms→출고${issued}건`)
    await prisma.lot.update({ where: { id: lotR.id }, data: { status: "ACTIVE" } })
  }
  check("KD1", consistent, `출고와 LOT 격리를 5가지 시차(${outcomes.join(", ")})로 경합 → 매번 출고 성공 건수 = 재고 차감 = 수불 건수 = WIP 생성 건수(부분 커밋·이중 차감 없음)`)
  // 격리가 커밋된 뒤에는 어떤 출고도 통과하지 못한다
  await prisma.lot.update({ where: { id: lastLot.id }, data: { status: "QUARANTINE" } })
  const balR1 = await onHand(lastLot.id)
  const after = await mod.issue().issueMaterialsForWorkOrder(bodyFor((await newWo(fx, 10)).id, [{ lotId: lastLot.id, q: 20 }], 10), TENANT_ID)
  const balR2 = await onHand(lastLot.id)
  check("KD2", !after.ok && balR2.onHand === balR1.onHand, "격리 확정 후 출고는 거부 · 재고 불변(트랜잭션 롤백)", after)
  await prisma.lot.update({ where: { id: lastLot.id }, data: { status: "ACTIVE" } })
  summary("issue-concurrency")
}
if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-6).join(" | "))
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
