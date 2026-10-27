"use server"

/**
 * 자재출고(작업지시 기반 생산자재 출고) 화면의 "QR 스캔으로 LOT 선택" 보조 조회 — 읽기 전용.
 *
 * 원칙
 *  - QR 에서 읽은 LOT 번호는 신뢰할 수 없는 외부 입력이다. 로그인·tenant(세션 기준)·LOT 존재·작업지시 BOM 자재·LOT 상태·재고를 서버가 확인한다.
 *  - 쓰기가 전혀 없다: 재고/예약/WipUnit/작업지시/감사 이력을 바꾸지 않는다. 실제 출고는 기존 issueMaterialsForWorkOrder 가
 *    사용자의 [출고 처리] 클릭으로만 수행하며, 그때 재고·수량·권한을 입력 방식(QR/수동)과 무관하게 다시 검증한다.
 *  - 선택 후보는 수동 선택 UI 와 같은 조회(getLotStockByItems: LOT·창고별 가용재고 > 0)에서 나온다 — 새 재고 계산을 만들지 않는다.
 *  - LOT 번호는 tenant 안에서 유일(Lot.tenantId+lotNo)하지만 창고별 재고 행이 여러 개일 수 있다. 하나로 결정할 수 없으면 후보를
 *    모두 돌려주고 사용자가 고르게 한다(임의 선택 금지).
 *  - 다른 tenant 의 LOT/없는 LOT 는 같은 메시지로 응답해 존재 여부를 노출하지 않는다.
 *  - QR 에는 LOT 번호만 있다. 원자재/완제품은 QR 로 구분하지 않고 여기서 실제 품목(BOM 자재 여부)으로 확인한다.
 */

import { prisma } from "@/lib/db/prisma"
import { resolveLotStockReader } from "@/lib/material-issue/lot-read-access"
import { encodeLotQr } from "@/lib/qr/lot-qr"
import { getLotStockByItems, type LotStockOption } from "@/lib/actions/material-issue.actions"
import { ISSUE_LOT_LOOKUP_MESSAGES, type IssueLotLookupFailCode } from "@/lib/material-issue/lot-scan"
import { evaluateLotIssueEligibility } from "@/lib/material-issue/lot-eligibility"

export type IssueLotLookupResult =
  | {
      ok: true
      itemId: string
      itemCode: string
      itemName: string
      itemType: string
      isLotTracked: boolean
      lotId: string
      lotNo: string
      lotStatus: string
      /** 출고 가능한 LOT·창고별 재고(수동 선택 UI 의 LotStockOption 과 같은 형태). 1건이면 바로 반영, 여러 건이면 사용자가 선택. */
      options: LotStockOption[]
    }
  | { ok: false; code: IssueLotLookupFailCode; message: string }

function fail(code: IssueLotLookupFailCode): IssueLotLookupResult {
  return { ok: false, code, message: ISSUE_LOT_LOOKUP_MESSAGES[code] }
}


/**
 * 스캔한 LOT 번호로 "이 작업지시의 자재출고에 선택 가능한 LOT 재고"를 조회한다(읽기 전용).
 * 검증 순서: 로그인/tenant → 입력 → 작업지시(tenant 소유) → LOT 존재(tenant) → BOM 자재 여부 → LOT 상태 → 출고 가능 재고.
 */
export async function lookupLotForMaterialIssue(input: { workOrderId: string; lotNo: string }): Promise<IssueLotLookupResult> {
  const resolved = await resolveLotStockReader() // getLotStockByItems 와 같은 로그인·권한·tenant 기준
  if ("code" in resolved) return fail(resolved.code)
  const tenantId = resolved.tenantId // 세션 tenant 만 사용 — 클라이언트가 보낸 tenant 는 받지 않는다

  const workOrderId = typeof input?.workOrderId === "string" ? input.workOrderId.trim() : ""
  const lotNo = typeof input?.lotNo === "string" ? input.lotNo.trim() : ""
  if (!workOrderId) return fail("WORK_ORDER_NOT_FOUND")
  try {
    encodeLotQr(lotNo) // 빈 값·제어문자·길이 초과 거부(QR 규격과 같은 기준)
  } catch {
    return fail("INVALID")
  }

  const workOrder = await prisma.workOrder.findFirst({
    where: { id: workOrderId, tenantId },
    select: { id: true, bom: { select: { bomItems: { select: { componentItemId: true } } } } },
  })
  if (!workOrder) return fail("WORK_ORDER_NOT_FOUND")

  const lot = await prisma.lot.findFirst({
    where: { tenantId, lotNo },
    select: {
      id: true,
      lotNo: true,
      status: true,
      expiryDate: true,
      itemId: true,
      item: { select: { id: true, code: true, name: true, itemType: true, isLotTracked: true } },
    },
  })
  if (!lot) return fail("LOT_NOT_FOUND") // 다른 tenant 의 LOT 도 같은 응답

  // 수동 선택 UI 와 같은 범위: 이 작업지시 BOM 구성품의 LOT 만(자재출고 화면은 BOM 자재별로 LOT 를 고른다)
  const componentIds = new Set(workOrder.bom.bomItems.map((b) => b.componentItemId))
  if (!componentIds.has(lot.itemId)) return fail("NOT_BOM_MATERIAL")

  // 출고 적격성(LOT 상태·유효기간): 수동 선택 목록·출고 확정과 같은 공통 규칙
  const eligibility = evaluateLotIssueEligibility({ status: lot.status, expiryDate: lot.expiryDate })
  if (!eligibility.eligible) return { ok: false, code: eligibility.code, message: eligibility.message }

  // 기존 LOT 재고 조회(수동 선택과 동일 쿼리) 재사용 — tenant 는 세션 값
  const stockByItem = await getLotStockByItems([lot.itemId], tenantId)
  const options = (stockByItem[lot.itemId] ?? []).filter((o) => o.lotId === lot.id && o.qtyAvailable > 0 && !o.issueBlockReason)
  if (options.length === 0) return fail("NO_STOCK")

  return {
    ok: true,
    itemId: lot.itemId,
    itemCode: lot.item.code,
    itemName: lot.item.name,
    itemType: String(lot.item.itemType),
    isLotTracked: Boolean(lot.item.isLotTracked),
    lotId: lot.id,
    lotNo: lot.lotNo,
    lotStatus: String(lot.status),
    options,
  }
}
