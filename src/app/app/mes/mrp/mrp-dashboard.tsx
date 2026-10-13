"use client"

import { useState, useTransition } from "react"
import {
  Calculator,
  Package,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { MrpResultTable } from "./mrp-result-table"
import { AISuggestionPanel } from "./ai-suggestion-panel"
import { runMRP, createPurchaseOrdersFromMRP } from "@/lib/actions/mrp.actions"
import type { MRPResult } from "@/lib/services/mrp.service"

type Plan = {
  id: string
  planNo: string
  status: string
  site?: { name: string }
  items: unknown[]
}

type Props = {
  plans: Plan[]
  tenantId: string
  siteId: string
}

type SummaryCard = {
  label: string
  value: number
  icon: React.ElementType
  color: string
  bg: string
}

export function MrpDashboard({ plans, tenantId, siteId }: Props) {
  const [selectedPlanId, setSelectedPlanId] = useState<string>("")
  const [mrpResult, setMrpResult] = useState<MRPResult | null>(null)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [isCreatingPO, setIsCreatingPO] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const handleRunMRP = () => {
    if (!selectedPlanId) return
    startTransition(async () => {
      try {
        const result = await runMRP(selectedPlanId)
        setMrpResult(result)
        setSelectedItemIds(new Set())
        setMessage(null)
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "MRP 계산 실패")
      }
    })
  }

  const handleToggleItem = (itemId: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  const handleToggleAll = () => {
    if (!mrpResult) return
    const shortageIds = mrpResult.items
      .filter((i) => i.status !== "SUFFICIENT")
      .map((i) => i.itemId)
    if (selectedItemIds.size === shortageIds.length) {
      setSelectedItemIds(new Set())
    } else {
      setSelectedItemIds(new Set(shortageIds))
    }
  }

  const selectedPlan = plans.find((p) => p.id === selectedPlanId)

  const handleBulkOrder = async () => {
    if (!mrpResult || selectedItemIds.size === 0 || !selectedPlan) return
    setIsCreatingPO(true)
    const items = mrpResult.items
      .filter((i) => selectedItemIds.has(i.itemId))
      .map((i) => ({ itemId: i.itemId, qty: i.suggestedOrderQty }))
    const planSiteId = (selectedPlan as any).siteId ?? siteId
    const result = await createPurchaseOrdersFromMRP(items, tenantId, planSiteId)
    setIsCreatingPO(false)
    if (result.success) {
      setMessage(`발주 생성 완료: ${result.orderNo}`)
      setSelectedItemIds(new Set())
    } else {
      setMessage(`오류: ${result.error}`)
    }
  }

  const handleCreateOrder = async (itemId: string, qty: number): Promise<boolean> => {
    if (!selectedPlan) return false
    setIsCreatingPO(true)
    const planSiteId = (selectedPlan as any).siteId ?? siteId
    const result = await createPurchaseOrdersFromMRP([{ itemId, qty }], tenantId, planSiteId)
    setIsCreatingPO(false)
    setMessage(
      result.success
        ? `발주 생성 완료: ${result.orderNo}`
        : `오류: ${result.error}`
    )
    return result.success
  }

  const summaryCards: SummaryCard[] = mrpResult
    ? [
        {
          label: "전체 자재",
          value: mrpResult.items.length,
          icon: Package,
          color: "text-foreground",
          bg: "bg-muted/30",
        },
        {
          label: "충분",
          value: mrpResult.totalSufficientItems,
          icon: CheckCircle,
          color: "text-emerald-600",
          bg: "bg-emerald-50",
        },
        {
          label: "부족",
          value: mrpResult.totalShortageItems,
          icon: AlertTriangle,
          color: "text-amber-600",
          bg: "bg-amber-50",
        },
        {
          label: "긴급",
          value: mrpResult.totalCriticalItems,
          icon: XCircle,
          color: "text-red-600",
          bg: "bg-red-50",
        },
      ]
    : []

  const isMessageSuccess = message?.startsWith("발주 생성 완료")

  return (
    <div className="space-y-6">
      {/* 계획 선택 + 실행 */}
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-sm">
          <label className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
            생산계획 선택
          </label>
          <Select value={selectedPlanId} onValueChange={setSelectedPlanId}>
            <SelectTrigger>
              <SelectValue placeholder="계획을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              {plans.length === 0 && (
                <SelectItem value="__empty__" disabled>
                  확정된 생산계획이 없습니다
                </SelectItem>
              )}
              {plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.planNo} — {p.site?.name ?? ""} ({p.status})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={handleRunMRP}
          disabled={!selectedPlanId || isPending}
          className="gap-2"
        >
          <Calculator className="w-4 h-4" />
          {isPending ? "계산 중..." : "MRP 실행"}
        </Button>
      </div>

      {/* 알림 메시지 */}
      {message && (
        <div
          className={`px-4 py-3 rounded-lg text-[14px] border ${
            isMessageSuccess
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {message}
        </div>
      )}

      {/* 요약 카드 */}
      {mrpResult && (
        <div className="grid grid-cols-4 gap-4">
          {summaryCards.map((card) => (
            <div key={card.label} className={`rounded-xl border p-4 ${card.bg}`}>
              <div className="flex items-center gap-2 mb-1">
                <card.icon className={`w-4 h-4 ${card.color}`} />
                <span className="text-[13px] text-muted-foreground">{card.label}</span>
              </div>
              <p className={`text-[28px] font-bold leading-none ${card.color}`}>
                {card.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* 결과 테이블 */}
      {mrpResult && mrpResult.items.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-semibold">소요량 계산 결과</h2>
            {selectedItemIds.size > 0 && (
              <Button
                onClick={handleBulkOrder}
                disabled={isCreatingPO}
                size="sm"
                className="gap-2"
              >
                <Package className="w-4 h-4" />
                {selectedItemIds.size}개 자재 발주 생성
              </Button>
            )}
          </div>
          <MrpResultTable
            items={mrpResult.items}
            selectedIds={selectedItemIds}
            onToggle={handleToggleItem}
            onToggleAll={handleToggleAll}
          />
          <p className="text-[12px] text-muted-foreground">
            계산 시각: {mrpResult.calculatedAt.toLocaleString("ko-KR")}
          </p>
        </div>
      )}

      {mrpResult && mrpResult.items.length === 0 && (
        <div className="text-center py-12 text-muted-foreground border rounded-xl">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-[15px]">
            BOM이 등록된 품목이 없어 소요량을 계산할 수 없습니다.
          </p>
          <p className="text-[13px] mt-1">BOM에서 자재 구성을 등록해주세요.</p>
        </div>
      )}

      {/* AI 발주 제안 */}
      {mrpResult && (
        <AISuggestionPanel mrpResult={mrpResult} onCreateOrder={handleCreateOrder} />
      )}
    </div>
  )
}
