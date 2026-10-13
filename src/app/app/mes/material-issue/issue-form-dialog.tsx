"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Plus, Tag, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getLotStockByItems,
  issueMaterialsForWorkOrder,
  type LotStockOption,
  type MaterialRequirement,
  type WarehouseStockOption,
  type WorkOrderForIssue,
} from "@/lib/actions/material-issue.actions"
import { formatQuantity } from "@/lib/utils"

function isLotManaged(item: MaterialRequirement["item"]): boolean {
  return item.isLotTracked || item.itemType === "SEMI_FINISHED"
}
import { BarcodeScanInput, type ParsedBarcode } from "@/components/common/barcode/barcode-scan-input"
import { BarcodePrintDialog } from "@/components/common/barcode/barcode-print-dialog"

// ── 다중 LOT 분할 행 타입 ─────────────────────────────────────────────────────

type LotSplitRow = {
  key: string
  lotValue: string   // "lotId:warehouseId" composite
  qty: string
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface IssueFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workOrder: WorkOrderForIssue | null
  warehouses: WarehouseStockOption[]
  tenantId: string
}

export function IssueFormDialog({
  open,
  onOpenChange,
  workOrder,
  warehouses,
  tenantId,
}: IssueFormDialogProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [warehouseMap, setWarehouseMap] = useState<Record<string, string>>({})
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({})          // 비LOT 품목 출고수량
  const [lotSplitsMap, setLotSplitsMap] = useState<Record<string, LotSplitRow[]>>({})  // LOT 품목 분할행
  const [lotStockMap, setLotStockMap] = useState<Record<string, LotStockOption[]>>({})
  const [lotLoadingMap, setLotLoadingMap] = useState<Record<string, boolean>>({})
  const [printOpen, setPrintOpen] = useState(false)
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const pendingMaterials = workOrder?.materials.filter((material) => material.pendingQty > 0) ?? []

  // ── LOT 분할 행 헬퍼 ─────────────────────────────────────────────────────────

  const getLotSelectValue = (lotStock: LotStockOption) => `${lotStock.lotId}:${lotStock.warehouseId}`

  const getLotSplits = (itemId: string): LotSplitRow[] =>
    lotSplitsMap[itemId] ?? [{ key: `${itemId}-0`, lotValue: "", qty: "" }]

  const getLotSplitTotal = (itemId: string): number =>
    getLotSplits(itemId).reduce((sum, row) => sum + (Number(row.qty) || 0), 0)

  const getLotFromSplitRow = (itemId: string, row: LotSplitRow): LotStockOption | null => {
    if (!row.lotValue) return null
    return lotStockMap[itemId]?.find((l) => getLotSelectValue(l) === row.lotValue) ?? null
  }

  const addLotSplit = (itemId: string) => {
    setLotSplitsMap((prev) => ({
      ...prev,
      [itemId]: [...(prev[itemId] ?? []), { key: `${itemId}-${Date.now()}`, lotValue: "", qty: "" }],
    }))
  }

  const removeLotSplit = (itemId: string, key: string) => {
    setLotSplitsMap((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] ?? []).filter((r) => r.key !== key),
    }))
  }

  const updateLotSplitRow = (itemId: string, key: string, field: keyof LotSplitRow, value: string) => {
    setLotSplitsMap((prev) => ({
      ...prev,
      [itemId]: (prev[itemId] ?? []).map((r) => r.key === key ? { ...r, [field]: value } : r),
    }))
  }

  // ── 초기화 (Dialog 열릴 때) ──────────────────────────────────────────────────

  useEffect(() => {
    if (!open || !workOrder) return

    const materials = workOrder.materials.filter((m) => m.pendingQty > 0)
    const defaults: Record<string, string> = {}
    const defaultWarehouses: Record<string, string> = {}
    const defaultLotSplits: Record<string, LotSplitRow[]> = {}

    for (const material of materials) {
      if (!isLotManaged(material.item)) {
        defaults[material.itemId] = String(material.pendingQty)
        const stockWh = warehouses.find((wh) => (wh.itemStocks[material.itemId] ?? 0) > 0)
        const rawWh = warehouses.find((wh) => wh.code === "WH-RAW")
        defaultWarehouses[material.itemId] = stockWh?.id ?? rawWh?.id ?? warehouses[0]?.id ?? ""
      } else {
        // LOT 품목: 초기 분할 행 1개 (필요수량 pre-fill)
        defaultLotSplits[material.itemId] = [{
          key: `${material.itemId}-init-0`,
          lotValue: "",
          qty: String(material.pendingQty),
        }]
      }
    }

    setQtyMap(defaults)
    setWarehouseMap(defaultWarehouses)
    setLotSplitsMap(defaultLotSplits)
    setLotStockMap({})
    setLotLoadingMap({})

    for (const material of materials) {
      if (!isLotManaged(material.item)) continue
      const itemId = material.itemId
      setLotLoadingMap((prev) => ({ ...prev, [itemId]: true }))
      getLotStockByItems([itemId], tenantId)
        .then((data) => {
          setLotStockMap((prev) => ({ ...prev, [itemId]: data[itemId] ?? [] }))
        })
        .catch(() => {
          setLotStockMap((prev) => ({ ...prev, [itemId]: [] }))
        })
        .finally(() => {
          setLotLoadingMap((prev) => ({ ...prev, [itemId]: false }))
        })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workOrder?.id])

  if (!workOrder) return null

  const handleWarehouseChange = (itemId: string, nextWarehouseId: string) => {
    setWarehouseMap((prev) => ({ ...prev, [itemId]: nextWarehouseId }))
  }

  function handleScan(parsed: ParsedBarcode) {
    const matched = pendingMaterials.find((material) => material.item.code === parsed.itemCode)
    if (!matched) {
      alert(`품목 코드 "${parsed.itemCode}"가 이 작업지시의 출고 원자재에 없습니다.`)
      return
    }
    setHighlightedItemId(matched.itemId)
    rowRefs.current[matched.itemId]?.scrollIntoView({ behavior: "smooth", block: "center" })
    setTimeout(() => setHighlightedItemId(null), 3000)
  }

  const handleOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      setWarehouseMap({})
      setQtyMap({})
      setLotSplitsMap({})
      setLotStockMap({})
      setLotLoadingMap({})
    }
    onOpenChange(nextOpen)
  }

  function getEffectiveStock(
    material: (typeof pendingMaterials)[number],
    selectedWarehouseId: string,
  ): number {
    const selectedWarehouse = warehouses.find((wh) => wh.id === selectedWarehouseId)
    return selectedWarehouse?.itemStocks[material.itemId] ?? 0
  }

  // ── 제출 ─────────────────────────────────────────────────────────────────────

  const handleSubmit = () => {
    // 비LOT 창고 누락 검증
    const missingWarehouses = pendingMaterials.filter(
      (material) =>
        !isLotManaged(material.item) &&
        Number(qtyMap[material.itemId] ?? 0) > 0 &&
        !warehouseMap[material.itemId],
    )
    if (missingWarehouses.length > 0) {
      alert(`다음 원자재의 출고 창고를 선택해 주세요.\n${missingWarehouses.map((m) => m.item.name).join("\n")}`)
      return
    }

    // LOT 분할행 검증
    for (const material of pendingMaterials) {
      if (!isLotManaged(material.item)) continue
      const splits = getLotSplits(material.itemId)
      const total = getLotSplitTotal(material.itemId)
      if (total === 0) continue

      // 모든 수량 > 0 행에 LOT 선택 필요
      const missingSplitLot = splits.some((r) => Number(r.qty) > 0 && !r.lotValue)
      if (missingSplitLot) {
        alert(`${material.item.name}: 수량이 입력된 LOT 행에 LOT를 선택해 주세요.`)
        return
      }

      // 중복 LOT 차단: 창고가 달라도 같은 lotId는 한 자재 내 1회만 허용
      const selectedLotIds = splits
        .filter((r) => r.lotValue && Number(r.qty) > 0)
        .map((r) => getLotFromSplitRow(material.itemId, r)?.lotId)
        .filter((lotId): lotId is string => Boolean(lotId))
      if (new Set(selectedLotIds).size !== selectedLotIds.length) {
        alert(`${material.item.name}: 동일한 LOT를 중복 선택할 수 없습니다.`)
        return
      }

      // 각 분할행 재고 초과 검증
      for (const row of splits) {
        if (!row.lotValue || !(Number(row.qty) > 0)) continue
        const lot = getLotFromSplitRow(material.itemId, row)
        if (lot && Number(row.qty) > lot.qtyAvailable) {
          alert(`${material.item.name} / ${lot.lotNo}: 출고수량(${row.qty})이 LOT 가용재고(${lot.qtyAvailable})를 초과합니다.`)
          return
        }
      }
    }

    try {
      const items = pendingMaterials.map((material) => {
        if (isLotManaged(material.item)) {
          const activeSplits = getLotSplits(material.itemId).filter(
            (r) => r.lotValue && Number(r.qty) > 0
          )
          const lots = activeSplits.map((row) => {
            const lotStock = getLotFromSplitRow(material.itemId, row)!
            return {
              lotId: lotStock.lotId,
              warehouseId: lotStock.warehouseId,
              quantity: Number(row.qty),
            }
          })
          const totalIssueQty = lots.reduce((s, l) => s + l.quantity, 0)
          return {
            itemId: material.itemId,
            issueQty: totalIssueQty,
            lots,
            requiredQty: material.requiredQty,
            reservationId: material.reservationId,
          }
        }

        const issueQty = Number(qtyMap[material.itemId] ?? 0)
        const selectedWarehouseId = warehouseMap[material.itemId] ?? ""
        const stock = getEffectiveStock(material, selectedWarehouseId)
        if (issueQty > stock) {
          throw new Error(`${material.item.name}: 출고 수량(${issueQty})이 재고(${stock})를 초과합니다.`)
        }
        return {
          itemId: material.itemId,
          warehouseId: selectedWarehouseId,
          issueQty,
          requiredQty: material.requiredQty,
          reservationId: material.reservationId,
        }
      })

      startTransition(async () => {
        const result = await issueMaterialsForWorkOrder(
          { workOrderId: workOrder.id, siteId: workOrder.site.id, items },
          tenantId,
        )
        if (!result.ok) {
          alert(result.error ?? "출고 처리 중 오류가 발생했습니다.")
          return
        }
        router.refresh()
        handleOpen(false)
      })
    } catch (error) {
      alert(error instanceof Error ? error.message : "입력값을 확인해 주세요.")
    }
  }

  // ── 재고 초과 경고 ───────────────────────────────────────────────────────────

  const hasOverStock = pendingMaterials.some((material) => {
    if (isLotManaged(material.item)) {
      return getLotSplits(material.itemId).some((row) => {
        const lot = getLotFromSplitRow(material.itemId, row)
        return lot != null && Number(row.qty) > lot.qtyAvailable
      })
    }
    const selectedWarehouseId = warehouseMap[material.itemId] ?? ""
    return getEffectiveStock(material, selectedWarehouseId) < Number(qtyMap[material.itemId] ?? 0)
  })

  // ── 연결 LOT 요약 (blue box) ─────────────────────────────────────────────────

  const selectedLotSummaries = pendingMaterials.flatMap((material) => {
    if (!isLotManaged(material.item)) return []
    return getLotSplits(material.itemId)
      .filter((row) => row.lotValue && Number(row.qty) > 0)
      .map((row) => {
        const lot = getLotFromSplitRow(material.itemId, row)
        if (!lot) return null
        return {
          itemName: material.item.name,
          lotNo: lot.lotNo,
          warehouseName: `[${lot.warehouseCode}] ${lot.warehouseName}`,
          qty: Number(row.qty),
          unit: lot.unit,
        }
      })
      .filter((s): s is { itemName: string; lotNo: string; warehouseName: string; qty: number; unit: string } => s !== null)
  })

  // ── 렌더 ─────────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">자재 LOT 출고 처리</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto py-2">
          <div className="space-y-1">
            <p className="text-[13px] font-medium text-muted-foreground">바코드 스캔</p>
            <BarcodeScanInput
              onScan={handleScan}
              placeholder="자재 바코드를 스캔하면 해당 행으로 이동합니다."
            />
          </div>

          <div className="rounded-lg bg-muted/50 p-3">
            <div className="grid grid-cols-1 gap-3 text-[14px] md:grid-cols-3">
              <div>
                <p className="text-[13px] text-muted-foreground">작업지시번호</p>
                <p className="font-mono font-medium">{workOrder.orderNo}</p>
              </div>
              <div>
                <p className="text-[13px] text-muted-foreground">제조번호</p>
                <p className="font-mono font-medium text-blue-700">{workOrder.manufacturingNo ?? "-"}</p>
              </div>
              <div>
                <p className="text-[13px] text-muted-foreground">가공 제품명</p>
                <p className="font-medium">[{workOrder.item.code}] {workOrder.item.name}</p>
              </div>
            </div>
            <div className="mt-2 text-[13px] text-muted-foreground">
              계획수량: {formatQuantity(workOrder.plannedQty)} | {workOrder.site.name}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[14px] font-medium">출고 자재 목록</div>
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              현재 출고 가능한 LOT만 표시됩니다. LOT 미지정 재고는 LOT 추적성 기준상
              출고 대상에서 제외되며, 관리자에게 재고 정리를 요청하세요.
            </p>

            {pendingMaterials.length === 0 ? (
              <p className="py-2 text-[14px] text-muted-foreground">
                모든 원자재가 이미 출고되었습니다.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <div className="grid min-w-[940px] grid-cols-[minmax(260px,1fr)_170px_90px_90px_90px_110px_130px] border-b bg-muted/30">
                  <div className="px-3 py-2 text-[13px] font-medium text-muted-foreground">소재명 / 규격 / LOT</div>
                  <div className="px-3 py-2 text-[13px] font-medium text-muted-foreground">출고창고</div>
                  {["필요수량", "재고", "기출고", "출고수량", "연결 LOT"].map((header) => (
                    <div key={header} className="px-3 py-2 text-right text-[13px] font-medium text-muted-foreground">
                      {header}
                    </div>
                  ))}
                </div>

                {pendingMaterials.map((material) => {
                  const lotOptions = lotStockMap[material.itemId] ?? []
                  const lotLoading = lotLoadingMap[material.itemId] ?? false
                  const isHighlighted = highlightedItemId === material.itemId

                  if (isLotManaged(material.item)) {
                    // ── LOT 관리 품목 ─────────────────────────────────────────
                    const splits = getLotSplits(material.itemId)
                    const splitTotal = getLotSplitTotal(material.itemId)
                    const isTotalMismatch = splitTotal > 0 && Math.abs(splitTotal - material.pendingQty) > 0.001
                    const isAnyOverStock = splits.some((row) => {
                      const lot = getLotFromSplitRow(material.itemId, row)
                      return lot != null && Number(row.qty) > lot.qtyAvailable
                    })
                    const connectedLots = splits
                      .filter((r) => r.lotValue)
                      .map((r) => getLotFromSplitRow(material.itemId, r)?.lotNo)
                      .filter(Boolean)
                      .join(", ")

                    return (
                      <div
                        key={material.itemId}
                        ref={(el) => { rowRefs.current[material.itemId] = el }}
                        className={`grid min-w-[940px] grid-cols-[minmax(260px,1fr)_170px_90px_90px_90px_110px_130px] items-start border-b transition-colors duration-300 last:border-0 ${
                          isHighlighted ? "border-green-300 bg-green-50" : "hover:bg-muted/10"
                        }`}
                      >
                        {/* 소재명 + LOT 분할 행 */}
                        <div className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[14px] font-medium">{material.item.name}</span>
                            <span className="inline-flex items-center gap-0.5 rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[11px] font-medium text-blue-700">
                              <Tag className="h-3 w-3" />
                              LOT
                            </span>
                          </div>
                          <div className="mt-0.5 text-[13px] text-muted-foreground">
                            <span className="font-mono">{material.item.code}</span>
                            <span className="mx-1">/</span>
                            <span>{material.item.spec ?? "규격 없음"}</span>
                            <span className="mx-1">/</span>
                            <span>{material.item.uom}</span>
                          </div>

                          {/* LOT 분할 행 목록 */}
                          <div className="mt-2 space-y-1.5">
                            {splits.map((row) => {
                              const rowLot = getLotFromSplitRow(material.itemId, row)
                              const rowQty = Number(row.qty) || 0
                              const rowOverStock = rowLot != null && rowQty > rowLot.qtyAvailable
                              const rowLotMissing = rowQty > 0 && !row.lotValue
                              // 이 품목의 다른 행에서 이미 선택된 lotId 세트
                              const usedLotIds = new Set(
                                splits
                                  .filter((r) => r.key !== row.key && r.lotValue)
                                  .map((r) => getLotFromSplitRow(material.itemId, r)?.lotId)
                                  .filter((lotId): lotId is string => Boolean(lotId))
                              )

                              return (
                                <div key={row.key} className="flex items-start gap-1.5">
                                  {/* LOT 선택 */}
                                  <div className="flex-1">
                                    <Select
                                      value={row.lotValue}
                                      onValueChange={(v) => updateLotSplitRow(material.itemId, row.key, "lotValue", v)}
                                      disabled={lotLoading}
                                    >
                                      <SelectTrigger className={`h-8 w-full text-[13px] ${rowLotMissing ? "border-amber-400 ring-amber-200" : ""}`}>
                                        <SelectValue placeholder={lotLoading ? "조회 중..." : "LOT 선택"} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {lotOptions.length > 0 ? (
                                          lotOptions
                                            .filter((l) => {
                                              const val = getLotSelectValue(l)
                                              return val === row.lotValue || !usedLotIds.has(l.lotId)
                                            })
                                            .map((lotStock) => (
                                              <SelectItem key={getLotSelectValue(lotStock)} value={getLotSelectValue(lotStock)} className="text-[13px]">
                                                {lotStock.lotNo} / [{lotStock.warehouseCode}] / 가용 {formatQuantity(lotStock.qtyAvailable)} {lotStock.unit}
                                              </SelectItem>
                                            ))
                                        ) : (
                                          <div className="px-2 py-1.5 text-[13px] text-muted-foreground">
                                            {lotLoading ? "조회 중..." : "가용 LOT 없음"}
                                          </div>
                                        )}
                                      </SelectContent>
                                    </Select>
                                    {rowLot && (
                                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                                        [{rowLot.warehouseCode}] {rowLot.warehouseName} · 가용 {formatQuantity(rowLot.qtyAvailable)}
                                      </p>
                                    )}
                                  </div>

                                  {/* 수량 입력 */}
                                  <div className="w-24">
                                    <Input
                                      type="number"
                                      min={0}
                                      step={0.001}
                                      value={row.qty}
                                      onChange={(e) => updateLotSplitRow(material.itemId, row.key, "qty", e.target.value)}
                                      className={`h-8 text-right text-[13px] ${rowOverStock ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                                      placeholder="수량"
                                    />
                                    {rowOverStock && (
                                      <p className="mt-0.5 text-[11px] text-red-600 flex items-center gap-0.5">
                                        <AlertCircle className="h-3 w-3" />재고 초과
                                      </p>
                                    )}
                                  </div>

                                  {/* 행 삭제 버튼 */}
                                  {splits.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeLotSplit(material.itemId, row.key)}
                                      className="mt-1 text-muted-foreground hover:text-red-500 transition-colors"
                                      title="행 삭제"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>
                              )
                            })}

                            {/* LOT 추가 버튼 */}
                            <button
                              type="button"
                              onClick={() => addLotSplit(material.itemId)}
                              className="flex items-center gap-1 text-[12px] text-blue-600 hover:text-blue-800 transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              LOT 추가
                            </button>

                            {/* 합계 표시 */}
                            {splitTotal > 0 && (
                              <p className={`text-[12px] font-medium ${isTotalMismatch ? "text-amber-700" : "text-emerald-700"}`}>
                                합계: {formatQuantity(splitTotal)} / 필요 {formatQuantity(material.pendingQty)} {material.item.uom}
                                {isTotalMismatch && " ⚠ 불일치"}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* 출고창고 */}
                        <div className="px-3 py-2.5">
                          <div className="rounded-md border bg-muted/30 px-2.5 py-2 text-[13px]">
                            <div className="text-muted-foreground">LOT 선택으로 자동 지정</div>
                          </div>
                        </div>

                        {/* 필요수량 */}
                        <div className="px-3 py-2.5 text-right text-[14px]">
                          {formatQuantity(material.requiredQty)}
                        </div>

                        {/* 재고 (LOT별 — 분할 행에서 확인) */}
                        <div className="px-3 py-2.5 text-right">
                          <span className="text-[13px] text-muted-foreground">LOT별</span>
                        </div>

                        {/* 기출고 */}
                        <div className="px-3 py-2.5 text-right text-[14px] text-muted-foreground">
                          {formatQuantity(material.issuedQty)}
                        </div>

                        {/* 출고수량 (합계, 읽기 전용) */}
                        <div className="px-3 py-2.5 text-right">
                          <span className={`text-[14px] font-medium ${isAnyOverStock ? "text-red-600" : isTotalMismatch && splitTotal > 0 ? "text-amber-700" : ""}`}>
                            {splitTotal > 0 ? formatQuantity(splitTotal) : "-"}
                          </span>
                          {splitTotal > 0 && <div className="text-[11px] text-muted-foreground">LOT별 합산</div>}
                        </div>

                        {/* 연결 LOT */}
                        <div className="px-3 py-2.5 text-right">
                          <span className="font-mono text-[12px] text-blue-700 leading-5 break-all">
                            {connectedLots || "-"}
                          </span>
                        </div>
                      </div>
                    )
                  }

                  // ── 비LOT 품목 (기존 동작 유지) ──────────────────────────────
                  const selectedWarehouseId = warehouseMap[material.itemId] ?? ""
                  const stock = getEffectiveStock(material, selectedWarehouseId)
                  const issueQty = Number(qtyMap[material.itemId] ?? 0)
                  const isOverStock = issueQty > stock
                  const warehouseMissing = issueQty > 0 && !selectedWarehouseId

                  return (
                    <div
                      key={material.itemId}
                      ref={(el) => { rowRefs.current[material.itemId] = el }}
                      className={`grid min-w-[940px] grid-cols-[minmax(260px,1fr)_170px_90px_90px_90px_110px_130px] items-start border-b transition-colors duration-300 last:border-0 ${
                        isHighlighted ? "border-green-300 bg-green-50" : "hover:bg-muted/10"
                      }`}
                    >
                      <div className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[14px] font-medium">{material.item.name}</span>
                        </div>
                        <div className="mt-0.5 text-[13px] text-muted-foreground">
                          <span className="font-mono">{material.item.code}</span>
                          <span className="mx-1">/</span>
                          <span>{material.item.spec ?? "규격 없음"}</span>
                          <span className="mx-1">/</span>
                          <span>{material.item.uom}</span>
                        </div>
                      </div>

                      <div className="px-3 py-2.5">
                        <p className="mb-1 text-[13px] text-muted-foreground">
                          기본 출고창고가 자동 선택되며 필요 시 변경할 수 있습니다.
                        </p>
                        <Select
                          value={selectedWarehouseId}
                          onValueChange={(value) => handleWarehouseChange(material.itemId, value)}
                        >
                          <SelectTrigger className={`h-8 text-[13px] ${warehouseMissing ? "border-amber-400 ring-amber-200" : ""}`}>
                            <SelectValue placeholder="창고 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {warehouses.map((warehouse) => (
                              <SelectItem key={warehouse.id} value={warehouse.id} className="text-[13px]">
                                [{warehouse.code}] {warehouse.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {warehouseMissing && (
                          <p className="mt-1 text-[12px] text-amber-600">출고창고를 선택해 주세요.</p>
                        )}
                      </div>

                      <div className="px-3 py-2.5 text-right text-[14px]">
                        {formatQuantity(material.requiredQty)}
                      </div>
                      <div className={`px-3 py-2.5 text-right text-[14px] font-medium ${stock < material.pendingQty ? "text-red-600" : "text-green-700"}`}>
                        {formatQuantity(stock)}
                      </div>
                      <div className="px-3 py-2.5 text-right text-[14px] text-muted-foreground">
                        {formatQuantity(material.issuedQty)}
                      </div>
                      <div className="px-3 py-2.5">
                        <div className="relative">
                          <Input
                            type="number"
                            min={0}
                            max={material.pendingQty}
                            step={0.001}
                            value={qtyMap[material.itemId] ?? ""}
                            onChange={(event) =>
                              setQtyMap((prev) => ({ ...prev, [material.itemId]: event.target.value }))
                            }
                            className={`h-8 pr-2 text-right text-[13px] ${isOverStock ? "border-red-400 focus-visible:ring-red-400" : ""}`}
                          />
                          {isOverStock && (
                            <AlertCircle className="absolute right-7 top-2 h-3.5 w-3.5 text-red-500" />
                          )}
                        </div>
                      </div>
                      <div className="px-3 py-2.5 text-right">
                        <span className="font-mono text-[13px] text-blue-700">-</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {selectedLotSummaries.length > 0 && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
              <p className="text-[13px] font-medium text-blue-800">
                제조번호에 연결될 자재 LOT
              </p>
              <div className="mt-2 grid gap-1 text-[13px] text-blue-900 md:grid-cols-2">
                {selectedLotSummaries.map((summary, idx) => (
                  <div key={`${summary.itemName}-${summary.lotNo}-${idx}`}>
                    {summary.itemName} / <span className="font-mono">{summary.lotNo}</span> / {summary.warehouseName} / {formatQuantity(summary.qty)} {summary.unit}
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasOverStock && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-[13px] text-amber-800">
                일부 원자재의 선택 창고 또는 LOT 재고가 출고 수량보다 부족합니다.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setPrintOpen(true)}
            className="mr-auto"
            disabled={pendingMaterials.length === 0}
          >
            바코드 라벨 출력
          </Button>
          <Button variant="outline" onClick={() => handleOpen(false)} disabled={isPending}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || pendingMaterials.length === 0}
          >
            {isPending ? "처리 중..." : "출고 처리"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <BarcodePrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        title={`출고 자재 라벨 - ${workOrder.orderNo}`}
        items={pendingMaterials.map((material) => ({
          itemCode: material.item.code,
          itemName: material.item.name,
          quantity: isLotManaged(material.item)
            ? getLotSplitTotal(material.itemId)
            : Number(qtyMap[material.itemId] ?? material.pendingQty),
          uom: material.item.uom,
        }))}
      />
    </Dialog>
  )
}
