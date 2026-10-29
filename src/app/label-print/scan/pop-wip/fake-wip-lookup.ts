import type { PopWipLookupResult } from "@/lib/actions/pop-wip-lookup.actions"
import { POP_WIP_LOOKUP_MESSAGES, judgePopWipScan, popWipStatusLabel, type PopWipFacts, type PopWipLookupFailCode } from "@/lib/pop/wip-scan"

/**
 * POP WIP QR 점검 화면(관리자 작업대기/현장 태블릿)이 함께 쓰는 가짜 서버 조회.
 * 판정은 실제 판정 규칙(judgePopWipScan)을 그대로 쓰고, DB 에서 읽어 올 사실(WIP/작업지시)만 시나리오 표로 대신한다.
 */
type Scenario = { facts: PopWipFacts; workOrderId: string; orderNo: string; itemCode: string; itemName: string; manufacturingNo: string | null; wipQty: number; operationLabel: string; rootCount?: number; openOperationCount?: number; workerSiteId?: string | null }
const wo = (status = "IN_PROGRESS") => ({ status, siteId: "s1" })
const root = { parentWipUnitId: null, sourceProductionResultId: null }
const base = (workOrderId: string, orderNo: string, itemCode: string, itemName: string, manufacturingNo: string) => ({ workOrderId, orderNo, itemCode, itemName, manufacturingNo, wipQty: 100, operationLabel: "1. 절삭" })

// WIP QR 값 → 서버가 DB 에서 읽어 올 사실. 판정은 실제 판정 규칙(judgePopWipScan)을 그대로 쓴다.
const SCENARIOS: Record<string, Scenario> = {
  "WIP-ROOT-1": { ...base("wo-1", "WO-0001", "FG-1", "완제품 1", "26A01"), facts: { status: "WAITING", ...root, workOrder: wo() } },
  "WIP-ROOT-2": { ...base("wo-2", "WO-0002", "FG-2", "완제품 2", "26A02"), facts: { status: "IN_PROCESS", ...root, workOrder: wo() } },
  "WIP-HOLD": { ...base("wo-3", "WO-0003", "FG-3", "완제품 3", "26A03"), facts: { status: "ON_HOLD", ...root, workOrder: wo() } },
  "WIP-CHILD": { ...base("wo-1", "WO-0001", "FG-1", "완제품 1", "26A01"), facts: { status: "REWORK", parentWipUnitId: "wip-root-1", sourceProductionResultId: "res-1", workOrder: wo() } },
  "WIP-SCRAP": { ...base("wo-1", "WO-0001", "FG-1", "완제품 1", "26A01"), facts: { status: "SCRAPPED", ...root, workOrder: wo() } },
  "WIP-DONE": { ...base("wo-1", "WO-0001", "FG-1", "완제품 1", "26A01"), facts: { status: "COMPLETED", ...root, workOrder: wo() } },
  "WIP-AMB": { ...base("wo-1", "WO-0001", "FG-1", "완제품 1", "26A01"), facts: { status: "WAITING", ...root, workOrder: wo() }, rootCount: 2 },
  // 현장 POP 작업자 세션(작업장 s1)으로 다른 작업장(s2)의 작업지시 WIP 를 찍은 경우
  "WIP-OTHER-SITE": { ...base("wo-1", "WO-0001", "FG-1", "완제품 1", "26A01"), facts: { status: "WAITING", ...root, workOrder: { status: "IN_PROGRESS", siteId: "s2" } }, workerSiteId: "s1" },
  "WIP-NOT-IN-LIST": { ...base("wo-9", "WO-0009", "FG-9", "완제품 9", "26A09"), facts: { status: "WAITING", ...root, workOrder: wo() } },
  "WIP-SLOW": { ...base("wo-1", "WO-0001", "FG-1", "완제품 1", "26A01"), facts: { status: "WAITING", ...root, workOrder: wo() } },
}

export async function fakeLookup(wipUnitId: string): Promise<PopWipLookupResult> {
  if (wipUnitId === "WIP-ERROR") throw new Error("서버 조회 오류(가짜)")
  if (wipUnitId === "WIP-SLOW") await new Promise((resolve) => setTimeout(resolve, 1200))
  const s = SCENARIOS[wipUnitId]
  if (!s) return { ok: false, code: "WIP_NOT_FOUND", message: POP_WIP_LOOKUP_MESSAGES.WIP_NOT_FOUND }
  const judgement = judgePopWipScan({ wip: s.facts, rootCount: s.rootCount ?? 1, openOperationCount: s.openOperationCount ?? 1, workerSiteId: s.workerSiteId ?? null })
  if (!judgement.ok) return { ok: false, code: judgement.code as PopWipLookupFailCode, message: POP_WIP_LOOKUP_MESSAGES[judgement.code] }
  return {
    ok: true,
    wipUnitId,
    wipStatus: s.facts.status,
    wipStatusLabel: popWipStatusLabel(s.facts.status),
    wipQty: s.wipQty,
    manufacturingNo: s.manufacturingNo,
    workOrderId: s.workOrderId,
    orderNo: s.orderNo,
    itemCode: s.itemCode,
    itemName: s.itemName,
    operationLabel: s.operationLabel,
    notice: judgement.notice,
  }
}
