"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { QuantityInput } from "@/components/ui/quantity-input"
import { Textarea } from "@/components/ui/textarea"
import { formatQuantity } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Trash2, Plus } from "lucide-react"
import {
  createMaterialReturn,
  updateMaterialReturn,
  getMaterialReturnSites,
  getMaterialReturnSuppliers,
  getMaterialReturnPurchaseOrders,
  getMaterialReturnPoItems,
  getMaterialReturnItemOptions,
  getMaterialReturnItemStock,
  type MaterialReturnDetail,
  type MaterialReturnPoItemOption,
  type MaterialReturnStockOption,
} from "@/lib/actions/material-return.actions"

interface ReturnFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  materialReturn?: MaterialReturnDetail | null
  onSuccess: () => void
}

type SiteOption = { id: string; code: string; name: string }
type SupplierOption = { id: string; code: string; name: string }
type PurchaseOrderOption = { id: string; orderNo: string }
type ItemOption = { id: string; code: string; name: string; uom: string; isLotTracked: boolean }

type LineItem = {
  key: string
  purchaseOrderItemId: string | null
  itemId: string
  itemCode: string
  itemName: string
  uom: string
  isLotTracked: boolean
  warehouseId: string
  lotId: string | null
  returnQty: number | undefined
  stockOptions: MaterialReturnStockOption[]
  maxReturnable: number | null
}

let keySeq = 0
function nextKey() {
  keySeq += 1
  return `line-${keySeq}`
}

