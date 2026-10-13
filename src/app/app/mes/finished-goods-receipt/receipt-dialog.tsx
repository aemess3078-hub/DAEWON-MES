"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { PackagePlus, CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Label } from "@/components/ui/label"
import {
  WorkOrderForReceipt,
  WarehouseWithLocations,
  createFinishedGoodsReceiptAction,
} from "@/lib/actions/finished-goods.actions"
import { formatQuantity } from "@/lib/utils"
import { BarcodeScanInput, type ParsedBarcode } from "@/components/common/barcode/barcode-scan-input"
import { BarcodePrintDialog } from "@/components/common/barcode/barcode-print-dialog"

interface ReceiptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workOrder: WorkOrderForReceipt | null
  warehouses: WarehouseWithLocations[]
  tenantId: string
}

export function ReceiptDialog({
  open,
  onOpenChange,
  workOrder,
  warehouses,
  tenantId,
}: ReceiptDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [warehouseId, setWarehouseId] = useState("")
  const [receiptQty, setReceiptQty] = useState<number | undefined>(undefined)
  const [scanVerified, setScanVerified] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)

  if (!workOrder) return null

  const isSemiFinished = workOrder.item.itemType === "SEMI_FINISHED"
  const receiptLabel = isSemiFinished ? "반제품" : "완제품"
  const availableWarehouses = warehouses.filter((warehouse) => warehouse.siteId === workOrder.site.id)

  function handleScan(parsed: ParsedBarcode) {
    if (parsed.itemCode !== workOrder!.item.code) {
      alert(`스캔한 품목(${parsed.itemCode})이 작업지시 품목(${workOrder!.item.code})과 다릅니다.`)
      return
    }
    setScanVerified(true)
  }

  const handleOpen = (v: boolean) => {
    if (!v) {
      setWarehouseId("")
      setReceiptQty(undefined)
      setScanVerified(false)
    } else {
      setReceiptQty(workOrder.pendingQty)
    }
    onOpenChange(v)
  }

  const handleSubmit = () => {
    const qty = receiptQty
    if (qty === undefined || qty <= 0) {
      alert("입고 수량을 올바르게 입력하세요.")
      return
    }
    if (!warehouseId) {
      alert("로케이션을 선택하세요.")
      return
    }

    startTransition(async () => {
      const res = await createFinishedGoodsReceiptAction(
        {
          workOrderId: workOrder.id,
          itemId: workOrder.item.id,
          siteId: workOrder.site.id,
          warehouseId,
          receiptQty: qty,
        },
        tenantId
      )
      if (!res.ok) {
        alert(res.error ?? "오류가 발생했습니다.")
        return
      }
      router.refresh()
      handleOpen(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[18px]">
            <PackagePlus className="h-5 w-5 text-green-600" />
            {receiptLabel} 입고 처리
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 바코드 스캔 검증 */}
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-muted-foreground">{receiptLabel} 바코드 스캔</p>
            {scanVerified ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-green-50 border border-green-200">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <span className="text-[13px] text-green-700 font-medium">품목 확인 완료 — [{workOrder.item.code}] {workOrder.item.name}</span>
              </div>
            ) : (
              <BarcodeScanInput
                onScan={handleScan}
                placeholder={`${receiptLabel} 바코드를 스캔하여 품목을 확인하세요 (선택)`}
              />
            )}
          </div>

          {/* 작업지시 정보 */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <div className="text-[13px] text-muted-foreground">작업지시</div>
            <div className="text-[15px] font-medium">{workOrder.orderNo}</div>
            <div className="text-[14px] text-muted-foreground">
              [{workOrder.item.code}] {workOrder.item.name}
            </div>
          </div>

          {workOrder.receiptBlockedReason ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[14px] text-amber-800">
              {workOrder.receiptBlockedReason}
            </div>
          ) : null}

          {/* 수량 요약 */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border p-2">
              <div className="text-[13px] text-muted-foreground mb-0.5">
                {workOrder.isWipTracked ? "완료 재공" : "최종공정 양품"}
              </div>
              <div className="text-[16px] font-semibold">{formatQuantity(workOrder.receiptBasisQty)}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-[13px] text-muted-foreground mb-0.5">기입고</div>
              <div className="text-[16px] font-semibold text-muted-foreground">
                {formatQuantity(workOrder.totalReceiptQty)}
              </div>
            </div>
            <div className="rounded-md border border-green-200 bg-green-50 p-2">
              <div className="text-[13px] text-green-700 mb-0.5">입고 가능</div>
              <div className="text-[16px] font-semibold text-green-700">
                {formatQuantity(workOrder.pendingQty)}
              </div>
            </div>
          </div>

          {/* 입고 로케이션 선택 (실제 값은 Warehouse.id) */}
          <div className="space-y-1.5">
            <Label className="text-[14px]">로케이션</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger className="text-[14px]">
                <SelectValue placeholder="로케이션 선택" />
              </SelectTrigger>
              <SelectContent>
                {availableWarehouses.map((wh) => (
                  <SelectItem key={wh.id} value={wh.id} className="text-[14px]">
                    [{wh.code}] {wh.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 입고 수량 */}
          <div className="space-y-1.5">
            <Label className="text-[14px]">
              입고 수량{" "}
              <span className="text-muted-foreground font-normal">
                ({workOrder.item.uom})
              </span>
            </Label>
            <QuantityInput
              maxDecimals={6}
              allowNegative={false}
              value={receiptQty}
              onChange={setReceiptQty}
              className="text-[14px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setPrintOpen(true)}
            disabled={Boolean(workOrder.receiptBlockedReason)}
            className="mr-auto"
          >
            바코드 라벨 출력
          </Button>
          <Button
            variant="outline"
            onClick={() => handleOpen(false)}
            disabled={isPending}
          >
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || Boolean(workOrder.receiptBlockedReason) || !warehouseId || !receiptQty}
            className="gap-1.5"
          >
            <PackagePlus className="h-4 w-4" />
            {isPending ? "처리 중..." : `${receiptLabel} 입고`}
          </Button>
        </DialogFooter>
      </DialogContent>

      <BarcodePrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title={`${receiptLabel} 라벨 — ${workOrder.orderNo}`}
        items={[{
          itemCode: workOrder.item.code,
          itemName: workOrder.item.name,
          quantity: receiptQty ?? workOrder.pendingQty,
          uom: workOrder.item.uom,
        }]}
      />
    </Dialog>
  )
}
