"use client"

import { useState } from "react"
import { Calculator } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PurchaseSuggestionPanel } from "./purchase-suggestion-panel"

type Plan = {
  id: string
  planNo: string
  status: string
  site?: { name: string }
  items: unknown[]
}

type Props = {
  plans: Plan[]
}

/**
 * 생산계획 MRP — 계획 선택 → MRP 실행 → 부족 자재 목록(수주기준 MRP 와 같은 발주제안 패널) → DRAFT 구매발주 생성.
 * 계산은 서버가 기존 생산계획 MRP 로직 그대로 수행하며, 발주 생성도 수주기준과 같은 서버 파이프라인을 쓴다.
 */
export function MrpDashboard({ plans }: Props) {
  const [selectedPlanId, setSelectedPlanId] = useState<string>("")
  // MRP 실행을 누른 시점의 계획/실행 키 — 선택만 바꾸고 실행하지 않으면 이전 결과를 그대로 둔다
  const [run, setRun] = useState<{ planId: string; key: string } | null>(null)

  const handleRunMRP = () => {
    if (!selectedPlanId) return
    setRun({ planId: selectedPlanId, key: String(Date.now()) })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="max-w-md flex-1">
          <label className="mb-1.5 block text-[13px] font-medium text-muted-foreground">생산계획</label>
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
        <Button onClick={handleRunMRP} disabled={!selectedPlanId} className="gap-2">
          <Calculator className="h-4 w-4" />
          MRP 실행
        </Button>
      </div>

      {run && <PurchaseSuggestionPanel source={{ kind: "PLAN", planId: run.planId }} refreshKey={run.key} />}
    </div>
  )
}
