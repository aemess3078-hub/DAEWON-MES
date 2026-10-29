"use server"

/**
 * LOT 라벨 출력 게이트 · 감사 (Phase 11 `recordLotLabelPrint` 를 현재 main 의 인증 구조에 맞게 이식).
 *
 *  - 입고/재고/LOT 업무 로직은 건드리지 않는다. 읽기 + AuditLog 기록만 한다.
 *  - Lot 행이 DB 에 영속화된 번호만 출력할 수 있다(입고 실패/취소 후 존재하지 않는 LOT QR 이 현장에 남는 것을 방지).
 *  - 최초/재출력 판정은 서버의 이전 AuditLog 이력으로 한다(클라이언트 값 불신). 재출력은 사유가 필요하다.
 *  - 감사 기록은 기존 AuditLog 를 쓴다(새 테이블/스키마 변경 없음).
 *    entityType="LotLabel", action="CREATE", afterData.event = "LABEL_PRINT" | "LABEL_REPRINT" (Phase 11 과 동일).
 *  - purpose="ISSUE"(자재출고 LOT 라벨): 이미 입고 라벨이 출력된 LOT 의 "출고 수량 라벨"이므로 재출력 사유를 요구하지 않고
 *    event = "LABEL_ISSUE_PRINT" 로 기록한다(입고 라벨의 최초/재출력 판정에는 섞이지 않는다).
 *  - 브라우저는 실제 용지 출력 성공 여부를 알 수 없다. 이 기록은 "출력 요청(라벨 인쇄 페이지 열기)" 시점이다.
 */

import { prisma } from "@/lib/db/prisma"
import { recordAuditLog } from "@/lib/audit-log"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { encodeLotQr } from "@/lib/qr/lot-qr"
import { isValidTestLotNo } from "@/lib/label/label-spec"
import type { CurrentUser } from "@/lib/auth"

const MAX_LABEL_LOTS = 50
const READ_RESOURCES = ["LOT", "PURCHASE_ORDER", "WORK_ORDER", "INVENTORY"] as const

/** RECEIPT: 입고/생산 LOT 라벨(최초/재출력 판정). ISSUE: 자재출고 LOT 별 수량 라벨(재출력 사유 불필요). */
export type LotLabelPurpose = "RECEIPT" | "ISSUE"

export type LotLabelCheckResult =
  | {
      ok: true
      /** 이전에 출력 이력이 있는 LOT — 재출력 사유가 필요하다. */
      reprintLotNos: string[]
    }
  | {
      ok: false
      code: "UNAUTHORIZED" | "DENIED" | "INVALID" | "LOT_NOT_PERSISTED"
      message: string
      missingLotNos?: string[]
    }

export type LotLabelRecordResult =
  | {
      ok: true
      results: Array<{ lotNo: string; event: LabelEvent; printCount: number; qrPayload: string }>
    }
  | {
      ok: false
      code: "UNAUTHORIZED" | "DENIED" | "INVALID" | "LOT_NOT_PERSISTED" | "REASON_REQUIRED"
      message: string
      missingLotNos?: string[]
      reprintLotNos?: string[]
    }

type LabelEvent = "LABEL_PRINT" | "LABEL_REPRINT" | "LABEL_ISSUE_PRINT"

type Failure = { code: "UNAUTHORIZED" | "DENIED"; message: string }

async function resolveActor(): Promise<{ actor: CurrentUser } | Failure> {
  let denied = false
  for (const resource of READ_RESOURCES) {
    try {
      const actor = await requireResourcePermission(resource, "READ")
      return { actor }
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        return { code: "UNAUTHORIZED", message: "로그인이 필요합니다." }
      }
      denied = true
    }
  }
  return denied ? { code: "DENIED", message: "라벨을 출력할 권한이 없습니다." } : { code: "UNAUTHORIZED", message: "로그인이 필요합니다." }
}

function normalizeLotNos(input: unknown): string[] {
  const list = Array.isArray(input) ? input : []
  return Array.from(new Set(list.map((n) => String(n ?? "").trim()).filter(Boolean)))
}

