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
import { ReceivingInspectionResult } from "@prisma/client"
import type { PurchaseOrderRow } from "./columns"
import { formatQuantity } from "@/lib/utils"
import {
  applyReceiptToQuantities,
  describeBatchFailure,
  isRowLocked,
  runReceivingBatch,
  type RowStatusMap,
} from "@/lib/receiving-batch"
import { toUserErrorMessage } from "@/lib/errors/user-error"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReceivingDialogProps {
  purchaseOrder: PurchaseOrderRow
  tenantId: string
  siteId: string
  open: boolean
  onClose: () => void
}

type ItemInspection = {
  itemId: string
  purchaseOrderItemId: string
  itemName: string
  itemCode: string
  isLotTracked: boolean
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
  lotNo: string  // 비워두면 isLotTracked 시 자동생성
}

const RESULT_OPTIONS: { label: string; value: ReceivingInspectionResult }[] = [
  { label: "합격", value: "PASS" },
  { label: "불합격", value: "FAIL" },
  { label: "조건부합격", value: "CONDITIONAL" },
]

// ─── Component ────────────────────────────────────────────────────────────────

type Warehouse = { id: string; code: string; name: string }

export function ReceivingDialog({
  purchaseOrder,
  tenantId,
  siteId,
  open,
  onClose,
}: ReceivingDialogProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  // 품목별 처리 결과(부분 성공 후 재시도 때 이미 입고된 품목을 다시 보내지 않기 위해 기억한다)
  const [rowStatus, setRowStatus] = useState<RowStatusMap>({})
  // state 갱신 전에 들어오는 더블클릭/중복 호출 방어
  const savingRef = useRef(false)
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])

  const [inspections, setInspections] = useState<ItemInspection[]>(() =>
    purchaseOrder.items.map((item) => {
      const orderedQty = Number(item.qty)
      const receivedQty = Number(item.receivedQty)
      const pendingQty = Math.max(0, orderedQty - receivedQty)
      return {
        itemId: item.item.id,
        purchaseOrderItemId: item.id,
        itemName: item.item.name,
        itemCode: item.item.code,
        isLotTracked: item.item.isLotTracked ?? false,
        defaultWarehouseId: item.item.defaultWarehouseId ?? null,
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
      }
    })
  )

  // 창고 로드 후 품목별 기본창고 적용 (site 일치 시 우선, 아니면 첫 창고 fallback)
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

  async function handleSave() {
    if (savingRef.current) return // 저장 중 중복 호출 방어
    const hasPending = inspections.some(
      (ins) => !isRowLocked(rowStatus[ins.purchaseOrderItemId]) && (parseFloat(ins.thisReceivedQty) || 0) > 0
    )
    if (!hasPending) {
      alert("입고수량을 1 이상 입력해 주세요. 이미 처리된 품목은 다시 저장되지 않습니다.")
      return
    }
    // 요청을 보내기 전에 전체를 먼저 검증한다(일부만 처리된 뒤 검증 오류가 나는 상황 방지)
    for (const ins of inspections) {
      if (isRowLocked(rowStatus[ins.purchaseOrderItemId])) continue
      if ((parseFloat(ins.thisReceivedQty) || 0) <= 0) continue
      if (!ins.warehouseId) {
        alert(`[${ins.itemCode}] ${ins.itemName}\n입고 창고를 선택해 주세요.`)
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
        })),
        rowStatus,
        async (row) => {
          const ins = inspections.find((i) => i.purchaseOrderItemId === row.purchaseOrderItemId)!
          return createReceivingInspection({
            purchaseOrderItemId: ins.purchaseOrderItemId,
            purchaseOrderId: purchaseOrder.id,
            warehouseId: ins.warehouseId,
            siteId,
            receivedQty: row.receivedInput,
            acceptedQty: row.acceptedInput,
            rejectedQty: parseFloat(ins.thisRejectedQty) || 0,
            result: ins.result,
            note: ins.note || undefined,
            lotNo: ins.lotNo.trim() || undefined,
          })
        }
      )
      setRowStatus(outcome.statuses)
      // 이번에 성공한 품목은 기입고/미입고 표시를 서버와 같은 규칙으로 즉시 반영한다
      if (outcome.newlyDone.length > 0) {
        setInspections((prev) =>
          prev.map((ins) =>
            outcome.newlyDone.includes(ins.purchaseOrderItemId)
              ? { ...ins, ...applyReceiptToQuantities(ins, parseFloat(ins.thisAcceptedQty) || 0) }
              : ins
          )
        )
        router.refresh()
      }
      if (outcome.allDone) {
        onClose()
        return
      }
      if (outcome.stoppedAt) {
        const failed = inspections.find((i) => i.purchaseOrderItemId === outcome.stoppedAt)
        alert(
          (outcome.newlyDone.length > 0 || Object.values(rowStatus).some((st) => st.state === "done")
            ? "일부 품목은 이미 입고 처리되었습니다. 처리되지 않은 품목만 다시 저장할 수 있습니다.\n\n"
            : "") +
            describeBatchFailure(
              failed ? `[${failed.itemCode}] ${failed.itemName}` : "",
              outcome.statuses[outcome.stoppedAt]
            )
        )
      }
    } catch (error) {
      console.error("입고검사 저장 실패:", error)
      alert(toUserErrorMessage(error, { fallback: "저장 중 오류가 발생했습니다." }))
    } finally {
      savingRef.current = false
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-semibold">
            입고검사 — {purchaseOrder.orderNo}
          </DialogTitle>
        </DialogHeader>

        {/* 창고 안내 — 입고창고는 품목별로 지정 */}
        {warehouses.length === 0 ? (
          <p className="text-[13px] text-destructive">
            이 사이트에 등록된 창고가 없습니다. 로케이션 관리에서 창고를 먼저 추가해주세요.
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            입고 창고는 품목별로 지정합니다. 품목 기본창고가 현재 입고 사이트와 같으면 자동 선택됩니다.
          </p>
        )}

        <div className="space-y-6 py-2">
          {inspections.map((ins, index) => (
            <div key={ins.purchaseOrderItemId} className="rounded-lg border p-4 space-y-4">
              {/* 품목 헤더 */}
              <div className="flex items-start gap-2">
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
                  <p className="text-[13px] text-muted-foreground mt-0.5">
                    발주 {formatQuantity(ins.orderedQty)} / 기입고 {formatQuantity(ins.receivedQty)} / 미입고 {formatQuantity(ins.pendingQty)}
                  </p>
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
              {/* LOT 번호 입력 — LOT 관리 품목만 표시 */}
              {ins.isLotTracked && (
                <div className="space-y-1.5">
                  <Label className="text-[13px]">
                    LOT 번호
                    <span className="ml-1 text-[11px] text-blue-600 font-normal">
                      (미입력 시 자동 발행)
                    </span>
                  </Label>
                  <Input
                    type="text"
                    value={ins.lotNo}
                    onChange={(e) => updateInspection(index, { lotNo: e.target.value })}
                    placeholder="자동 생성 예: 26A01-1 / 공급사 LOT 직접 입력 가능"
                    className="h-8 text-[13px] font-mono"
                  />
                  {!ins.lotNo && (
                    <p className="text-[12px] text-muted-foreground">
                      미입력 시 26A01-1 형식으로 자동 발행됩니다. 공급사 LOT가 있으면 직접 입력할 수 있습니다.
                    </p>
                  )}
                </div>
              )}

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

              {/* 입력 폼 */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">금회 입고수량</Label>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={ins.thisReceivedQty}
                    onChange={(e) => {
                      const v = e.target.value
                      updateInspection(index, {
                        thisReceivedQty: v,
                        thisAcceptedQty: v,
                        thisRejectedQty: "0",
                      })
                    }}
                    className="h-8 text-[13px]"
                  />
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
                        thisRejectedQty: String(Math.max(0, received - accepted)),
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
                    className="h-8 text-[13px] bg-muted/50"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[13px]">판정</Label>
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
                    className="h-8 text-[13px] resize-none"
                    placeholder="비고"
                  />
                </div>
              </div>
              </fieldset>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            취소
          </Button>
          <Button onClick={handleSave} disabled={isLoading || warehouses.length === 0}>
            {isLoading ? "저장 중..." : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
