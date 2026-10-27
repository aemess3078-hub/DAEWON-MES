"use server"

import { requireRole } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { generateCnsMaterialReceiptLotNo } from "@/lib/lot-numbering/lot-number-generator"
import { computeNextMaterialReceiptLotNo } from "@/lib/lot-numbering/lot-reservation"
import type { CnsItemRuleContext } from "@/lib/lot-numbering/lot-rule-resolver"
import { Prisma, ReceivingInspectionResult } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import { lockPurchaseOrderItemsForUpdate } from "@/lib/quantity-concurrency"
import { recordAuditLog } from "@/lib/audit-log"
import { BUSINESS_NUMBER_MAX_ATTEMPTS, isUniqueConstraintError, kstDateParts } from "@/lib/business-numbering"
import { isOutcomeUnknownError, toUserErrorMessage } from "@/lib/errors/user-error"
import {
  RECEIVING_REQUEST_CONFLICT_MESSAGE,
  RECEIVING_REQUEST_ID_INVALID_MESSAGE,
  RECEIVING_UNKNOWN_MESSAGE,
  hashReceivingRequest,
  judgeExistingRequest,
} from "@/lib/receiving-idempotency"
import { isValidReceivingRequestId } from "@/lib/receiving-request-id"
import { NULL_LOT_BALANCE_CONTENTION_MESSAGE, isNullLotBalanceUniqueError } from "@/lib/inventory-balance-guard"
import { checkReceiptRemaining, validateReceiptQuantities } from "@/lib/receiving-quantity"
import { safeRevalidate } from "@/lib/revalidate-safe"
import { allocateReceiptTxNo } from "@/lib/services/receiving-tx-number.service"

export type CreateReceivingInspectionInput = {
  purchaseOrderItemId: string
  purchaseOrderId: string
  warehouseId: string          // 사용자가 명시적으로 선택한 창고
  siteId: string               // PO의 사이트 (서버 검증용)
  inspectorId?: string
  receivedQty: number
  acceptedQty: number
  rejectedQty: number
  result: ReceivingInspectionResult
  note?: string
  lotNo?: string               // 입력 시 해당 LOT 사용, 미입력 + isLotTracked 시 자동생성
  lotReservationId?: string    // 자동채번 미리보기(reserveReceivingLotNumber)로 발급받은 예약 id
  /**
   * 멱등 키(필수). 하나의 입고 작업은 재시도에도 같은 값을 보낸다. 같은 (tenant, requestId) 는 한 번만 처리되고,
   * 재전송은 새 입고/LOT/거래번호 없이 기존 결과를 돌려준다. 같은 발주품목의 분할 입고는 requestId 가 달라야 한다.
   */
  requestId: string
  // 하위 호환용 (무시됨)
  tenantId?: string
}

/** 특정 사이트에 속한 창고 목록 조회 (다이얼로그 창고 선택용) */
export async function getWarehousesForSite(siteId: string) {
  // 로그인 · 자재입고(PURCHASE_ORDER) 조회 권한 확인. tenant 는 세션 값만 쓴다(getTenantId 의 개발용 대체값을 쓰지 않는다).
  // 거부 시 빈 목록 — 두 호출 화면(자재입고/발주 입고)은 창고 선택 목록이 비어 보일 뿐 다른 정보는 노출되지 않는다.
  let tenantId: string
  try {
    tenantId = (await requireResourcePermission("PURCHASE_ORDER", "READ")).tenantId
  } catch {
    return []
  }
  if (typeof siteId !== "string" || !siteId) return []
  return prisma.warehouse.findMany({
    where: { siteId, tenantId },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  })
}

/** 원자재 LOT 번호 자동생성 헬퍼.
 * CNS quick rule: YY + month letter(A-L) + DD + "-" + daily sequence.
 * 수동 LOT 입력은 createReceivingInspection에서 우선 처리한다.
 */