const NOT_PERSISTED_MESSAGE =
  "아직 등록되지 않았거나 존재하지 않는 LOT 입니다. 입고(또는 LOT 생성)가 완료된 후 라벨을 출력해 주세요."

async function findPersisted(tenantId: string, lotNos: string[]) {
  const lots = await prisma.lot.findMany({ where: { tenantId, lotNo: { in: lotNos } } })
  const lotByNo = new Map(lots.map((l) => [l.lotNo, l]))
  const missing = lotNos.filter((n) => !lotByNo.has(n))
  return { lots, missing }
}

/** LOT 별 이전 출력 횟수. 입고 라벨(LABEL_PRINT/REPRINT)과 출고 라벨(LABEL_ISSUE_PRINT)을 따로 센다. */
async function printCounts(tenantId: string, lotIds: string[], purpose: LotLabelPurpose) {
  const previous = await prisma.auditLog.findMany({
    where: { tenantId, entityType: "LotLabel", entityId: { in: lotIds } },
    select: { entityId: true, afterData: true },
  })
  const counts = new Map<string, number>()
  for (const row of previous) {
    const event = (row.afterData as { event?: string } | null)?.event
    const isIssue = event === "LABEL_ISSUE_PRINT"
    if ((purpose === "ISSUE") !== isIssue) continue
    counts.set(row.entityId, (counts.get(row.entityId) ?? 0) + 1)
  }
  return counts
}

function normalizePurpose(input: unknown): LotLabelPurpose {
  return input === "ISSUE" ? "ISSUE" : "RECEIPT"
}

/**
 * 읽기 전용 사전 확인: LOT 가 영속화되었는지, 이미 출력된 LOT(재출력)가 있는지.
 * 번호 소모(onBeforePrint)나 감사 기록보다 먼저 호출해, 출력할 수 없는 상태에서 부작용이 생기지 않게 한다.
 */
export async function checkLotLabelPrintable(input: { lotNos: string[]; purpose?: LotLabelPurpose }): Promise<LotLabelCheckResult> {
  const resolved = await resolveActor()
  if (!("actor" in resolved)) return { ok: false, ...resolved }
  const tenantId = resolved.actor.tenantId

  const lotNos = normalizeLotNos(input?.lotNos)
  if (lotNos.length === 0) return { ok: false, code: "INVALID", message: "출력할 LOT 가 없습니다." }
  if (lotNos.length > MAX_LABEL_LOTS) {
    return { ok: false, code: "INVALID", message: `한 번에 ${MAX_LABEL_LOTS}건까지만 출력할 수 있습니다.` }
  }

  const { lots, missing } = await findPersisted(tenantId, lotNos)
  if (missing.length > 0) {
    return { ok: false, code: "LOT_NOT_PERSISTED", message: NOT_PERSISTED_MESSAGE, missingLotNos: missing }
  }
  const purpose = normalizePurpose(input?.purpose)
  // 출고 라벨은 재출력 사유가 필요 없다.
  if (purpose === "ISSUE") return { ok: true, reprintLotNos: [] }
  const counts = await printCounts(tenantId, lots.map((l) => l.id), purpose)
  return { ok: true, reprintLotNos: lots.filter((l) => (counts.get(l.id) ?? 0) > 0).map((l) => l.lotNo) }
}

/**
 * 라벨 출력(최초/재출력)을 AuditLog 에 남긴다. 같은 lotNo 는 항상 같은 QR payload 를 만든다(재출력해도 QR 불변).
 * 하나라도 영속화되지 않았거나, 재출력인데 사유가 없으면 아무것도 기록하지 않는다.
 */
