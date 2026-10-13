"use client"

import { useState } from "react"
import { Bot, AlertTriangle, Loader2, PackagePlus, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getAISuggestion } from "@/lib/actions/mrp.actions"
import type { MRPResult } from "@/lib/services/mrp.service"
import type { AIOrderSuggestion } from "@/lib/services/mrp-ai.service"

const URGENCY_CONFIG = {
  HIGH: { label: "긴급", className: "bg-red-100 text-red-700 border-red-200" },
  MEDIUM: { label: "보통", className: "bg-amber-100 text-amber-700 border-amber-200" },
  LOW: { label: "여유", className: "bg-blue-100 text-blue-700 border-blue-200" },
}

type Props = {
  mrpResult: MRPResult | null
  onCreateOrder: (itemId: string, qty: number) => Promise<boolean>
}

export function AISuggestionPanel({ mrpResult, onCreateOrder }: Props) {
  const [suggestion, setSuggestion] = useState<AIOrderSuggestion | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orderedItemIds, setOrderedItemIds] = useState<Set<string>>(new Set())
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null)

  const handleOrderClick = async (itemId: string, qty: number) => {
    setLoadingItemId(itemId)
    const success = await onCreateOrder(itemId, qty)
    setLoadingItemId(null)
    if (success) {
      setOrderedItemIds((prev) => new Set(prev).add(itemId))
    }
  }

  const handleAnalyze = async () => {
    if (!mrpResult) return
    setIsLoading(true)
    setError(null)
    try {
      const result = await getAISuggestion(mrpResult)
      if (!result) {
        setError("AI 기능이 비활성화되어 있거나 부족 자재가 없습니다.")
      } else {
        setSuggestion(result)
      }
    } catch {
      setError("AI 분석 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  if (!mrpResult) return null

  const hasShortage = mrpResult.items.some((i) => i.status !== "SUFFICIENT")

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 bg-muted/20 border-b">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-[15px] font-semibold">AI 발주 제안</p>
            <p className="text-[12px] text-muted-foreground">MRP 결과 기반 최적 발주 전략 분석</p>
          </div>
        </div>
        <Button
          onClick={handleAnalyze}
          disabled={isLoading || !hasShortage}
          size="sm"
          className="gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              분석 중...
            </>
          ) : (
            <>
              <Bot className="w-4 h-4" />
              AI 분석 요청
            </>
          )}
        </Button>
      </div>

      <div className="p-5">
        {!suggestion && !error && !isLoading && (
          <div className="text-center py-8 text-muted-foreground">
            <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-[14px]">
              {hasShortage
                ? "AI 분석 요청 버튼을 눌러 발주 전략을 분석하세요."
                : "모든 자재가 충분합니다. 발주 제안이 필요하지 않습니다."}
            </p>
          </div>
        )}

        {isLoading && (
          <div className="text-center py-8 text-muted-foreground">
            <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-primary" />
            <p className="text-[14px]">AI가 MRP 결과를 분석 중입니다...</p>
          </div>
        )}

        {error && !isLoading && (
          <div className="flex items-center gap-2 text-amber-600 py-4">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <p className="text-[14px]">{error}</p>
          </div>
        )}

        {suggestion && !isLoading && (
          <div className="space-y-5">
            {/* 요약 */}
            <div className="bg-muted/30 rounded-lg px-4 py-3 text-[14px] leading-relaxed">
              {suggestion.summary}
            </div>

            {/* 리스크 */}
            {suggestion.risks.length > 0 && (
              <div>
                <p className="text-[13px] font-semibold text-muted-foreground mb-2">
                  리스크
                </p>
                <ul className="space-y-1">
                  {suggestion.risks.map((r, i) => (
                    <li key={i} className="text-[13px] text-amber-700 flex items-start gap-1.5">
                      <span className="mt-1 flex-shrink-0">•</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 자재별 제안 카드 */}
            <div>
              <p className="text-[13px] font-semibold text-muted-foreground mb-3">
                자재별 발주 제안
              </p>
              <div className="space-y-3">
                {suggestion.suggestions.map((s, i) => {
                  const urgCfg = URGENCY_CONFIG[s.urgency]
                  const mrpItem = mrpResult.items.find((m) => m.itemCode === s.itemCode)
                  return (
                    <div key={i} className="border rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px] font-semibold">
                            {s.itemCode}
                          </span>
                          <span
                            className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${urgCfg.className}`}
                          >
                            {urgCfg.label}
                          </span>
                        </div>
                        {mrpItem && (() => {
                          const isDone = orderedItemIds.has(mrpItem.itemId)
                          const isItemLoading = loadingItemId === mrpItem.itemId
                          return (
                            <Button
                              size="sm"
                              variant={isDone ? "default" : "outline"}
                              className="h-7 text-[12px] gap-1"
                              disabled={isDone || isItemLoading}
                              onClick={() => handleOrderClick(mrpItem.itemId, s.suggestedQty)}
                            >
                              {isItemLoading ? (
                                <><Loader2 className="w-3.5 h-3.5 animate-spin" />생성 중...</>
                              ) : isDone ? (
                                <><CheckCircle className="w-3.5 h-3.5" />발주 완료</>
                              ) : (
                                <><PackagePlus className="w-3.5 h-3.5" />발주 생성</>
                              )}
                            </Button>
                          )
                        })()}
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[13px]">
                        <div>
                          <span className="text-muted-foreground">제안 수량: </span>
                          <span className="font-medium">{s.suggestedQty}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">공급사: </span>
                          <span className="font-medium">{s.suggestedSupplier ?? "미지정"}</span>
                        </div>
                        {s.orderBy && (
                          <div>
                            <span className="text-muted-foreground">발주 기한: </span>
                            <span className="font-medium text-red-600">{s.orderBy}</span>
                          </div>
                        )}
                        {s.estimatedCost != null && (
                          <div>
                            <span className="text-muted-foreground">예상 비용: </span>
                            <span className="font-medium">
                              {s.estimatedCost.toLocaleString()}원
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="text-[13px] text-muted-foreground">{s.reason}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