export async function generateReceivingLotNo(
  tenantId: string,
  itemContext: CnsItemRuleContext = {},
  sequenceOffset = 0,
): Promise<string> {
  // 로그인 · 자재입고(PURCHASE_ORDER) 생성 권한 확인(createReceivingInspection 과 같은 권한). tenant 는 세션 값만 쓰고,
  // 클라이언트가 보낸 tenantId 가 세션과 다르면 거부한다(다른 tenant 의 LOT 채번 순번을 볼 수 없다). 현재 호출처는 없다.
  const actor = await requireResourcePermission("PURCHASE_ORDER", "CREATE")
  if (typeof tenantId !== "string" || tenantId !== actor.tenantId) throw new Error("이 기능을 사용할 권한이 없습니다.")
  return generateCnsMaterialReceiptLotNo(prisma, actor.tenantId, itemContext, new Date(), sequenceOffset)
}

const AUTO_LOT_COLLISION = "AUTO_LOT_COLLISION"

/**
 * outcome: 실패 시 "FAILED"(롤백이 확실한 업무/검증 오류, 수정 후 재시도 가능) 또는
 *          "UNKNOWN"(DB 연결/응답 오류로 커밋 여부를 알 수 없음 — 성공으로 단정하지 않고 자동 재시도도 금지)
 */
// replayed: 같은 requestId 의 재전송이라 새로 처리하지 않고 기존 결과(성공)를 돌려준 경우
// lotNo: 이번 호출이 새로 입고를 처리해 커밋한 뒤 DB 에서 Lot 행을 다시 확인한 LOT 번호(LOT 관리 품목, 서버 자동 발행 포함).
//        라벨 출력용 확인값이다 — 재전송(replayed)이거나 확인하지 못하면 포함하지 않는다(클라이언트는 번호를 추측하지 않는다).
type ReceivingResult = { success: boolean; message?: string; outcome?: "FAILED" | "UNKNOWN"; replayed?: boolean; lotNo?: string }