export async function recordLotLabelPrint(input: {
  lotNos: string[]
  reason?: string
  purpose?: LotLabelPurpose
  /** 출력 맥락(예: 출고 작업지시번호). 감사 기록에만 남는다. */
  context?: string
}): Promise<LotLabelRecordResult> {
  const resolved = await resolveActor()
  if (!("actor" in resolved)) return { ok: false, ...resolved }
  const { actor } = resolved
  const tenantId = actor.tenantId

  const lotNos = normalizeLotNos(input?.lotNos)
  if (lotNos.length === 0) return { ok: false, code: "INVALID", message: "출력할 LOT 가 없습니다." }
  if (lotNos.length > MAX_LABEL_LOTS) {
    return { ok: false, code: "INVALID", message: `한 번에 ${MAX_LABEL_LOTS}건까지만 기록할 수 있습니다.` }
  }
  const reason = typeof input?.reason === "string" ? input.reason.trim().slice(0, 200) || null : null
  const purpose = normalizePurpose(input?.purpose)
  const context = typeof input?.context === "string" ? input.context.trim().slice(0, 100) || null : null

  const { lots, missing } = await findPersisted(tenantId, lotNos)
  if (missing.length > 0) {
    return { ok: false, code: "LOT_NOT_PERSISTED", message: NOT_PERSISTED_MESSAGE, missingLotNos: missing }
  }

  const counts = await printCounts(tenantId, lots.map((l) => l.id), purpose)
  const reprintLotNos = purpose === "ISSUE" ? [] : lots.filter((l) => (counts.get(l.id) ?? 0) > 0).map((l) => l.lotNo)
  if (reprintLotNos.length > 0 && !reason) {
    return {
      ok: false,
      code: "REASON_REQUIRED",
      message: "이미 출력된 LOT 입니다. 재출력 사유를 입력해 주세요.",
      reprintLotNos,
    }
  }

  const results: Array<{ lotNo: string; event: LabelEvent; printCount: number; qrPayload: string }> = []
  for (const lot of lots) {
    const priorCount = counts.get(lot.id) ?? 0
    const event: LabelEvent = purpose === "ISSUE" ? "LABEL_ISSUE_PRINT" : priorCount === 0 ? "LABEL_PRINT" : "LABEL_REPRINT"
    const qrPayload = encodeLotQr(lot.lotNo)
    await recordAuditLog(prisma, {
      tenantId,
      actor,
      entityType: "LotLabel",
      entityId: lot.id,
      action: "CREATE",
      afterData: {
        event,
        lotNo: lot.lotNo,
        printCount: priorCount + 1,
        reason: purpose === "ISSUE" || priorCount === 0 ? null : reason,
        context,
        qrPayload,
        lotStatus: String(lot.status),
        labelSpec: "QL-820NWB 29x90mm",
      },
      menuName: "LOT 라벨",
    })
    results.push({ lotNo: lot.lotNo, event, printCount: priorCount + 1, qrPayload })
  }
  return { ok: true, results }
}

/**
 * 시험용 라벨의 임시 LOT 번호(TEST-…)가 실제 LOT 번호와 겹치지 않는지 읽기 전용으로 확인한다.
 * 시험용 라벨은 LOT 저장·재고·감사 기록과 무관하다 — 이 함수는 아무것도 기록하지 않는다.
 */
export async function checkTestLotNosUnused(input: { lotNos: string[] }): Promise<{ ok: true } | { ok: false; message: string }> {
  const resolved = await resolveActor()
  if (!("actor" in resolved)) return { ok: false, message: resolved.message }
  const lotNos = normalizeLotNos(input?.lotNos)
  if (lotNos.length === 0 || lotNos.length > MAX_LABEL_LOTS) {
    return { ok: false, message: "시험용 라벨 수가 올바르지 않습니다." }
  }
  const invalid = lotNos.filter((n) => !isValidTestLotNo(n))
  if (invalid.length > 0) {
    return { ok: false, message: "시험용 LOT 번호는 TEST- 로 시작하는 영문/숫자 임시 번호여야 합니다(예: TEST-20261026-001)." }
  }
  const { lots } = await findPersisted(resolved.actor.tenantId, lotNos)
  if (lots.length > 0) {
    return { ok: false, message: `임시 번호 ${lots.map((l) => l.lotNo).join(", ")} 은(는) 실제 LOT 로 이미 사용 중입니다. 다른 TEST- 번호를 사용해 주세요.` }
  }
  return { ok: true }
}
