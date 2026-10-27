"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { createReceivingInspection, getWarehousesForSite } from "@/lib/actions/receiving.actions"
import {
  reserveReceivingLotNumber,
  releaseLotReservation,
  markLotReservationPrinted,
} from "@/lib/actions/lot-reservation.actions"
import { ReceivingInspectionResult } from "@prisma/client"
import type { MaterialReceiptOrderRow } from "./material-receipt-data-table"
import { BarcodePrintDialog } from "@/components/common/barcode/barcode-print-dialog"
import { buildReceiptLabelPlan, type LabelPlan } from "@/lib/label/label-items"
import { formatQuantity } from "@/lib/utils"
import { compareQuantities, isQuantityBalanced, subtractQuantities, toScaledQuantity } from "@/lib/quantity-scale"
import {
  applyReceiptToQuantities,
  describeBatchFailure,
  isRowDone,
  isRowLocked,
  runReceivingBatch,
  type RowStatusMap,
} from "@/lib/receiving-batch"
import { toUserErrorMessage } from "@/lib/errors/user-error"
import { generateReceivingRequestId } from "@/lib/receiving-request-id"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReceivingFormDialogProps {
  purchaseOrder: MaterialReceiptOrderRow
  tenantId: string
  siteId: string
  open: boolean
  onClose: () => void
}

type ItemInspection = {
  purchaseOrderItemId: string
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  isLotTracked: boolean
  lotNumberingType: string
  manualLotPolicy: string
  defaultWarehouseId: string | null
  warehouseId: string   // 품목별 입고창고 (사용자 변경 가능)
  orderedQty: number
  receivedQty: number
  pendingQty: number
  // 입력값
  thisReceivedQty: string
  thisAcceptedQty: string
  thisRejectedQty: string
  result: ReceivingInspectionResult
  note: string
  lotNo: string   // 비워두면 isLotTracked 시 자동생성, 비LOT 품목은 미할당
  // 자동채번 미리보기 상태
  lotReservationId: string | null
  lotReservationExpiresAt: string | null
  isAutoNumbered: boolean   // lotNo가 자동채번 예약으로 채워진 값인지 (true면 lotReservationId가 유효)
  isReserving: boolean      // 자동채번/재채번 버튼 클릭 중 — 중복 클릭 방지용
}

// 품목의 LOT 정책 상태 — 서버(receiving.actions.ts)의 판정 조건과 동일하게 유지
//  - REQUIRED: lotNumberingType이 진짜 MANUAL이거나 manualLotPolicy가 REQUIRED → 직접 입력 필수
//  - DISABLED: manualLotPolicy가 DISABLED → 직접 입력 불가, 자동 발행만 수행
//  - AUTO:     그 외(ALLOWED + 자동번호 방식) → 미입력 시 자동 발행, 직접 입력도 가능
type LotPolicyState = "REQUIRED" | "DISABLED" | "AUTO"

function getLotPolicyState(lotNumberingType: string, manualLotPolicy: string): LotPolicyState {
  if (lotNumberingType === "MANUAL" || manualLotPolicy === "REQUIRED") return "REQUIRED"
  if (manualLotPolicy === "DISABLED") return "DISABLED"
  return "AUTO"
}

const RESULT_OPTIONS: { label: string; value: ReceivingInspectionResult }[] = [
  { label: "합격", value: "PASS" },
  { label: "불합격", value: "FAIL" },
  { label: "조건부합격", value: "CONDITIONAL" },
]

// ─── Component ────────────────────────────────────────────────────────────────

type Warehouse = { id: string; code: string; name: string }