export async function createReceivingInspection(
  data: CreateReceivingInspectionInput,
): Promise<ReceivingResult> {
  try {
    await requireResourcePermission("PURCHASE_ORDER", "CREATE")
    return await createReceivingInspectionInternal(data)
  } catch (error) {
    // Next.js는 프로덕션에서 Server Action이 throw한 에러 메시지를 자동으로
    // 지우므로(보안상 기본 동작), 여기서 잡아 메시지를 반환값에 담아
    // 클라이언트가 실제 원인을 표시할 수 있게 한다.
    // 업무 규칙 메시지는 그대로, Prisma/DB 내부 오류는 안전한 안내문으로 바꾼다(원본은 서버 로그에만 남긴다).
    console.error("[createReceivingInspection] error:", error)
    if (isOutcomeUnknownError(error)) {
      return { success: false, outcome: "UNKNOWN", message: RECEIVING_UNKNOWN_MESSAGE }
    }
    return {
      success: false,
      outcome: "FAILED",
      message: toUserErrorMessage(error, { fallback: "입고 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }),
    }
  }
}

async function createReceivingInspectionInternal(
  data: CreateReceivingInspectionInput,
): Promise<ReceivingResult> {
  const user = await requireRole("OPERATOR")
  const tenantId = user.tenantId

  // ── 0. 수량 검증 (소수점 6자리 정수로 환산해 정확히 비교 — 부동소수점 오차/허용오차 없음) ──
  // Decimal(18,6) 정책: NaN/Infinity/음수/6자리 초과 소수는 거부, 합격 + 불합격 = 입고수량이 정확히 성립해야 한다.
  // 이후 모든 쓰기는 6자리로 정규화한 값(qty)을 사용한다 (예: 0.19999999999999998 → 0.2).
  const quantityCheck = validateReceiptQuantities(data)
  if (!quantityCheck.ok) throw new Error(quantityCheck.message)
  const qty = quantityCheck.value
  const receivedScaled = qty.receivedScaled

  // ── 0-A. 멱등 키 검증 + 요청 내용 해시 ──────────────────────────────────────
  if (!isValidReceivingRequestId(data.requestId)) throw new Error(RECEIVING_REQUEST_ID_INVALID_MESSAGE)
  const requestId = data.requestId
  const requestHash = hashReceivingRequest({
    purchaseOrderId: data.purchaseOrderId,
    purchaseOrderItemId: data.purchaseOrderItemId,
    warehouseId: data.warehouseId,
    receivedScaled: String(qty.receivedScaled),
    acceptedScaled: String(qty.acceptedScaled),
    rejectedScaled: String(qty.rejectedScaled),
    result: data.result,
    lotNo: data.lotNo,
    lotReservationId: data.lotReservationId,
    inspectorId: data.inspectorId,
    note: data.note,
  })
  // 이미 처리된 요청의 재전송이면 현재 잔량·발주 상태와 무관하게 기존 결과를 돌려준다(재검증하면 "잔여수량 초과" 로 거절됨).
  const prior = await prisma.receivingRequest.findUnique({
    where: { tenantId_requestId: { tenantId, requestId } },
    select: { requestHash: true },
  })
  if (prior) {
    if (judgeExistingRequest(prior.requestHash, requestHash) === "REPLAY") return { success: true, replayed: true }
    throw new Error(RECEIVING_REQUEST_CONFLICT_MESSAGE)
  }

  // ── 1. 창고 존재 및 테넌트 소속 확인 ──────────────────────────────────────
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: data.warehouseId, tenantId },
  })
  if (!warehouse) {
    throw new Error("선택한 창고를 찾을 수 없습니다.")
  }

  // ── 2. PO 품목 조회 (isLotTracked 포함) 및 사이트-창고 정합성 검증 ────────
  const purchaseOrderItem = await prisma.purchaseOrderItem.findUniqueOrThrow({
    where: { id: data.purchaseOrderItemId },
    include: {
      purchaseOrder: { select: { siteId: true, status: true } },
      item: {
        select: {
          code: true,
          itemType: true,
          lotNumberingType: true,
          lotPrefix: true,
          manualLotPolicy: true,
          isLotTracked: true,
          uom: true,
          itemGroup: { select: { code: true } },
          category: { select: { code: true } },
        },
      },
    },
  })

  // 클라이언트가 보낸 purchaseOrderId 는 입고 후 발주 상태 갱신(purchaseOrder.update)에 쓰인다.
  // 발주 품목이 실제로 속한 발주와 다르면 다른 발주(타 테넌트 포함)의 상태를 바꿀 수 있으므로 거절한다.
  if (purchaseOrderItem.purchaseOrderId !== data.purchaseOrderId) {
    throw new Error("발주 정보가 일치하지 않습니다. 화면을 새로고침한 후 다시 시도해 주세요.")
  }

  const poStatus = purchaseOrderItem.purchaseOrder.status
  if (poStatus === "CLOSED" || poStatus === "CANCELLED") {
    throw new Error("종결되었거나 취소된 발주에는 입고할 수 없습니다.")
  }

  const poSiteId = purchaseOrderItem.purchaseOrder.siteId
  if (warehouse.siteId !== poSiteId) {
    throw new Error(
      `입고 창고의 사이트가 발주 사이트와 다릅니다. ` +
      `창고는 반드시 발주의 사이트에 속해야 합니다.`
    )
  }

  // ── 2-A. 잔여수량 검증 (DB 기준 재계산, 정확한 소수 비교) ─────────────────
  const uom = purchaseOrderItem.item.uom
  const remainingCheck = checkReceiptRemaining(receivedScaled, purchaseOrderItem.qty, purchaseOrderItem.receivedQty, uom)
  if (!remainingCheck.ok) throw new Error(remainingCheck.message)

  const isLotTracked = purchaseOrderItem.item.isLotTracked ?? false

  // ── 3. LOT 번호 결정 ───────────────────────────────────────────────────────
  // isLotTracked=false → 입력값 무시, 항상 null (비LOT 출고 흐름 보존)
  // isLotTracked=true  → 아래 4가지 모드 중 하나
  //   RESERVED: 자동채번 미리보기(lotReservationId)로 확정된 번호 그대로 사용
  //   MANUAL:   공급사 LOT 직접 입력
  //   AUTO:     미입력(또는 DISABLED 정책) → 입고 확정 시 서버가 즉시 채번
  //   NONE:     비LOT 품목
  const manualLotNo = isLotTracked ? data.lotNo?.trim() || null : null
  const manualLotPolicy = purchaseOrderItem.item.manualLotPolicy ?? "ALLOWED"
  const lotNumberingType = purchaseOrderItem.item.lotNumberingType ?? "DEFAULT"
  const shouldIgnoreManualLotNo = manualLotPolicy === "DISABLED"
  if (isLotTracked && (lotNumberingType === "MANUAL" || manualLotPolicy === "REQUIRED") && !manualLotNo) {
    throw new Error("LOT 번호를 직접 입력해야 하는 품목입니다.")
  }

  type LotResolutionMode = "NONE" | "AUTO" | "MANUAL" | "RESERVED"
  let lotResolutionMode: LotResolutionMode
  if (!isLotTracked) {
    lotResolutionMode = "NONE"
  } else if (data.lotReservationId) {
    // 유효한 예약(자동채번 미리보기)이 있으면 정책(ALLOWED/DISABLED)과 무관하게 그 번호를 그대로 사용한다.
    // reserveReceivingLotNumber 자체가 REQUIRED/MANUAL 품목에는 예약 발급을 거부하므로 안전하다.
    // 이미 라벨이 출력됐을 수 있으므로 미리보기 번호와 실제 저장 번호가 달라지면 안 된다.
    lotResolutionMode = "RESERVED"
  } else if (shouldIgnoreManualLotNo) {
    // DISABLED 정책 + 예약 미사용 → 입력값과 무관하게 서버가 즉시 자동 발행한다.
    lotResolutionMode = "AUTO"
  } else if (manualLotNo) {
    lotResolutionMode = "MANUAL"
  } else {
    lotResolutionMode = "AUTO"
  }

  const itemRuleContext: CnsItemRuleContext = {
    itemCode: purchaseOrderItem.item.code,
    itemGroupCode: purchaseOrderItem.item.itemGroup?.code,
    itemCategoryCode: purchaseOrderItem.item.category?.code,
    itemType: purchaseOrderItem.item.itemType,
    lotNumberingType,
    lotPrefix: purchaseOrderItem.item.lotPrefix,
    manualLotPolicy,
  }
  // 입고 수불 거래번호(txNo)는 트랜잭션 안에서 (tenant, 날짜) advisory lock 으로 직렬화해 확보한다 (4-5 단계)
  // ── 4. 트랜잭션 처리 ───────────────────────────────────────────────────────
  // AUTO만 충돌 시 재시도(최대 5회). RESERVED/MANUAL/NONE은 재시도 없이 그대로 확정하거나 실패시킨다.
  //
  // AUTO 경로도 LotNumberReservation을 "단일 발행 원장"으로 사용한다: 번호를 계산한 뒤 곧바로
  // 같은 트랜잭션 안에서 CONSUMED 상태로 예약 행을 만들어(=원자적 클레임) Lot을 생성한다.
  // 이렇게 하면 자동채번 미리보기(RESERVED)와 버튼 미사용 AUTO 확정이 서로 다른 트랜잭션에서
  // 동시에 실행되어도, 두 경로 모두 같은 테이블의 (tenantId, lotNo) unique 제약을 통해서만
  // 번호를 "소유"할 수 있으므로 Lot 테이블과 예약 테이블 사이의 경합이 사라진다.
  const maxAttempts = qty.accepted > 0 || lotResolutionMode === "AUTO" ? BUSINESS_NUMBER_MAX_ATTEMPTS : 1
  let replayed = false
  // 트랜잭션이 끝까지 실행된 시도에서 확정된 LOT 번호(커밋 후 아래에서 DB 로 재확인한다). 시도마다 초기화한다.
  const committed: { lotNo: string | null } = { lotNo: null }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    committed.lotNo = null
    try {
      await prisma.$transaction(async (tx) => {
        await lockPurchaseOrderItemsForUpdate(tx, tenantId, [data.purchaseOrderItemId])
        let txNo: string | null = null

        // 멱등 클레임 — 입고검사/재고/수불/거래번호/LOT 와 같은 트랜잭션. 롤백되면 클레임도 사라져 정상 재시도를 막지 않는다.
        // 같은 발주품목의 동시 재전송은 위 행 잠금으로 직렬화되어, 먼저 커밋된 요청을 여기서 보고 그대로 돌려준다.
        // (다른 발주품목에서 같은 requestId 가 동시에 오면 아래 INSERT 가 unique 로 하나만 통과시킨다.)
        const priorInTx = await tx.receivingRequest.findUnique({
          where: { tenantId_requestId: { tenantId, requestId } },
          select: { requestHash: true },
        })
        if (priorInTx) {
          if (judgeExistingRequest(priorInTx.requestHash, requestHash) !== "REPLAY") throw new Error(RECEIVING_REQUEST_CONFLICT_MESSAGE)
          replayed = true
          return // 새 입고·LOT 번호·거래번호를 만들지 않는다
        }
        const claim = await tx.receivingRequest.create({
          data: { tenantId, requestId, requestHash, purchaseOrderItemId: data.purchaseOrderItemId },
          select: { id: true },
        })
        const lockedPurchaseOrderItem = await tx.purchaseOrderItem.findFirst({
          where: {
            id: data.purchaseOrderItemId,
            purchaseOrder: { tenantId },
          },
          select: {
            qty: true,
            receivedQty: true,
            item: { select: { uom: true } },
            purchaseOrder: { select: { status: true } },
          },
        })
        if (!lockedPurchaseOrderItem) {
          throw new Error("발주 품목을 찾을 수 없습니다.")
        }
        // 잠금 이후 상태를 다시 확인한다(잔량 종결과 입고가 동시에 실행되는 경우)
        if (
          lockedPurchaseOrderItem.purchaseOrder.status === "CLOSED" ||
          lockedPurchaseOrderItem.purchaseOrder.status === "CANCELLED"
        ) {
          throw new Error("종결되었거나 취소된 발주에는 입고할 수 없습니다.")
        }
        // 잠금 이후 같은 정책(checkReceiptRemaining)으로 잔량을 다시 검증한다
        const lockedRemainingCheck = checkReceiptRemaining(
          receivedScaled,
          lockedPurchaseOrderItem.qty,
          lockedPurchaseOrderItem.receivedQty,
          lockedPurchaseOrderItem.item.uom
        )
        if (!lockedRemainingCheck.ok) throw new Error(lockedRemainingCheck.message)

        // 입고 거래번호 확보 — 재고(InventoryBalance) 조회/생성보다 **먼저** 한다.
        // (tenant, 날짜) advisory lock 이 여기서부터 커밋/롤백까지 유지되므로,
        //  1) 같은 날짜의 거래번호가 중복되지 않고(최신 번호를 잠금 안에서 재조회),
        //  2) 같은 테넌트의 입고끼리 "재고 행이 없으면 만든다" 구간이 직렬화되어 비LOT 품목의 최초 재고 행이 둘로 갈라지지 않는다.
        // 롤백되면 번호도 소모되지 않는다. 합격수량이 0 이면 수불/재고를 건드리지 않으므로 번호도 잠금도 필요 없다.
        if (qty.accepted > 0) {
          txNo = await allocateReceiptTxNo(tx, tenantId, { yyyymmdd: kstDateParts().yyyymmdd })
        }

        let consumedReservationId: string | null = null
        let resolvedLotNo: string | null = null

    // 4-0. 자동채번 미리보기(RESERVED) 검증 — 예약이 유효할 때만 그 번호를 그대로 사용한다.
    //      임의로 다른 순번을 대신 발행하지 않는다: 이미 라벨이 출력됐을 수 있기 때문.
    if (lotResolutionMode === "RESERVED") {
      resolvedLotNo = manualLotNo
      const reservation = await tx.lotNumberReservation.findFirst({
        where: { id: data.lotReservationId!, tenantId },
      })
      if (
        !reservation ||
        reservation.itemId !== purchaseOrderItem.itemId ||
        reservation.purchaseOrderItemId !== data.purchaseOrderItemId ||
        reservation.lotNo !== resolvedLotNo
      ) {
        throw new Error("자동채번 예약이 만료되었습니다. 다시 자동채번한 후 라벨을 출력해주세요.")
      }
      if (reservation.status === "RESERVED" && reservation.expiresAt < new Date()) {
        // lazy expiration: 검증 시점에 만료가 확인되면 그 자리에서 정리한다.
        //   - 라벨 미출력: 행 삭제(번호 재사용 가능) / 라벨 출력됨: EXPIRED로 남김(번호 영구 재사용 금지)
        if (reservation.printedAt) {
          await tx.lotNumberReservation.update({
            where: { id: reservation.id },
            data: { status: "EXPIRED" },
          })
        } else {
          await tx.lotNumberReservation.delete({ where: { id: reservation.id } })
        }
        throw new Error("자동채번 예약이 만료되었습니다. 다시 자동채번한 후 라벨을 출력해주세요.")
      }
      if (reservation.status !== "RESERVED") {
        throw new Error("자동채번 예약이 만료되었습니다. 다시 자동채번한 후 라벨을 출력해주세요.")
      }
      consumedReservationId = reservation.id
    }

    // 4-0-B. MANUAL: 다른 발주품목이 예약(RESERVED, 미만료) 중인 번호를 그대로 수동입력하면 차단
    if (lotResolutionMode === "MANUAL") {
      resolvedLotNo = manualLotNo
      const conflictingReservation = await tx.lotNumberReservation.findFirst({
        where: {
          tenantId,
          lotNo: resolvedLotNo!,
          status: "RESERVED",
          purchaseOrderItemId: { not: data.purchaseOrderItemId },
        },
      })
      if (conflictingReservation && conflictingReservation.expiresAt > new Date()) {
        throw new Error(
          `LOT 번호 '${resolvedLotNo}'는 다른 입고 건에 예약되어 있습니다. 잠시 후 다시 시도해주세요.`
        )
      }
    }

    // 4-0-C. AUTO: 번호 계산과 "예약 원장에 CONSUMED로 즉시 클레임"을 같은 트랜잭션에서 원자적으로 수행.
    //        claim insert가 unique 충돌(P2002)나면 트랜잭션 전체가 롤백되고 바깥 루프가 다음 attempt로 재시도한다.
    if (lotResolutionMode === "AUTO") {
      resolvedLotNo = await computeNextMaterialReceiptLotNo(tx, tenantId, itemRuleContext, new Date(), attempt)
      const claimed = await tx.lotNumberReservation.create({
        data: {
          tenantId,
          itemId: purchaseOrderItem.itemId,
          purchaseOrderId: data.purchaseOrderId,
          purchaseOrderItemId: data.purchaseOrderItemId,
          lotNo: resolvedLotNo,
          status: "CONSUMED",
          reservedBy: user.id,
          expiresAt: new Date(),
          consumedAt: new Date(),
        },
      })
      consumedReservationId = claimed.id
    }

    // 4-1. LOT 조회 또는 생성
    let lotId: string | null = null
    if (resolvedLotNo) {
      const existingLot = await tx.lot.findFirst({
        where: { tenantId, lotNo: resolvedLotNo },
      })
      if (existingLot) {
        if (existingLot.itemId !== purchaseOrderItem.itemId) {
          throw new Error(
            `LOT 번호 '${resolvedLotNo}'는 다른 품목에 이미 사용 중입니다. 다른 번호를 입력해주세요.`
          )
        }
        if (lotResolutionMode === "AUTO") {
          throw new Error(AUTO_LOT_COLLISION)
        }
        lotId = existingLot.id
      } else {
        const newLot = await tx.lot.create({
          data: {
            tenantId,
            itemId: purchaseOrderItem.itemId,
            lotNo: resolvedLotNo,
            status: "ACTIVE",
            manufactureDate: new Date(),
          },
        })
        lotId = newLot.id
      }
    }

    // 4-1-B. 예약을 사용했다면 실제 Lot 생성과 같은 트랜잭션에서 CONSUMED 처리
    //        (트랜잭션이 실패하면 이 갱신도 함께 롤백되어 "입고 실패 시 CONSUMED 처리 금지"가 보장된다)
    if (consumedReservationId) {
      await tx.lotNumberReservation.update({
        where: { id: consumedReservationId },
        data: { status: "CONSUMED", consumedAt: new Date() },
      })
    }

    // 4-2. ReceivingInspection 생성
    const inspection = await tx.receivingInspection.create({
      data: {
        purchaseOrderItemId: data.purchaseOrderItemId,
        inspectorId: data.inspectorId ?? null,
        receivedQty: qty.received,
        acceptedQty: qty.accepted,
        rejectedQty: qty.rejected,
        result: data.result,
        note: data.note,
      },
    })
    await tx.receivingRequest.update({ where: { id: claim.id }, data: { receivingInspectionId: inspection.id } })

    // 4-3. PurchaseOrderItem.receivedQty 갱신
    await tx.purchaseOrderItem.update({
      where: { id: data.purchaseOrderItemId },
      data: { receivedQty: { increment: qty.accepted } },
    })

    // 4-4. InventoryBalance 갱신 (합격 수량만)
    if (qty.accepted > 0) {
      const existingBalance = await tx.inventoryBalance.findFirst({
        where: {
          tenantId,
          itemId: purchaseOrderItem.itemId,
          warehouseId: warehouse.id,
          lotId,
        },
      })
      if (existingBalance) {
        await tx.inventoryBalance.update({
          where: { id: existingBalance.id },
          data: {
            qtyOnHand: { increment: qty.accepted },
            qtyAvailable: { increment: qty.accepted },
          },
        })
      } else {
        await tx.inventoryBalance.create({
          data: {
            tenantId,
            siteId: warehouse.siteId,
            itemId: purchaseOrderItem.itemId,
            warehouseId: warehouse.id,
            lotId,
            qtyOnHand: qty.accepted,
            qtyAvailable: qty.accepted,
            qtyHold: 0,
          },
        })
      }

      // 4-5. InventoryTransaction 생성
      //      거래번호(txNo)는 위 "재고 반영 이전" 단계에서 이미 확보했다.
      if (!txNo) throw new Error("입고 거래번호가 확보되지 않았습니다.") // 합격수량 > 0 이면 위에서 항상 확보됨(방어)
      await tx.inventoryTransaction.create({
        data: {
          tenantId,
          itemId: purchaseOrderItem.itemId,
          lotId,
          toLocationId: warehouse.id,
          txNo,
          txType: "RECEIPT",
          qty: qty.accepted,
          refType: "PURCHASE_ORDER",
          refId: data.purchaseOrderId,
          note: resolvedLotNo ? `LOT 입고: ${resolvedLotNo}` : (data.note ?? null),
        },
      })
    }

    // 4-6. PurchaseOrder 상태 갱신
    const allItems = await tx.purchaseOrderItem.findMany({
      where: { purchaseOrderId: data.purchaseOrderId },
    })
    const fullyReceived = allItems.every((i) => Number(i.receivedQty) >= Number(i.qty))
    if (fullyReceived) {
      await tx.purchaseOrder.update({
        where: { id: data.purchaseOrderId },
        data: { status: "RECEIVED" },
      })
    } else if (allItems.some((i) => Number(i.receivedQty) > 0)) {
      await tx.purchaseOrder.update({
        where: { id: data.purchaseOrderId },
        data: { status: "PARTIAL_RECEIVED" },
      })
    }
    await recordAuditLog(tx, {
      tenantId,
      actor: user,
      entityType: "ReceivingInspection",
      entityId: inspection.id,
      action: "CREATE",
      afterData: {
        purchaseOrderId: data.purchaseOrderId,
        purchaseOrderItemId: data.purchaseOrderItemId,
        itemId: purchaseOrderItem.itemId,
        warehouseId: warehouse.id,
        receivedQty: qty.received,
        acceptedQty: qty.accepted,
        rejectedQty: qty.rejected,
        result: data.result,
        lotNo: resolvedLotNo,
        txNo,
      },
      menuName: "자재입고",
    })
    committed.lotNo = resolvedLotNo
      })
      break
    } catch (error) {
      // 같은 (tenant, requestId) 가 다른 트랜잭션에서 먼저 커밋됨 → 내용이 같으면 기존 결과를 돌려주고, 다르면 오류
      if (isUniqueConstraintError(error, ["tenantId", "requestId"])) {
        const existing = await prisma.receivingRequest.findUnique({
          where: { tenantId_requestId: { tenantId, requestId } },
          select: { requestHash: true },
        })
        if (existing && judgeExistingRequest(existing.requestHash, requestHash) === "REPLAY") return { success: true, replayed: true }
        throw new Error(RECEIVING_REQUEST_CONFLICT_MESSAGE)
      }
      const txNoCollision = isUniqueConstraintError(error, ["tenantId", "txNo"])
      const autoLotCollision = lotResolutionMode === "AUTO" &&
        (isUniqueConstraintError(error) ||
          (error instanceof Error && error.message === AUTO_LOT_COLLISION))
      // 비LOT 재고 행(lotId IS NULL) partial unique 충돌로 **확인된** 경우에만 재시도 대상에 추가한다(다른 P2002 는 아님).
      // 트랜잭션 전체가 롤백된 뒤 다시 실행하면 두 번째에는 기존 행을 update 한다. 결과 불명 오류는 어떤 경우에도 재시도하지 않는다.
      const balanceCollision = isNullLotBalanceUniqueError(error)
      const canRetry = !isOutcomeUnknownError(error) && (txNoCollision || autoLotCollision || balanceCollision)

      if (canRetry && attempt < maxAttempts - 1) {
        continue
      }

      if (autoLotCollision) {
        throw new Error("LOT 자동발행 중 번호 충돌이 반복되었습니다. 다시 시도해 주세요.")
      }
      if (txNoCollision) {
        throw new Error("입고거래번호 생성 중 중복이 반복되었습니다. 다시 시도해 주세요.")
      }
      if (balanceCollision) {
        throw new Error(NULL_LOT_BALANCE_CONTENTION_MESSAGE)
      }

      throw error
    }
  }

  if (replayed) return { success: true, replayed: true } // 재전송 — 이번 호출에서는 아무것도 쓰지 않았다

  // ── DB 커밋 완료 이후 ──────────────────────────────────────────────────────
  // 여기서부터의 오류(캐시 재검증 등)는 입고 결과를 뒤집으면 안 된다. 실패로 반환하면 사용자가 다시 저장해
  // 같은 입고가 중복 처리된다. 서버 로그에만 남기고 성공으로 반환한다.
  safeRevalidate(
    revalidatePath,
    [
      "/app/mes/purchase-orders",
      "/app/mes/material-receipt",
      "/app/mes/material/stock",
      "/app/mes/inventory-transactions",
    ],
    "createReceivingInspection"
  )

  // LOT 관리 품목: 커밋 뒤 DB 에서 (tenant, lotNo, 품목)의 Lot 행이 실제로 있는지 다시 확인한 번호만 돌려준다.
  // 이 확인이 실패해도 입고 결과를 뒤집지 않는다(lotNo 없이 성공 반환 → 화면은 번호를 추측하지 않는다).
  let confirmedLotNo: string | undefined
  if (isLotTracked && committed.lotNo) {
    try {
      const persisted = await prisma.lot.findFirst({
        where: { tenantId, lotNo: committed.lotNo, itemId: purchaseOrderItem.itemId },
        select: { id: true },
      })
      if (persisted) confirmedLotNo = committed.lotNo
    } catch (error) {
      console.error("[createReceivingInspection] LOT 확인 실패(입고 결과에는 영향 없음):", error)
    }
  }
  return confirmedLotNo ? { success: true, lotNo: confirmedLotNo } : { success: true }
}
