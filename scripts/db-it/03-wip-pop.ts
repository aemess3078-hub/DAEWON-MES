/**
 * 5단계 3: WIP 라벨 발행(이력·동시 발행·lock_timeout) · WIP-작업지시 연결 · 관리자/현장 POP WIP QR 조회(실제 POP PIN 세션) ·
 * QR 스캔만으로는 작업이 시작되지 않음 · 공정 시작 → 생산실적 → 공정 완료 → WIP 이동 이력.
 * 실제 Supabase DB + 앱의 실제 서버 액션. 02-raw-material.ts 가 만든 WIP(자재출고 완료 작업지시)를 사용한다.
 */
import { assertTarget, check, fixtures, info, loginAs, logout, prisma, sleep, summary, cookieJar, TENANT_ID, testPopPin, uniq, withTimeout } from "./lib"

const mod = {
  label: () => require("../../src/lib/actions/wip-label.actions") as typeof import("../../src/lib/actions/wip-label.actions"),
  pop: () => require("../../src/lib/actions/pop.actions") as typeof import("../../src/lib/actions/pop.actions"),
  popLookup: () => require("../../src/lib/actions/pop-wip-lookup.actions") as typeof import("../../src/lib/actions/pop-wip-lookup.actions"),
  rcv: () => require("../../src/lib/actions/receiving.actions") as typeof import("../../src/lib/actions/receiving.actions"),
  wo: () => require("../../src/lib/actions/work-order.actions") as typeof import("../../src/lib/actions/work-order.actions"),
  issue: () => require("../../src/lib/actions/material-issue.actions") as typeof import("../../src/lib/actions/material-issue.actions"),
  pin: () => require("../../src/lib/auth/pop-pin") as typeof import("../../src/lib/auth/pop-pin"),
}

type Fx = Awaited<ReturnType<typeof fixtures>>

/** 자재출고까지 끝난 새 작업지시(WIP WAITING)를 정상 업무 액션으로 만든다. 입고 LOT 도 새로 받는다. */
export async function workOrderWithWip(fx: Fx, qty: number) {
  loginAs(fx.operator)
  const lotA = `ZT5-L-${uniq()}`
  const lotB = `ZT5-L-${uniq()}`
  for (const [item, lotNo, n] of [[fx.rmA.id, lotA, qty * 2], [fx.rmB.id, lotB, qty]] as const) {
    const poItem = fx.po.items.find((i) => i.itemId === item)!
    const r = await mod.rcv().createReceivingInspection({ purchaseOrderItemId: poItem.id, purchaseOrderId: fx.po.id, warehouseId: fx.wRm.id, siteId: fx.site.id, receivedQty: n, acceptedQty: n, rejectedQty: 0, result: "PASS", requestId: `zt5-r-${uniq()}-${uniq()}`, lotNo })
    if (!r.success) throw new Error(`입고 실패 ${JSON.stringify(r)}`)
  }
  loginAs(fx.admin)
  const mfg = `ZT5-MFG-${uniq()}`
  const created = await mod.wo().createWorkOrder(
    { siteId: fx.site.id, itemId: fx.fgA.id, bomId: fx.bom.id, routingId: fx.routing.id, orderNo: `ZT5-WO-${uniq()}`, manufacturingNo: mfg, plannedQty: qty, status: "DRAFT", operations: fx.routing.operations.map((o, i) => ({ routingOperationId: o.id, seq: (i + 1) * 10, plannedQty: qty })) },
    TENANT_ID,
  )
  if (!(created as { success?: boolean }).success) throw new Error(`WO 생성 실패 ${JSON.stringify(created)}`)
  const wo = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, manufacturingNo: mfg } })
  const rel = await mod.wo().releaseWorkOrder(wo.id)
  if (!rel.success) throw new Error(`릴리즈 실패 ${rel.error}`)
  loginAs(fx.operator)
  const la = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotNo: lotA } })
  const lb = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, lotNo: lotB } })
  const issued = await mod.issue().issueMaterialsForWorkOrder(
    { workOrderId: wo.id, siteId: fx.site.id, items: [{ itemId: fx.rmA.id, lots: [{ lotId: la.id, warehouseId: fx.wRm.id, quantity: qty * 2 }], issueQty: qty * 2, requiredQty: qty * 2, reservationId: null }, { itemId: fx.rmB.id, lots: [{ lotId: lb.id, warehouseId: fx.wRm.id, quantity: qty }], issueQty: qty, requiredQty: qty, reservationId: null }] },
    TENANT_ID,
  )
  if (!issued.ok) throw new Error(`출고 실패 ${issued.error}`)
  const wip = await prisma.wipUnit.findFirstOrThrow({ where: { workOrderId: wo.id, parentWipUnitId: null } })
  return { wo, wip, lotIds: [la.id, lb.id] }
}