export function ReceivingFormDialog({
  purchaseOrder,
  tenantId,
  siteId,
  open,
  onClose,
}: ReceivingFormDialogProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  // 품목별 처리 결과(부분 성공 후 재시도 때 이미 입고된 품목을 다시 보내지 않기 위해 기억한다)
  const [rowStatus, setRowStatus] = useState<RowStatusMap>({})
  // state 갱신 전에 들어오는 더블클릭/중복 호출 방어
  const savingRef = useRef(false)
  // 하나의 입고 작업(품목)마다 재시도에도 같은 요청 ID 를 유지한다 — 서버 멱등 키. 새 입고(창을 새로 열기)에서만 새로 만든다.
  const requestIdsRef = useRef<Record<string, string>>({})
  function requestIdFor(purchaseOrderItemId: string): string {
    if (!requestIdsRef.current[purchaseOrderItemId]) requestIdsRef.current[purchaseOrderItemId] = generateReceivingRequestId()
    return requestIdsRef.current[purchaseOrderItemId]
  }
  const [printOpen, setPrintOpen] = useState(false)
  // 서버가 입고 성공 응답으로 돌려준 "실제 저장 확인된" LOT 번호(발주품목 id → LOT). 서버가 자동 발행한 LOT 도 여기로 들어온다.
  // 클라이언트가 번호를 만들지 않는다 — 응답에 lotNo 가 없으면 기존처럼 화면에 입력/예약된 번호만 쓴다.
  const serverLotNosRef = useRef<Record<string, string>>({})
  // 입고 확정이 끝난 뒤의 라벨 대상. 이 값이 있어야 실제 인쇄가 가능하다(LOT 가 DB 에 영속화된 뒤에만 QR 라벨 출력).
  const [confirmedLabels, setConfirmedLabels] = useState<LabelPlan | null>(null)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

  const [inspections, setInspections] = useState<ItemInspection[]>(() =>
    purchaseOrder.items.map((oi) => {
      const orderedQty = Number(oi.qty)
      const receivedQty = Number(oi.receivedQty)
      const pendingQty = Math.max(0, orderedQty - receivedQty)
      return {
        purchaseOrderItemId: oi.id,
        itemId: oi.item.id,
        itemCode: oi.item.code,
        itemName: oi.item.name,
        uom: oi.item.uom,
        isLotTracked: oi.item.isLotTracked ?? false,
        lotNumberingType: oi.item.lotNumberingType ?? "DEFAULT",
        manualLotPolicy: oi.item.manualLotPolicy ?? "ALLOWED",
        defaultWarehouseId: oi.item.defaultWarehouseId ?? null,
        warehouseId: "",
        orderedQty,
        receivedQty,
        pendingQty,
        thisReceivedQty: String(pendingQty),
        thisAcceptedQty: String(pendingQty),
        thisRejectedQty: "0",
        result: "PASS",
        note: "",
        lotNo: "",
        lotReservationId: null,
        lotReservationExpiresAt: null,
        isAutoNumbered: false,
        isReserving: false,
      }
    })
  )

  // 창고 로드 후 품목별 기본창고 적용
  //  - 품목의 defaultWarehouseId가 현재 입고 site 창고 목록에 있으면 우선 사용
  //  - 없으면(다른 site이거나 미지정) 현재 site의 첫 번째 창고로 fallback
  useEffect(() => {
    if (!open || !siteId) return
    getWarehousesForSite(siteId).then((whs) => {
      setWarehouses(whs)
      const whIds = new Set(whs.map((w) => w.id))
      const fallback = whs[0]?.id ?? ""
      setInspections((prev) =>
        prev.map((ins) => ({
          ...ins,
          warehouseId:
            ins.defaultWarehouseId && whIds.has(ins.defaultWarehouseId)
              ? ins.defaultWarehouseId
              : fallback,
        })),
      )
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, siteId])

  function updateInspection(index: number, patch: Partial<ItemInspection>) {
    setInspections((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    )
  }

  // 최신 inspections를 effect cleanup(unmount 시점)에서도 참조할 수 있도록 ref로 미러링
  const inspectionsRef = useRef(inspections)
  useEffect(() => {
    inspectionsRef.current = inspections
  }, [inspections])

  function releaseReservationBestEffort(reservationId: string | null) {
    if (!reservationId) return
    releaseLotReservation({ reservationId }).catch(() => {
      // best-effort — 실패해도 서버의 만료(expiresAt) 정책이 최종 안전망
    })
  }

  function releaseAllTrackedReservations(list: ItemInspection[] = inspections) {
    list.forEach((ins) => releaseReservationBestEffort(ins.lotReservationId))
  }

  // 다이얼로그가 언마운트될 때(취소/닫기 외의 경로 포함) 남아있는 예약을 best-effort로 정리
  useEffect(() => {
    return () => {
      releaseAllTrackedReservations(inspectionsRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 발주가 바뀌면(동일 다이얼로그 인스턴스가 재사용되는 경우) 이전 발주의 예약을 정리
  const prevPurchaseOrderIdRef = useRef(purchaseOrder.id)
  useEffect(() => {
    if (prevPurchaseOrderIdRef.current !== purchaseOrder.id) {
      releaseAllTrackedReservations(inspectionsRef.current)
      prevPurchaseOrderIdRef.current = purchaseOrder.id
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseOrder.id])

  function handleCloseDialog() {
    releaseAllTrackedReservations()
    onClose()
  }

  async function handleReserveLotNumber(index: number) {
    const ins = inspections[index]
    if (!ins || ins.isReserving) return
    updateInspection(index, { isReserving: true })
    const result = await reserveReceivingLotNumber({
      purchaseOrderId: purchaseOrder.id,
      purchaseOrderItemId: ins.purchaseOrderItemId,
      previousReservationId: ins.lotReservationId ?? undefined,
    })
    if (result.success) {
      updateInspection(index, {
        lotNo: result.lotNo,
        lotReservationId: result.reservationId,
        lotReservationExpiresAt: result.expiresAt,
        isAutoNumbered: true,
        isReserving: false,
      })
      if (result.previousWasPrinted) {
        alert(
          `[${ins.itemCode}] ${ins.itemName}\n` +
          `이미 라벨이 출력된 LOT 번호는 재사용할 수 없습니다. 새 번호 ${result.lotNo}(으)로 재채번되었습니다.`
        )
      }
    } else {
      updateInspection(index, { isReserving: false })
      alert(`[${ins.itemCode}] ${ins.itemName}\n${result.message}`)
    }
  }

  async function handleConfirm() {
    if (savingRef.current) return // 저장 중 중복 호출 방어
    const isLocked = (id: string) => isRowDone(rowStatus[id])
    const hasAny = inspections.some(
      (ins) => !isLocked(ins.purchaseOrderItemId) && (parseFloat(ins.thisReceivedQty) || 0) > 0
    )
    if (!hasAny) {
      alert("입고수량을 1 이상 입력해주세요. 이미 처리된 품목은 다시 저장되지 않습니다.")
      return
    }

    // 클라이언트 검증
    for (const ins of inspections) {
      if (isLocked(ins.purchaseOrderItemId)) continue
      const received = parseFloat(ins.thisReceivedQty) || 0
      if (received <= 0) continue

      const accepted0 = parseFloat(ins.thisAcceptedQty) || 0
      const rejected0 = parseFloat(ins.thisRejectedQty) || 0
      if (toScaledQuantity(received) === null || toScaledQuantity(accepted0) === null || toScaledQuantity(rejected0) === null) {
        alert(`[${ins.itemCode}] ${ins.itemName}\n수량은 숫자이며 소수점 6자리까지만 입력할 수 있습니다.`)
        return
      }

      if (compareQuantities(received, ins.pendingQty) === 1) {
        alert(
          `[${ins.itemCode}] ${ins.itemName}\n` +
          `입고수량(${formatQuantity(received)})이 잔여수량(${formatQuantity(ins.pendingQty)} ${ins.uom})을 초과합니다.`
        )
        return
      }

      const accepted = parseFloat(ins.thisAcceptedQty) || 0
      const rejected = parseFloat(ins.thisRejectedQty) || 0
      if (!isQuantityBalanced(received, accepted, rejected)) {
        alert(
          `[${ins.itemCode}] ${ins.itemName}\n` +
          `합격수량과 불합격수량의 합은 금회 입고수량과 같아야 합니다.`
        )
        return
      }

      if (!ins.warehouseId) {
        alert(`[${ins.itemCode}] ${ins.itemName}\n입고 창고를 선택해 주세요.`)
        return
      }

      if (
        ins.isLotTracked &&
        getLotPolicyState(ins.lotNumberingType, ins.manualLotPolicy) === "REQUIRED" &&
        !ins.lotNo.trim()
      ) {
        alert(`[${ins.itemCode}] ${ins.itemName}\nLOT 번호를 직접 입력해야 하는 품목입니다.`)
        return
      }
    }

    savingRef.current = true
    setIsLoading(true)
    try {
      const outcome = await runReceivingBatch(
        inspections.map((ins) => ({
          purchaseOrderItemId: ins.purchaseOrderItemId,
          receivedInput: parseFloat(ins.thisReceivedQty) || 0,
          acceptedInput: parseFloat(ins.thisAcceptedQty) || 0,
          requestId: requestIdFor(ins.purchaseOrderItemId),
        })),
        rowStatus,
        async (row) => {
          const ins = inspections.find((i) => i.purchaseOrderItemId === row.purchaseOrderItemId)!
          const response = await createReceivingInspection({
            purchaseOrderItemId: ins.purchaseOrderItemId,
            purchaseOrderId: purchaseOrder.id,
            warehouseId: ins.warehouseId,
            siteId,
            receivedQty: row.receivedInput,
            acceptedQty: row.acceptedInput,
            rejectedQty: parseFloat(ins.thisRejectedQty) || 0,
            requestId: row.requestId,
            result: ins.result,
            note: ins.note || undefined,
            lotNo: ins.lotNo.trim() || undefined,
            lotReservationId: ins.isAutoNumbered ? ins.lotReservationId ?? undefined : undefined,
          })
          if (response.success && response.lotNo) serverLotNosRef.current[ins.purchaseOrderItemId] = response.lotNo
          return response
        }
      )
      setRowStatus(outcome.statuses)
      // 이번에 성공한 품목은 기입고/잔여 표시를 서버와 같은 규칙으로 즉시 반영한다
      if (outcome.newlyDone.length > 0) {
        setInspections((prev) =>
          prev.map((ins) =>
            outcome.newlyDone.includes(ins.purchaseOrderItemId)
              ? { ...ins, ...applyReceiptToQuantities(ins, parseFloat(ins.thisAcceptedQty) || 0) }
              : ins
          )
        )
      }
      // 성공했거나, 실패/결과 불명으로 중단된 경우에도 서버의 최신 기입고 수량을 다시 읽는다
      // (응답을 못 받았지만 서버에서는 처리됐을 수 있다 — 다시 열었을 때 낡은 잔여수량이 보이지 않도록)
      if (outcome.newlyDone.length > 0 || outcome.stoppedAt) router.refresh()
      if (outcome.allDone) {
        releaseAllTrackedReservations()
        // 확정된 LOT 의 QR 라벨을 바로 출력할 수 있게 한다(LOT 번호가 확정된 품목만). 라벨 창을 닫으면 입고 창도 닫힌다.
        const plan = buildReceiptLabelPlan(
          inspections.map((ins) => ({
            itemCode: ins.itemCode,
            itemName: ins.itemName,
            uom: ins.uom,
            isLotTracked: ins.isLotTracked,
            // 서버가 확인해 돌려준 LOT 가 있으면 그 번호(서버 자동 발행 포함), 없으면 화면에 입력/예약된 번호(수동 입력 LOT)
            lotNo: serverLotNosRef.current[ins.purchaseOrderItemId] ?? ins.lotNo,
            receivedQty: parseFloat(ins.thisReceivedQty) || 0,
            acceptedQty: parseFloat(ins.thisAcceptedQty) || 0,
          })),
        )
        if (plan.items.length > 0) {
          setConfirmedLabels(plan)
          setPrintOpen(true)
          return
        }
        onClose()
        return
      }
      if (outcome.stoppedAt) {
        const failed = inspections.find((i) => i.purchaseOrderItemId === outcome.stoppedAt)
        alert(
          (outcome.newlyDone.length > 0 || Object.values(rowStatus).some((st) => st.state === "done")
            ? "일부 품목은 이미 입고 처리되었습니다. 처리되지 않은 품목만 다시 확정할 수 있습니다.\n\n"
            : "") +
            describeBatchFailure(
              failed ? `[${failed.itemCode}] ${failed.itemName}` : "",
              outcome.statuses[outcome.stoppedAt]
            )
        )
      }
    } catch (error) {
      console.error("입고 처리 실패:", error)
      alert(toUserErrorMessage(error, { fallback: "저장 중 오류가 발생했습니다." }))
    } finally {
      savingRef.current = false
      setIsLoading(false)
    }
  }

  // 라벨 출력 대상: 금회 입고수량 > 0인 품목만. LOT 관리 품목은 lotNo가 있어야 출력 가능.
  const printableItems = inspections.filter((ins) => (parseFloat(ins.thisReceivedQty) || 0) > 0)
  const hasMissingLotForPrint = printableItems.some((ins) => ins.isLotTracked && !ins.lotNo.trim())
  // 확정 전 미리보기: LOT 번호가 있는 LOT 관리 품목만 라벨이 되고, 나머지는 사유와 함께 안내한다(버튼을 막지 않는다).
  const previewPlan = buildReceiptLabelPlan(
    printableItems.map((ins) => ({
      itemCode: ins.itemCode,
      itemName: ins.itemName,
      uom: ins.uom,
      isLotTracked: ins.isLotTracked,
      lotNo: ins.lotNo,
      receivedQty: parseFloat(ins.thisReceivedQty) || 0,
      acceptedQty: parseFloat(ins.thisAcceptedQty) || 0,
    })),
  )
  const labelPlan = confirmedLabels ?? previewPlan

  // LOT QR 라벨의 "실제 출력"은 입고 확정(Lot 행 영속화) 이후에만 가능하다. 확정 전에는 미리보기 전용이다.
  const isConfirmedPrint = confirmedLabels !== null

  // "바코드 라벨 출력" 버튼은 미리보기 다이얼로그만 연다 — 이 시점에는 번호를 소모하지 않는다.
  // 실제 번호 소모(printedAt 기록)는 BarcodePrintDialog 내부의 진짜 "인쇄" 버튼을 누를 때
  // onBeforePrint로 전달되는 handleBeforePrint에서만 일어난다. 미리보기만 열고 닫으면
  // 자동채번 번호는 여전히 미출력 상태라 취소 시 재사용 가능하다.
  async function handleBeforePrint(): Promise<{ success: true } | { success: false; message: string }> {
    for (const ins of printableItems) {
      if (ins.isLotTracked && ins.isAutoNumbered && ins.lotReservationId) {
        const result = await markLotReservationPrinted({
          reservationId: ins.lotReservationId,
          purchaseOrderItemId: ins.purchaseOrderItemId,
        })
        if (!result.success) {
          return { success: false, message: `[${ins.itemCode}] ${ins.itemName}\n${result.message}` }
        }
      }
    }
    return { success: true }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCloseDialog()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-semibold">
            입고 처리 — {purchaseOrder.orderNo}
          </DialogTitle>
          <p className="text-[13px] text-muted-foreground mt-1">
            {purchaseOrder.supplier.name} · 발주품목 {purchaseOrder.items.length}건
          </p>
        </DialogHeader>

        {/* 창고 안내 — 입고창고는 품목별로 지정 */}
        {warehouses.length === 0 ? (
          <p className="text-[13px] text-destructive">
            이 사이트에 등록된 창고가 없습니다. 로케이션 관리에서 창고를 먼저 추가해주세요.
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            입고 창고는 품목별로 지정합니다. 품목에 기본 입고창고가 설정되어 있고 현재 입고 사이트와 같으면 자동 선택됩니다.
          </p>
        )}

        <div className="space-y-5 py-2">
          {inspections.map((ins, index) => (
            <div
              key={ins.purchaseOrderItemId}
              className="rounded-lg border bg-card p-4 space-y-4"
            >
              {/* 품목 헤더 */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[15px] font-medium">
                      [{ins.itemCode}] {ins.itemName}
                    </p>
                    {ins.isLotTracked && (
                      <Badge variant="outline" className="text-[11px] border-blue-300 text-blue-700 bg-blue-50 px-1.5 py-0">
                        LOT 관리
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-4 mt-1">
                    <span className="text-[13px] text-muted-foreground">
                      발주 <span className="font-medium text-foreground">{formatQuantity(ins.orderedQty)}</span> {ins.uom}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      기입고 <span className="font-medium text-foreground">{formatQuantity(ins.receivedQty)}</span> {ins.uom}
                    </span>
                    <span className="text-[13px] text-muted-foreground">
                      잔여 <span className={`font-medium ${ins.pendingQty > 0 ? "text-amber-600" : "text-green-600"}`}>
                        {formatQuantity(ins.pendingQty)}
                      </span> {ins.uom}
                    </span>
                  </div>
                  {rowStatus[ins.purchaseOrderItemId]?.state === "done" && (
                    <p className="mt-1 text-[13px] font-medium text-green-700">입고 완료 — 다시 저장되지 않습니다.</p>
                  )}
                  {rowStatus[ins.purchaseOrderItemId]?.state === "failed" && (
                    <p className="mt-1 text-[13px] text-red-600">
                      입고 실패: {toUserErrorMessage((rowStatus[ins.purchaseOrderItemId] as { message: string }).message)}
                    </p>
                  )}
                  {rowStatus[ins.purchaseOrderItemId]?.state === "unknown" && (
                    <p className="mt-1 text-[13px] text-amber-700">
                      {(rowStatus[ins.purchaseOrderItemId] as { message: string }).message}
                    </p>
                  )}
                </div>
              </div>

              {/* 처리 완료/결과 불명 품목은 입력을 잠가 중복 입고를 막는다 */}
              <fieldset
                disabled={isRowLocked(rowStatus[ins.purchaseOrderItemId])}
                className="min-w-0 space-y-4 border-0 p-0"
              >
              {/* LOT 번호 입력 — LOT 관리 품목만 표시, 품목별 LOT 정책에 따라 안내/필수여부/자동채번 버튼이 달라짐 */}
              {ins.isLotTracked && (() => {
                const policy = getLotPolicyState(ins.lotNumberingType, ins.manualLotPolicy)
                const showReserveButton = policy === "AUTO" || policy === "DISABLED"
                return (
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">
                      LOT 번호
                      {policy === "REQUIRED" && (
                        <span className="ml-1 text-destructive">*</span>
                      )}
                      {policy === "AUTO" && !ins.isAutoNumbered && (
                        <span className="ml-1 text-[11px] text-blue-600 font-normal">
                          (미입력 시 자동 발행)
                        </span>
                      )}
                      {policy === "DISABLED" && (
                        <span className="ml-1 text-[11px] text-muted-foreground font-normal">
                          (자동 발행 전용)
                        </span>
                      )}
                      {ins.isAutoNumbered && (
                        <Badge
                          variant="outline"
                          className="ml-1.5 align-middle text-[10px] border-blue-300 text-blue-700 bg-blue-50 px-1.5 py-0"
                        >
                          자동채번
                        </Badge>
                      )}
                    </Label>
                    <div className="flex gap-1.5">
                      <Input
                        type="text"
                        value={ins.lotNo}
                        onChange={(e) => {
                          const newValue = e.target.value
                          if (ins.isAutoNumbered) {
                            // 자동채번된 값을 사용자가 직접 수정 → 기존 예약 해제, 이후 수동입력 LOT로 취급
                            releaseReservationBestEffort(ins.lotReservationId)
                            updateInspection(index, {
                              lotNo: newValue,
                              isAutoNumbered: false,
                              lotReservationId: null,
                              lotReservationExpiresAt: null,
                            })
                            return
                          }
                          updateInspection(index, { lotNo: newValue })
                        }}
                        disabled={policy === "DISABLED"}
                        placeholder={
                          policy === "REQUIRED"
                            ? "공급사 LOT 번호를 입력하세요"
                            : policy === "DISABLED"
                              ? "자동 발행됩니다"
                              : "자동 생성 예: 26A01-1 / 공급사 LOT 직접 입력 가능"
                        }
                        className="h-8 text-[13px] font-mono flex-1"
                      />
                      {showReserveButton && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 shrink-0 text-[12px]"
                          disabled={ins.isReserving}
                          onClick={() => void handleReserveLotNumber(index)}
                        >
                          {ins.isReserving ? "발행 중..." : ins.isAutoNumbered ? "재채번" : "자동채번"}
                        </Button>
                      )}
                    </div>
                    {ins.isAutoNumbered ? (
                      <div className="space-y-0.5">
                        <p className="text-[12px] text-blue-700">
                          예정 LOT: <span className="font-mono font-medium">{ins.lotNo}</span> — 입고 확정 시 이 번호로 저장됩니다.
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          버튼을 누르지 않아도 입고 확정 시 LOT가 자동 발행됩니다.
                        </p>
                      </div>
                    ) : (
                      <>
                        {policy === "REQUIRED" && (
                          <p className="text-[12px] text-destructive">
                            이 품목은 LOT 번호를 직접 입력해야 합니다.
                          </p>
                        )}
                        {policy === "DISABLED" && (
                          <p className="text-[12px] text-muted-foreground">
                            26A01-1 형식으로 자동 발행됩니다. 이 품목은 직접 입력을 지원하지 않습니다.
                          </p>
                        )}
                        {policy === "AUTO" && !ins.lotNo && (
                          <p className="text-[12px] text-muted-foreground">
                            미입력 시 26A01-1 형식으로 자동 발행됩니다. 공급사 LOT가 있으면 직접 입력할 수 있습니다.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )
              })()}

              {/* 품목별 입고창고 */}
              <div className="space-y-1.5">
                <Label className="text-[13px]">
                  입고 창고 <span className="text-destructive">*</span>
                  {ins.defaultWarehouseId &&
                    warehouses.some((w) => w.id === ins.defaultWarehouseId) &&
                    ins.warehouseId === ins.defaultWarehouseId && (
                      <span className="ml-1.5 text-[11px] font-normal text-blue-600">
                        품목 기본창고 적용됨
                      </span>
                    )}
                </Label>
                <Select
                  value={ins.warehouseId}
                  onValueChange={(v) => updateInspection(index, { warehouseId: v })}
                  disabled={warehouses.length === 0}
                >
                  <SelectTrigger className="h-8 text-[13px]">
                    <SelectValue placeholder="창고 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((wh) => (
                      <SelectItem key={wh.id} value={wh.id} className="text-[13px]">
                        [{wh.code}] {wh.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 수량 입력 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">
                    금회 입고수량
                    <span className="ml-1 text-[11px] font-normal text-muted-foreground">
                      (최대 {formatQuantity(ins.pendingQty)} {ins.uom})
                    </span>
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={ins.pendingQty}
                    step={1}
                    value={ins.thisReceivedQty}
                    onChange={(e) => {
                      const v = e.target.value
                      const patch: Partial<ItemInspection> = {
                        thisReceivedQty: v,
                        thisAcceptedQty: v,
                        thisRejectedQty: "0",
                      }
                      if ((parseFloat(v) || 0) <= 0 && ins.lotReservationId) {
                        // 입고수량을 0으로 바꾸면 해당 품목의 자동채번 예약은 더 이상 쓸 곳이 없으므로 정리
                        releaseReservationBestEffort(ins.lotReservationId)
                        patch.lotReservationId = null
                        patch.lotReservationExpiresAt = null
                        patch.isAutoNumbered = false
                      }
                      updateInspection(index, patch)
                    }}
                    className={`h-8 text-[13px] ${compareQuantities(parseFloat(ins.thisReceivedQty) || 0, ins.pendingQty) === 1 ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                  />
                  {compareQuantities(parseFloat(ins.thisReceivedQty) || 0, ins.pendingQty) === 1 && (
                    <p className="text-[12px] text-red-600">
                      잔여수량 {formatQuantity(ins.pendingQty)} {ins.uom} 초과
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">합격수량</Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={ins.thisAcceptedQty}
                    onChange={(e) => {
                      const accepted = parseFloat(e.target.value) || 0
                      const received = parseFloat(ins.thisReceivedQty) || 0
                      updateInspection(index, {
                        thisAcceptedQty: e.target.value,
                        thisRejectedQty: String(Math.max(0, subtractQuantities(received, accepted) ?? 0)),
                      })
                    }}
                    className="h-8 text-[13px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">불합격수량</Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={ins.thisRejectedQty}
                    readOnly
                    className="h-8 text-[13px] bg-muted/50 cursor-not-allowed"
                  />
                </div>
              </div>

              {/* 판정 + 비고 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">검사 판정</Label>
                  <Select
                    value={ins.result}
                    onValueChange={(v) =>
                      updateInspection(index, { result: v as ReceivingInspectionResult })
                    }
                  >
                    <SelectTrigger className="h-8 text-[13px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESULT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-[13px]">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[13px]">비고</Label>
                  <Textarea
                    value={ins.note}
                    onChange={(e) => updateInspection(index, { note: e.target.value })}
                    className="h-8 text-[13px] resize-none min-h-0"
                    placeholder="비고 입력 (선택)"
                  />
                </div>
              </div>
              </fieldset>
            </div>
          ))}
        </div>

        <DialogFooter className="pt-2 flex-wrap gap-2">
          <div className="mr-auto flex flex-col gap-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPrintOpen(true)}
              disabled={printableItems.length === 0}
            >
              LOT 라벨 미리보기
            </Button>
            {hasMissingLotForPrint && (
              <p className="text-[12px] text-muted-foreground">
                LOT 번호가 없는 LOT 관리 품목은 라벨 대상에서 제외됩니다. 번호를 직접 입력하거나 자동채번하세요.
              </p>
            )}
          </div>
          <Button variant="outline" onClick={handleCloseDialog} disabled={isLoading}>
            취소
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              isLoading ||
              warehouses.length === 0 ||
              inspections.some(
                (ins) =>
                  !isRowDone(rowStatus[ins.purchaseOrderItemId]) &&
                  (compareQuantities(parseFloat(ins.thisReceivedQty) || 0, ins.pendingQty) === 1 ||
                    ((parseFloat(ins.thisReceivedQty) || 0) > 0 && !ins.warehouseId)),
              )
            }
          >
            {isLoading ? "처리 중..." : "입고 확정"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 바코드 라벨 출력 다이얼로그 */}
      <BarcodePrintDialog
        open={printOpen}
        onOpenChange={(next) => {
          setPrintOpen(next)
          if (!next && isConfirmedPrint) {
            // 확정 후 라벨 창을 닫으면 입고 창도 닫는다(중복 입고 방지).
            setConfirmedLabels(null)
            onClose()
          }
        }}
        title={`LOT 라벨 — ${purchaseOrder.orderNo}`}
        printBlockedReason={
          isConfirmedPrint
            ? undefined
            : "입고 확정 후 LOT QR 라벨을 출력할 수 있습니다. 지금은 미리보기만 가능합니다(확정 전에 출력한 라벨은 입고 실패/취소 시 현장에 남을 수 있습니다)."
        }
        items={labelPlan.items.map((l) => ({
          labelType: l.labelType, // 원자재 LOT 라벨(RAW_LOT) — 유형 칩 표시
          itemCode: l.itemCode,
          itemName: l.itemName,
          lotNo: l.lotNo,
          dateLabel: l.dateLabel,
          quantity: l.quantity,
          uom: l.uom,
        }))}
        notices={labelPlan.notices}
        testCandidates={isConfirmedPrint ? undefined : previewPlan.candidates}
        onBeforePrint={isConfirmedPrint ? undefined : handleBeforePrint}
      />
    </Dialog>
  )
}