export function ReturnFormDialog({ open, onOpenChange, mode, materialReturn, onSuccess }: ReturnFormDialogProps) {
  const [isPending, setIsPending] = useState(false)
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)

  const [siteOptions, setSiteOptions] = useState<SiteOption[]>([])
  const [supplierOptions, setSupplierOptions] = useState<SupplierOption[]>([])
  const [poOptions, setPoOptions] = useState<PurchaseOrderOption[]>([])
  const [poItemOptions, setPoItemOptions] = useState<MaterialReturnPoItemOption[]>([])
  const [directItemOptions, setDirectItemOptions] = useState<ItemOption[]>([])

  // §3/§5: 반품 건 전체를 하나의 사업장으로 고정한다. 등록 시 필수 선택하고,
  // 수정에서는 기존 MaterialReturn.siteId를 그대로 쓰며 변경할 수 없다(읽기 전용
  // 표시만 한다) — 한 반품 건에 여러 사업장의 재고가 섞이지 않게 하기 위함이다.
  const [siteId, setSiteId] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [purchaseOrderId, setPurchaseOrderId] = useState("")
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [items, setItems] = useState<LineItem[]>([])

  const [addPoItemId, setAddPoItemId] = useState("")
  const [addDirectItemId, setAddDirectItemId] = useState("")

  // §5/§7: DRAFT만 수정 가능 — 서버가 최종 검증하며 여기는 UI만 좁힌다.
  const isEditable = mode === "create" || materialReturn?.status === "DRAFT"

  useEffect(() => {
    if (!open) return
    setIsLoadingOptions(true)
    Promise.all([getMaterialReturnSites(), getMaterialReturnSuppliers()])
      .then(([sites, suppliers]) => {
        setSiteOptions(sites)
        setSupplierOptions(suppliers)
      })
      .catch((e) => alert(e instanceof Error ? e.message : "옵션을 불러오지 못했습니다."))
      .finally(() => setIsLoadingOptions(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && materialReturn) {
      setSiteId(materialReturn.site.id)
      setSupplierId(materialReturn.supplier.id)
      setPurchaseOrderId(materialReturn.purchaseOrder?.id ?? "")
      setReason(materialReturn.reason ?? "")
      setNote(materialReturn.note ?? "")
      Promise.all(
        materialReturn.items.map(async (it) => {
          const stock = await getMaterialReturnItemStock(it.item.id, materialReturn.site.id).catch(() => [])
          const line: LineItem = {
            key: nextKey(),
            purchaseOrderItemId: it.purchaseOrderItem?.id ?? null,
            itemId: it.item.id,
            itemCode: it.item.code,
            itemName: it.item.name,
            uom: it.item.uom,
            isLotTracked: it.item.isLotTracked,
            warehouseId: it.warehouse.id,
            lotId: it.lot?.id ?? null,
            returnQty: Number(it.returnQty),
            stockOptions: stock,
            maxReturnable: null,
          }
          return line
        })
      ).then(setItems)
    } else {
      setSiteId("")
      setSupplierId("")
      setPurchaseOrderId("")
      setReason("")
      setNote("")
      setItems([])
    }
    setAddPoItemId("")
    setAddDirectItemId("")
  }, [open, mode, materialReturn])

  useEffect(() => {
    if (!open || !supplierId || !siteId) {
      setPoOptions([])
      return
    }
    getMaterialReturnPurchaseOrders(supplierId, siteId)
      .then(setPoOptions)
      .catch(() => setPoOptions([]))
  }, [open, supplierId, siteId])

  useEffect(() => {
    if (!open || !purchaseOrderId) {
      setPoItemOptions([])
      return
    }
    getMaterialReturnPoItems(purchaseOrderId)
      .then(setPoItemOptions)
      .catch(() => setPoItemOptions([]))
  }, [open, purchaseOrderId])

  useEffect(() => {
    if (!open) return
    getMaterialReturnItemOptions()
      .then(setDirectItemOptions)
      .catch(() => setDirectItemOptions([]))
  }, [open])

  const handleClose = () => onOpenChange(false)

  const addFromPoItem = async () => {
    const poItem = poItemOptions.find((p) => p.id === addPoItemId)
    if (!poItem || !siteId) return
    const stock = await getMaterialReturnItemStock(poItem.itemId, siteId).catch(() => [])
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        purchaseOrderItemId: poItem.id,
        itemId: poItem.itemId,
        itemCode: poItem.itemCode,
        itemName: poItem.itemName,
        uom: poItem.uom,
        isLotTracked: poItem.isLotTracked,
        warehouseId: "",
        lotId: null,
        returnQty: undefined,
        stockOptions: stock,
        maxReturnable: poItem.returnableQty,
      },
    ])
    setAddPoItemId("")
  }

  const addDirectItem = async () => {
    const item = directItemOptions.find((i) => i.id === addDirectItemId)
    if (!item || !siteId) return
    const stock = await getMaterialReturnItemStock(item.id, siteId).catch(() => [])
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        purchaseOrderItemId: null,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        uom: item.uom,
        isLotTracked: item.isLotTracked,
        warehouseId: "",
        lotId: null,
        returnQty: undefined,
        stockOptions: stock,
        maxReturnable: null,
      },
    ])
    setAddDirectItemId("")
  }

  const removeItem = (key: string) => setItems((prev) => prev.filter((i) => i.key !== key))

  const updateItem = (key: string, patch: Partial<LineItem>) =>
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  const handleWarehouseChange = (key: string, value: string) => {
    const item = items.find((i) => i.key === key)
    if (!item) return
    if (item.isLotTracked) {
      const [warehouseId, lotId] = value.split("::")
      updateItem(key, { warehouseId, lotId: lotId || null })
    } else {
      updateItem(key, { warehouseId: value, lotId: null })
    }
  }

  const handleSubmit = async () => {
    if (!siteId) {
      alert("사업장을 선택하세요.")
      return
    }
    if (!supplierId) {
      alert("공급사를 선택하세요.")
      return
    }
    if (items.length === 0) {
      alert("반품 품목을 1건 이상 추가하세요.")
      return
    }
    for (const it of items) {
      if (!it.warehouseId) {
        alert(`${it.itemName}: ${it.isLotTracked ? "LOT" : "창고"}을 선택하세요.`)
        return
      }
      if (it.returnQty === undefined || it.returnQty <= 0) {
        alert(`${it.itemName}: 반품수량을 올바르게 입력하세요.`)
        return
      }
    }

    const payload = {
      siteId,
      supplierId,
      purchaseOrderId: purchaseOrderId || null,
      reason: reason.trim() || null,
      note: note.trim() || null,
      items: items.map((it) => ({
        itemId: it.itemId,
        purchaseOrderItemId: it.purchaseOrderItemId,
        lotId: it.lotId,
        warehouseId: it.warehouseId,
        returnQty: it.returnQty as number,
      })),
    }

    setIsPending(true)
    try {
      const result =
        mode === "create"
          ? await createMaterialReturn(payload)
          : await updateMaterialReturn(materialReturn!.id, payload)

      if (!result.ok) {
        alert(result.error ?? "저장 중 오류가 발생했습니다.")
        return
      }
      onSuccess()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{mode === "create" ? "반품 등록" : "반품 수정"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[14px]">사업장 <span className="text-red-500">*</span></Label>
              {mode === "edit" ? (
                <p className="text-[14px] font-medium rounded-md border px-3 py-2 bg-muted/30">
                  {materialReturn?.site.name ?? "—"}
                </p>
              ) : (
                <Select
                  value={siteId}
                  onValueChange={(v) => {
                    setSiteId(v)
                    setPurchaseOrderId("")
                    setItems([])
                  }}
                  disabled={isLoadingOptions}
                >
                  <SelectTrigger className="text-[14px]">
                    <SelectValue placeholder="사업장을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {siteOptions.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-[14px]">[{s.code}] {s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px]">공급사 <span className="text-red-500">*</span></Label>
              <Select
                value={supplierId}
                onValueChange={(v) => {
                  setSupplierId(v)
                  setPurchaseOrderId("")
                  setItems([])
                }}
                disabled={isLoadingOptions || mode === "create" && !siteId}
              >
                <SelectTrigger className="text-[14px]">
                  <SelectValue placeholder={mode === "create" && !siteId ? "사업장을 먼저 선택하세요" : "공급사를 선택하세요"} />
                </SelectTrigger>
                <SelectContent>
                  {supplierOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-[14px]">[{s.code}] {s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">발주 (선택)</Label>
            <Select
              value={purchaseOrderId || "__NONE__"}
              onValueChange={(v) => {
                setPurchaseOrderId(v === "__NONE__" ? "" : v)
                setItems([])
              }}
              disabled={!supplierId || !siteId}
            >
              <SelectTrigger className="text-[14px]">
                <SelectValue placeholder="발주 미연결" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__NONE__" className="text-[14px]">발주 미연결</SelectItem>
                {poOptions.map((po) => (
                  <SelectItem key={po.id} value={po.id} className="text-[14px]">{po.orderNo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">반품사유 (선택)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 규격 불일치" className="text-[14px]" />
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <Label className="text-[14px] font-semibold">반품 품목 <span className="text-red-500">*</span></Label>

            {purchaseOrderId ? (
              <div className="flex gap-2">
                <Select value={addPoItemId} onValueChange={setAddPoItemId}>
                  <SelectTrigger className="text-[14px] flex-1">
                    <SelectValue placeholder="발주품목에서 추가" />
                  </SelectTrigger>
                  <SelectContent>
                    {poItemOptions.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-[14px]" disabled={p.returnableQty <= 0}>
                        [{p.itemCode}] {p.itemName} (반품가능 {formatQuantity(p.returnableQty)} {p.uom})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" onClick={addFromPoItem} disabled={!addPoItemId} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />추가
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Select value={addDirectItemId} onValueChange={setAddDirectItemId} disabled={!siteId}>
                  <SelectTrigger className="text-[14px] flex-1">
                    <SelectValue placeholder={siteId ? "품목 추가" : "사업장을 먼저 선택하세요"} />
                  </SelectTrigger>
                  <SelectContent>
                    {directItemOptions.map((i) => (
                      <SelectItem key={i.id} value={i.id} className="text-[14px]">[{i.code}] {i.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" size="sm" variant="outline" onClick={addDirectItem} disabled={!addDirectItemId || !siteId} className="gap-1">
                  <Plus className="h-3.5 w-3.5" />추가
                </Button>
              </div>
            )}

            {items.length === 0 ? (
              <p className="text-[13px] text-muted-foreground py-3 text-center">추가된 품목이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {items.map((it) => {
                  const selectedStock = it.stockOptions.find(
                    (s) => s.warehouseId === it.warehouseId && (s.lotId ?? null) === (it.lotId ?? null)
                  )
                  const cap =
                    it.maxReturnable !== null && selectedStock
                      ? Math.min(it.maxReturnable, selectedStock.qtyAvailable)
                      : selectedStock?.qtyAvailable ?? it.maxReturnable ?? null

                  return (
                    <div key={it.key} className="rounded-md border p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[14px] font-medium">
                          [{it.itemCode}] {it.itemName}
                          {it.purchaseOrderItemId && <span className="ml-1.5 text-[12px] text-muted-foreground">(발주연결)</span>}
                        </p>
                        <Button type="button" size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive" onClick={() => removeItem(it.key)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[12px] text-muted-foreground">{it.isLotTracked ? "LOT / 창고" : "창고"}</Label>
                          <Select
                            value={it.isLotTracked ? (it.warehouseId ? `${it.warehouseId}::${it.lotId ?? ""}` : "") : it.warehouseId}
                            onValueChange={(v) => handleWarehouseChange(it.key, v)}
                          >
                            <SelectTrigger className="text-[13px] h-8">
                              <SelectValue placeholder="선택" />
                            </SelectTrigger>
                            <SelectContent>
                              {it.stockOptions.length === 0 && (
                                <div className="px-2 py-1.5 text-[12px] text-muted-foreground">가용재고 없음</div>
                              )}
                              {it.stockOptions.map((s) => (
                                <SelectItem
                                  key={`${s.warehouseId}::${s.lotId ?? ""}`}
                                  value={it.isLotTracked ? `${s.warehouseId}::${s.lotId ?? ""}` : s.warehouseId}
                                  className="text-[13px]"
                                >
                                  {s.warehouseName}{s.lotNo ? ` / ${s.lotNo}` : ""} (가용 {formatQuantity(s.qtyAvailable)} {it.uom})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[12px] text-muted-foreground">
                            반품수량{cap !== null && <span> (최대 {formatQuantity(cap)})</span>}
                          </Label>
                          <QuantityInput
                            maxDecimals={6}
                            allowNegative={false}
                            value={it.returnQty}
                            onChange={(v) => updateItem(it.key, { returnQty: v })}
                            className="text-[13px] h-8"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">비고 (선택)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="text-[14px]" rows={3} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending || !isEditable}>
            {isPending ? "저장 중..." : mode === "create" ? "등록" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