async function auditCount(wipId: string) {
  return prisma.auditLog.count({ where: { tenantId: TENANT_ID, entityType: "WipLabel", entityId: wipId } })
}

async function main() {
  assertTarget()
  const fx = await fixtures()

  // ═══ A. WIP 라벨 발행 요청·이력 ═══════════════════════════════════════════
  const t1 = await workOrderWithWip(fx, 10)
  info("W0", `작업지시 ${t1.wo.orderNo} · WIP ${t1.wip.id} (${t1.wip.status})`)
  loginAs(fx.operator)
  const target = await mod.label().getWipLabelTarget({ workOrderId: t1.wo.id })
  check("W1", target.ok && target.target.wipUnitId === t1.wip.id, "WIP 라벨 대상 조회: 작업지시의 원 WIP 하나(작업지시-WIP 연결)", target)
  const chk = await mod.label().checkWipLabelPrintable({ wipUnitIds: [t1.wip.id] })
  check("W2", chk.ok && chk.reissueWipIds.length === 0, "발행 전 확인: 자재출고 완료로 발행 가능, 최초 발행", chk)
  const a0 = await auditCount(t1.wip.id)
  const first = await mod.label().recordWipLabelPrint({ wipUnitIds: [t1.wip.id], context: "zt5" })
  check("W3", first.ok && first.results[0].event === "WIP_LABEL_ISSUE" && first.results[0].issueCount === 1 && first.results[0].qrPayload === `DAEWON|WIP|1|${t1.wip.id}`, "최초 인쇄 요청 이력 WIP_LABEL_ISSUE(1) · QR = DAEWON|WIP|1|<WipUnit.id>", first)
  const noReason = await mod.label().recordWipLabelPrint({ wipUnitIds: [t1.wip.id] })
  check("W4", !noReason.ok && noReason.code === "REASON_REQUIRED" && (await auditCount(t1.wip.id)) === a0 + 1, "재요청은 사유 필수 — 사유 없으면 이력 추가 없음", noReason)
  const re = await mod.label().recordWipLabelPrint({ wipUnitIds: [t1.wip.id], reason: "라벨 훼손" })
  check("W5", re.ok && re.results[0].event === "WIP_LABEL_REISSUE" && re.results[0].issueCount === 2 && re.results[0].qrPayload === `DAEWON|WIP|1|${t1.wip.id}`, "재요청 이력 WIP_LABEL_REISSUE(2) · QR payload 불변", re)

  // ═══ B. 동시 발행(같은 WIP) ═══════════════════════════════════════════════
  const t2 = await workOrderWithWip(fx, 10)
  loginAs(fx.operator)
  const N = 6
  const concNoReason = await withTimeout("동시발행(사유없음)", 60000, () => Promise.all(Array.from({ length: N }, () => mod.label().recordWipLabelPrint({ wipUnitIds: [t2.wip.id] }))))
  const okCount = concNoReason.filter((r) => r.ok).length
  check("W6", okCount === 1 && (await auditCount(t2.wip.id)) === 1 && concNoReason.filter((r) => !r.ok && r.code === "REASON_REQUIRED").length === N - 1, `같은 WIP 동시 최초 발행 ${N}건 → 성공 정확히 1건(ISSUE), 나머지는 재요청 사유 필요 · 이력 1건`, concNoReason.map((r) => (r.ok ? "OK" : r.code)))
  const concReason = await withTimeout("동시발행(사유있음)", 60000, () => Promise.all(Array.from({ length: N }, () => mod.label().recordWipLabelPrint({ wipUnitIds: [t2.wip.id], reason: "동시 재요청" }))))
  const counts = concReason.flatMap((r) => (r.ok ? [r.results[0].issueCount] : [])).sort((x, y) => x - y)
  check("W7", counts.join() === "2,3,4,5,6,7" && (await auditCount(t2.wip.id)) === 7, `동시 재요청 ${N}건 → 발행 횟수 2~7 중복·결번 없이 순차 기록 · 이력 총 7건`, { counts, results: concReason.map((r) => (r.ok ? r.results[0].issueCount : r.code)) })

  // ═══ C. lock_timeout: 다른 트랜잭션이 WipUnit 행을 오래 잡고 있을 때 ═════════
  const t3 = await workOrderWithWip(fx, 10)
  loginAs(fx.operator)
  const holdMs = 9000
  const holder = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "WipUnit" WHERE id = ${t3.wip.id} FOR UPDATE`
      await sleep(holdMs)
    },
    { maxWait: 10000, timeout: 20000 },
  )
  await sleep(1500) // 잠금 확보 대기
  const started = Date.now()
  const blocked = await withTimeout("lock_timeout 대기", 30000, () => mod.label().recordWipLabelPrint({ wipUnitIds: [t3.wip.id] }))
  const waited = Date.now() - started
  check("W8", !blocked.ok && blocked.code === "FAILED" && waited >= 4000 && waited < 8500, `잠금 대기 초과 → ${Math.round(waited / 100) / 10}초 만에 FAILED(lock_timeout 5초) · 무한 대기 없음`, { blocked, waited })
  check("W9", (await auditCount(t3.wip.id)) === 0, "lock_timeout 실패 시 이력이 남지 않음(롤백)")
  await holder
  const afterRelease = await mod.label().recordWipLabelPrint({ wipUnitIds: [t3.wip.id] })
  check("W10", afterRelease.ok && (await auditCount(t3.wip.id)) === 1, "잠금 해제 후 정상 발행(교착·잔여 잠금 없음)", afterRelease)

  // ═══ D. POP: 실제 POP PIN 세션 + WIP QR 조회(읽기 전용) ═══════════════════
  const pin = testPopPin()
  const prepared = await mod.pin().preparePopPinForStorage(TENANT_ID, pin)
  const cred = await prisma.userCredential.findFirstOrThrow({ where: { tenantId: TENANT_ID, loginId: "zt5-operator" } })
  try {
    await prisma.userCredential.update({ where: { id: cred.id }, data: { popPinHash: prepared.popPinHash, popPinFingerprint: prepared.popPinFingerprint, popPinSetAt: new Date() } })
  } catch (e) {
    throw new Error(`POP PIN 지문이 다른 계정과 겹칠 수 있습니다: ${String((e as Error).message).split("\n").slice(-1)}`)
  }
  logout()
  const noSession = await mod.popLookup().lookupWipForPop({ wipUnitId: t1.wip.id })
  check("P1", !noSession.ok && noSession.code === "UNAUTHORIZED", "세션 없이 WIP QR 조회 거부(UNAUTHORIZED)", noSession)
  const worker = await mod.pop().popLogin(pin, TENANT_ID)
  check("P2", !!worker && worker.userId === cred.profileId && cookieJar().has("nmes-pop-worker-session"), "실제 POP PIN 로그인 → 작업자 세션(쿠키) 발급", worker)

  const snapshot = async (woId: string) =>
    JSON.stringify({
      wip: (await prisma.wipUnit.findMany({ where: { workOrderId: woId }, orderBy: { id: "asc" }, select: { id: true, status: true, qty: true, workOrderOperationId: true } })),
      ops: (await prisma.workOrderOperation.findMany({ where: { workOrderId: woId }, orderBy: { seq: "asc" }, select: { id: true, status: true, completedQty: true, startedAt: true } })),
      results: await prisma.productionResult.count({ where: { workOrderOperation: { workOrderId: woId } } }),
      moves: await prisma.wipMovement.count({ where: { wipUnit: { workOrderId: woId } } }),
      audit: await prisma.auditLog.count({ where: { tenantId: TENANT_ID } }),
    })
  const s0 = await snapshot(t1.wo.id)
  const popFind = await mod.popLookup().lookupWipForPop({ wipUnitId: t1.wip.id })
  check("P3", popFind.ok && popFind.workOrderId === t1.wo.id && popFind.wipStatus === "WAITING", "현장 POP(작업자 PIN 세션) WIP QR 조회 → 작업지시 확인", popFind)
  const none = await mod.popLookup().lookupWipForPop({ wipUnitId: "zt5-no-such-wip" })
  check("P4", !none.ok && none.code === "WIP_NOT_FOUND", "없는 WIP 거부", none)
  const queue = await mod.pop().getPopWorkQueueRows(TENANT_ID)
  check("P5", Array.isArray(queue) && queue.some((q) => q.workOrderId === t1.wo.id || (q as { orderNo?: string }).orderNo === t1.wo.orderNo), `현장 POP 작업대기 목록에 해당 작업지시 표시(${queue.length}건) — QR 결과가 화면 목록에 있는 작업지시임`)
  cookieJar().delete("nmes-pop-worker-session")
  loginAs(fx.operator)
  const adminFind = await mod.popLookup().lookupWipForPop({ wipUnitId: t1.wip.id })
  check("P6", adminFind.ok && JSON.stringify(adminFind) === JSON.stringify(popFind), "관리자 POP(웹 로그인 OPERATOR) 조회 결과가 현장 POP 와 동일", adminFind)
  check("P7", (await snapshot(t1.wo.id)) === s0, "[QR 스캔만으로 작업 시작/실적 등록 없음] 조회 3회 후 WIP·공정·실적·이동·감사 로그 변화 없음")
  loginAs(fx.viewer)
  const viewerFind = await mod.popLookup().lookupWipForPop({ wipUnitId: t1.wip.id })
  info("P8", `VIEWER 역할의 조회 결과: ${viewerFind.ok ? "허용" : viewerFind.code}`)
  loginAs(fx.operator)

  // ═══ E. 공정 시작 → 실적 → 완료 → WIP 이동 이력 (POP 작업자 세션) ═══════════
  logout()
  const w2 = await mod.pop().popLogin(pin, TENANT_ID)
  check("E0", !!w2, "POP 재로그인")
  const ops = await prisma.workOrderOperation.findMany({ where: { workOrderId: t1.wo.id }, orderBy: { seq: "asc" } })
  const st1 = await mod.pop().startOperation(ops[0].id)
  check("E1", st1.success, "공정10 작업 시작", st1)
  const op1a = await prisma.workOrderOperation.findFirstOrThrow({ where: { id: ops[0].id } })
  check("E2", op1a.status === "IN_PROGRESS", `공정10 상태 ${op1a.status}`)
  const r1 = await mod.pop().submitProductionResult({ workOrderOperationId: ops[0].id, goodQty: 10, defectQty: 0, reworkQty: 0 })
  check("E3", r1.success && r1.isCompleted === true, "공정10 생산실적 10 등록 → 공정 완료", r1)
  const st2 = await mod.pop().startOperation(ops[1].id)
  const r2 = await mod.pop().submitProductionResult({ workOrderOperationId: ops[1].id, goodQty: 10, defectQty: 0, reworkQty: 0 })
  check("E4", st2.success && r2.success && r2.isCompleted === true, "공정20 시작·실적 10 → 공정 완료", { st2, r2 })
  const woAfter = await prisma.workOrder.findFirstOrThrow({ where: { id: t1.wo.id } })
  const wipAfter = await prisma.wipUnit.findMany({ where: { workOrderId: t1.wo.id } })
  const moves = await prisma.wipMovement.findMany({ where: { wipUnit: { workOrderId: t1.wo.id } }, orderBy: { createdAt: "asc" } })
  info("E5-DETAIL", `WO ${woAfter.status} · WIP ${wipAfter.map((w) => w.status).join(",")} · 이동 ${moves.map((m) => m.movementType).join(">")}`)
  check("E5", woAfter.status === "COMPLETED" && moves[0]?.movementType === "CREATED" && moves.length >= 3, "작업지시 COMPLETED · WIP 이동 이력 CREATED → … 기록")
  console.log("IDS " + JSON.stringify({ doneWo: t1.wo.id, doneWip: t1.wip.id, pin: "(테스트 PIN 설정됨)" }))
  cookieJar().clear()
  summary("wip-pop")
}
if (require.main === module) {
  main()
    .catch((e) => {
      console.error("실패:", String((e as Error).message).split("\n").slice(-6).join(" | "))
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
