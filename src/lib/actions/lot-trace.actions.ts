"use server"

/**
 * LOT 정/역방향 제조이력 추적 Server Action (Phase 11 / DG-006 · DG-007).
 *
 * 한 번의 호출로 관계 체인 전체를 배치 조회한다(화면에서 여러 액션을 연쇄 호출하지 않는다).
 * 인증/권한: LOT READ. tenant 는 항상 세션 값만 사용하고 클라이언트 tenantId 는 받지 않는다.
 * 다른 tenant LOT 는 존재 여부를 노출하지 않는 일반 메시지로 응답한다.
 */

import { prisma } from "@/lib/db/prisma"
import { requireReadActor } from "@/lib/auth/action-guards"
import { classifyScanInput, lotNoFromScan } from "@/lib/qr/lot-qr"
import {
  traceFromLots,
  traceLotDb,
  type TraceDirection,
  type TraceResult,
} from "@/lib/traceability/lot-trace.service"

const NOT_FOUND_MESSAGE = "LOT을 찾을 수 없거나 접근할 수 없습니다."

export type LotTraceActionResult =
  | { ok: true; trace: TraceResult }
  | { ok: false; code: "UNAUTHORIZED" | "DENIED" | "INVALID" | "NOT_FOUND"; message: string }

async function authorizeLotRead(): Promise<{ tenantId: string } | LotTraceActionResult> {
  try {
    const actor = await requireReadActor("LOT")
    return { tenantId: actor.tenantId }
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (message === "UNAUTHORIZED") return { ok: false, code: "UNAUTHORIZED", message: "로그인이 필요합니다." }
    return { ok: false, code: "DENIED", message: "조회 권한이 없습니다." }
  }
}

function resolveLotNo(input: string): string | null {
  // QR 문자열 또는 LOT 번호 평문 모두 허용(검색창/스캐너 공용).
  return lotNoFromScan(classifyScanInput(input))
}

/** 인증은 각 export 가 먼저 수행한다(authorizeLotRead). 여기서는 확정된 세션 tenant 로만 조회한다. */
async function runLotTrace(tenantId: string, input: string, direction: TraceDirection): Promise<LotTraceActionResult> {
  const lotNo = resolveLotNo(String(input ?? ""))
  if (!lotNo) return { ok: false, code: "INVALID", message: "LOT 번호 또는 LOT QR 을 입력해 주세요." }

  const lot = await prisma.lot.findFirst({ where: { tenantId, lotNo }, select: { id: true } })
  if (!lot) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE }

  const trace = await traceFromLots(traceLotDb(prisma), tenantId, [lot.id], direction)
  if (!trace) return { ok: false, code: "NOT_FOUND", message: NOT_FOUND_MESSAGE }
  return { ok: true, trace }
}

/** 원자재 LOT → 입고/공급사 → 출고 → 작업지시 → 실적/공정/설비/작업자/검사 → 완제품 LOT → 출하 → 고객 */
export async function traceRawLot(lotNoOrQr: string): Promise<LotTraceActionResult> {
  const g = await authorizeLotRead()
  if ("ok" in g) return g
  return runLotTrace(g.tenantId, lotNoOrQr, "FORWARD")
}

/** 완제품 LOT → 작업지시 → 실적/공정/설비/작업자/검사 → 투입 원자재 LOT → 입고 → 공급사 (+ 출하/고객) */
export async function traceFinishedLot(lotNoOrQr: string): Promise<LotTraceActionResult> {
  const g = await authorizeLotRead()
  if ("ok" in g) return g
  return runLotTrace(g.tenantId, lotNoOrQr, "REVERSE")
}

/** 방향을 지정하는 범용 진입점(화면의 정/역 토글용). */
export async function traceLot(lotNoOrQr: string, direction: TraceDirection): Promise<LotTraceActionResult> {
  const g = await authorizeLotRead()
  if ("ok" in g) return g
  if (direction !== "FORWARD" && direction !== "REVERSE" && direction !== "BOTH") {
    return { ok: false, code: "INVALID", message: "추적 방향이 올바르지 않습니다." }
  }
  return runLotTrace(g.tenantId, lotNoOrQr, direction)
}

/** 출하번호 → 출하 LOT 들 → (역추적) → 작업지시 → 원자재 LOT → 공급사 */
export async function traceShipment(shipmentNo: string): Promise<LotTraceActionResult> {
  const g = await authorizeLotRead()
  if ("ok" in g) return g
  const no = String(shipmentNo ?? "").trim()
  if (!no || no.length > 64) return { ok: false, code: "INVALID", message: "출하번호를 입력해 주세요." }

  const shipment = await prisma.shipmentOrder.findFirst({
    where: { tenantId: g.tenantId, shipmentNo: no },
    select: { id: true },
  })
  if (!shipment) return { ok: false, code: "NOT_FOUND", message: "출하를 찾을 수 없거나 접근할 수 없습니다." }

  const items = await prisma.shipmentItem.findMany({
    where: { shipmentOrderId: shipment.id },
    select: { lotId: true },
  })
  const lotIds = Array.from(new Set(items.map((i) => i.lotId).filter((id): id is string => Boolean(id))))
  if (lotIds.length === 0) {
    return { ok: false, code: "NOT_FOUND", message: "이 출하에는 LOT 추적 대상 품목이 없습니다." }
  }
  const trace = await traceFromLots(traceLotDb(prisma), g.tenantId, lotIds, "REVERSE")
  if (!trace) return { ok: false, code: "NOT_FOUND", message: "출하를 찾을 수 없거나 접근할 수 없습니다." }
  return { ok: true, trace }
}
