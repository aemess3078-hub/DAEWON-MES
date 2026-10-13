"use client"

import { useState, useTransition } from "react"
import { Calculator } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  getBomsForItem,
  getWorkOrdersForItem,
  runStandardCost,
  runActualCost,
  fetchCostComparison,
  fetchCostHistory,
} from "@/lib/actions/costing.actions"
import { CostComparisonTable } from "./cost-comparison-table"
import { CostHistoryChart } from "./cost-history-chart"
import type { CostComparison, CostHistoryItem } from "@/lib/services/costing.service"

interface Props {
  items: { id: string; code: string; name: string; itemType: string }[]
}

export function CostingDashboard({ items }: Props) {
  const [selectedItemId, setSelectedItemId] = useState<string>("")
  const [comparison, setComparison] = useState<CostComparison | null>(null)
  const [history, setHistory] = useState<CostHistoryItem[]>([])
  const [isPending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null)

  // Standard cost dialog
  const [stdDialog, setStdDialog] = useState(false)
  const [boms, setBoms] = useState<{ id: string; version: string; status: string; isDefault: boolean }[]>([])
  const [selectedBomId, setSelectedBomId] = useState<string>("")

  // Actual cost dialog
  const [actDialog, setActDialog] = useState(false)
  const [workOrders, setWorkOrders] = useState<{ id: string; orderNo: string; createdAt: Date }[]>([])
  const [selectedWoId, setSelectedWoId] = useState<string>("")

  const loadData = (itemId: string) => {
    startTransition(async () => {
      const [comp, hist] = await Promise.all([
        fetchCostComparison(itemId),
        fetchCostHistory(itemId),
      ])
      setComparison(comp)
      setHistory(hist)
    })
  }

  const handleItemSelect = (itemId: string) => {
    setSelectedItemId(itemId)
    setComparison(null)
    setHistory([])
    loadData(itemId)
  }

  const openStdDialog = async () => {
    if (!selectedItemId) return
    const data = await getBomsForItem(selectedItemId)
    setBoms(data)
    setSelectedBomId(data.find((b) => b.isDefault)?.id ?? data[0]?.id ?? "")
    setStdDialog(true)
  }

  const openActDialog = async () => {
    if (!selectedItemId) return
    const data = await getWorkOrdersForItem(selectedItemId)
    setWorkOrders(data)
    setSelectedWoId(data[0]?.id ?? "")
    setActDialog(true)
  }

  const handleRunStandard = async () => {
    if (!selectedBomId) return
    setStdDialog(false)
    startTransition(async () => {
      const result = await runStandardCost(selectedItemId, selectedBomId)
      if (result.success) {
        setMessage({ text: "표준원가 계산 완료", type: "success" })
        loadData(selectedItemId)
      } else {
        setMessage({ text: result.error ?? "계산 실패", type: "error" })
      }
    })
  }

  const handleRunActual = async () => {
    if (!selectedWoId) return
    setActDialog(false)
    startTransition(async () => {
      const result = await runActualCost(selectedItemId, selectedWoId)
      if (result.success) {
        setMessage({ text: "실제원가 계산 완료", type: "success" })
        loadData(selectedItemId)
      } else {
        setMessage({ text: result.error ?? "계산 실패", type: "error" })
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* 품목 선택 + 액션 */}
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-sm">
          <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">품목 선택</label>
          <Select value={selectedItemId} onValueChange={handleItemSelect}>
            <SelectTrigger>
              <SelectValue placeholder="품목을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name} ({item.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {selectedItemId && (
          <>
            <Button variant="outline" onClick={openStdDialog} disabled={isPending} className="gap-2">
              <Calculator className="w-4 h-4" />
              표준원가 계산
            </Button>
            <Button variant="outline" onClick={openActDialog} disabled={isPending} className="gap-2">
              <Calculator className="w-4 h-4" />
              실제원가 계산
            </Button>
          </>
        )}
      </div>

      {/* 메시지 */}
      {message && (
        <div className={`px-4 py-3 rounded-lg text-[14px] border ${
          message.type === "success"
            ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : "bg-red-50 border-red-200 text-red-700"
        }`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-2 underline text-[12px]">닫기</button>
        </div>
      )}

      {isPending && (
        <div className="text-center py-8 text-muted-foreground text-[14px]">계산 중...</div>
      )}

      {/* 비교 테이블 */}
      {comparison && <CostComparisonTable comparison={comparison} />}

      {/* 추이 차트 */}
      {history.length > 0 && <CostHistoryChart history={history} />}

      {/* BOM 선택 다이얼로그 */}
      <Dialog open={stdDialog} onOpenChange={setStdDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>표준원가 계산 — BOM 선택</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">기준 BOM</label>
            <Select value={selectedBomId} onValueChange={setSelectedBomId}>
              <SelectTrigger>
                <SelectValue placeholder="BOM 선택" />
              </SelectTrigger>
              <SelectContent>
                {boms.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    v{b.version} — {b.status} {b.isDefault ? "(기본)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {boms.length === 0 && (
              <p className="text-[13px] text-muted-foreground mt-2">등록된 BOM이 없습니다.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStdDialog(false)}>취소</Button>
            <Button onClick={handleRunStandard} disabled={!selectedBomId}>계산 실행</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 작업지시 선택 다이얼로그 */}
      <Dialog open={actDialog} onOpenChange={setActDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>실제원가 계산 — 작업지시 선택</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">기준 작업지시</label>
            <Select value={selectedWoId} onValueChange={setSelectedWoId}>
              <SelectTrigger>
                <SelectValue placeholder="작업지시 선택" />
              </SelectTrigger>
              <SelectContent>
                {workOrders.map((wo) => (
                  <SelectItem key={wo.id} value={wo.id}>
                    {wo.orderNo} ({new Date(wo.createdAt).toLocaleDateString("ko-KR")})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {workOrders.length === 0 && (
              <p className="text-[13px] text-muted-foreground mt-2">완료된 작업지시가 없습니다.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActDialog(false)}>취소</Button>
            <Button onClick={handleRunActual} disabled={!selectedWoId}>계산 실행</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
