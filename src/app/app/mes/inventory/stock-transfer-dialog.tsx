"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowRightLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  getTransferWarehouses,
  transferInventoryStock,
  type TransferWarehouseOption,
} from "@/lib/actions/inventory.actions"
import { formatQuantity } from "@/lib/utils"

export type StockTransferTarget = {
  balanceId: string
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  siteName: string
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  lotNo: string | null
  qtyOnHand: number
  qtyAvailable: number
}

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function StockTransferDialog({ target }: { target: StockTransferTarget }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [warehouses, setWarehouses] = useState<TransferWarehouseOption[]>([])
  const [toWarehouseId, setToWarehouseId] = useState("")
  const [qty, setQty] = useState<number | undefined>(undefined)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const requestIdRef = useRef(newRequestId())
  const submittingRef = useRef(false)

  useEffect(() => {
    if (!open || warehouses.length > 0) return
    getTransferWarehouses()
      .then(setWarehouses)
      .catch(() => setError("창고 목록을 불러오지 못했습니다."))
  }, [open, warehouses.length])

  const destinations = warehouses.filter((w) => w.id !== target.warehouseId)
  const validQty =
    qty !== undefined && Number.isFinite(qty) && qty > 0 && qty <= target.qtyAvailable
  const canSubmit =
    validQty && !!toWarehouseId && reason.trim().length > 0 && !isPending && !success

  function handleOpenChange(next: boolean) {
    setOpen(next)
    setError(null)
    setSuccess(null)
    if (next) {
      setToWarehouseId("")
      setQty(undefined)
      setReason("")
      requestIdRef.current = newRequestId()
      submittingRef.current = false
    }
  }

  function handleSubmit() {
    if (submittingRef.current) return
    setError(null)
    if (qty === undefined || !Number.isFinite(qty) || qty <= 0) {
      setError("이동수량은 0보다 커야 합니다.")
      return
    }
    if (qty > target.qtyAvailable) {
      setError(`이동수량이 가용재고(${formatQuantity(target.qtyAvailable)})를 초과합니다.`)
      return
    }
    if (!toWarehouseId) {
      setError("도착 창고를 선택하세요.")
      return
    }
    if (!reason.trim()) {
      setError("이동 사유를 입력하세요.")
      return
    }
    submittingRef.current = true
    const confirmedQty = qty
    startTransition(async () => {
      try {
        const result = await transferInventoryStock({
          balanceId: target.balanceId,
          toWarehouseId,
          qty: confirmedQty,
          reason,
          requestId: requestIdRef.current,
        })
        if (!result.success) {
          setError(result.error ?? "재고이동 중 오류가 발생했습니다.")
          submittingRef.current = false
          return
        }
        setSuccess(`TRANSFER ${formatQuantity(result.qty ?? confirmedQty)} 이동 완료 (${result.txNo})`)
        router.refresh()
        window.setTimeout(() => handleOpenChange(false), 800)
      } catch {
        setError("재고이동 중 오류가 발생했습니다.")
        submittingRef.current = false
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-[13px]"
          onClick={(event) => event.stopPropagation()}
        >
          <ArrowRightLeft className="h-3.5 w-3.5" />
          재고이동
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[560px]" onClick={(event) => event.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>재고이동</DialogTitle>
          <DialogDescription>
            출발 창고에서 차감하고 도착 창고에 가산합니다. LOT 번호는 유지되며 TRANSFER 이력이 기록됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3 text-[14px]">
            <Info label="품목" value={`[${target.itemCode}] ${target.itemName}`} />
            <Info label="LOT" value={target.lotNo ?? "비LOT"} />
            <Info label="출발 창고" value={`[${target.warehouseCode}] ${target.warehouseName}`} />
            <Info
              label="가용재고"
              value={`${formatQuantity(target.qtyAvailable)} ${target.uom} (현재고 ${formatQuantity(target.qtyOnHand)})`}
            />
          </div>

          <div>
            <Label className="text-[14px]">도착 창고</Label>
            <Select value={toWarehouseId} onValueChange={setToWarehouseId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="도착 창고 선택" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    [{w.code}] {w.name} · {w.siteName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor={`transfer-qty-${target.balanceId}`} className="text-[14px]">
              이동수량 ({target.uom})
            </Label>
            <QuantityInput
              id={`transfer-qty-${target.balanceId}`}
              value={qty}
              onChange={setQty}
              maxDecimals={6}
              allowNegative={false}
              className="mt-1 text-right tabular-nums"
            />
          </div>

          <div>
            <Label htmlFor={`transfer-reason-${target.balanceId}`} className="text-[14px]">
              이동 사유
            </Label>
            <Textarea
              id={`transfer-reason-${target.balanceId}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="예: 생산라인 공급, 창고 정리"
              className="mt-1 min-h-[80px]"
            />
          </div>

          {error ? <p className="text-[14px] text-red-600">{error}</p> : null}
          {success ? <p className="text-[14px] text-emerald-700">{success}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            취소
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
            {isPending ? "이동 중..." : "이동"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium" title={value}>
        {value}
      </p>
    </div>
  )
}
