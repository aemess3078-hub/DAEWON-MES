"use client"

import { X, Clock, Cog } from "lucide-react"
import { RoutingWithDetails } from "@/lib/actions/routing.actions"
import { Button } from "@/components/ui/button"

const ROUTING_STATUS_CONFIG = {
  ACTIVE:   { label: "활성",   className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  DRAFT:    { label: "초안",   className: "bg-muted text-muted-foreground border-border" },
  INACTIVE: { label: "비활성", className: "bg-red-50 text-red-600 border-red-200" },
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  FINISHED:      "완제품",
  SEMI_FINISHED: "반제품",
  RAW_MATERIAL:  "원자재",
  CONSUMABLE:    "소모품",
}

type Props = {
  routing: RoutingWithDetails
  onClose: () => void
}

export function RoutingDetailPanel({ routing, onClose }: Props) {
  const statusCfg =
    ROUTING_STATUS_CONFIG[routing.status as keyof typeof ROUTING_STATUS_CONFIG] ??
    ROUTING_STATUS_CONFIG.DRAFT

  const linkedItems = routing.items ?? []
  const isCommon = routing.scope === "COMMON"
  const totalTime = routing.operations.reduce(
    (sum, op) => sum + Number(op.standardTime),
    0
  )

  return (
    <div className="border rounded-xl overflow-hidden shadow-sm animate-in slide-in-from-top-2 duration-200">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-4 bg-muted/20 border-b">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[15px] font-bold text-primary">{routing.code}</span>
            <span className="text-[15px] font-semibold">{routing.name}</span>
            <span
              className={`text-[12px] px-2 py-0.5 rounded-full border font-medium ${statusCfg.className}`}
            >
              {statusCfg.label}
            </span>
            <span className="text-[12px] text-muted-foreground border rounded px-1.5 py-0.5">
              v{routing.version}
            </span>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${
                isCommon
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {isCommon ? "범용" : "품목 전용"}
            </span>
          </div>
          {isCommon ? (
            <p className="text-[13px] text-muted-foreground">모든 완제품·반제품에서 선택 가능</p>
          ) : linkedItems.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {linkedItems.map((li) => (
                <p key={li.id} className="text-[13px] text-muted-foreground">
                  <span className="font-mono">{li.item.code}</span>
                  {" "}·{" "}
                  {li.item.name}
                  {" "}
                  <span className="text-[12px]">
                    ({ITEM_TYPE_LABELS[li.item.itemType] ?? li.item.itemType})
                  </span>
                  {li.isDefault && (
                    <span className="ml-1 text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                      기본
                    </span>
                  )}
                </p>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-destructive">연결된 품목이 없습니다.</p>
          )}
        </div>

        {/* 요약 뱃지 */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[13px] font-medium bg-blue-50 text-blue-700 border-blue-200">
            <Cog className="w-3.5 h-3.5" />
            공정 {routing.operations.length}단계
          </div>
          {totalTime > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[13px] font-medium bg-amber-50 text-amber-700 border-amber-200">
              <Clock className="w-3.5 h-3.5" />
              총 {totalTime.toLocaleString("ko-KR")}분
            </div>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 ml-2" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 공정 목록 테이블 */}
      {routing.operations.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b bg-muted/10">
                <th className="text-left px-5 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide w-14">
                  순서
                </th>
                <th className="text-left px-4 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                  공정코드
                </th>
                <th className="text-left px-4 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                  공정명
                </th>
                <th className="text-left px-4 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                  작업장
                </th>
                <th className="text-right px-5 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">
                  표준 소요시간
                </th>
              </tr>
            </thead>
            <tbody>
              {routing.operations.map((op, idx) => (
                <tr
                  key={op.id}
                  className={`border-b last:border-0 transition-colors hover:brightness-95 ${
                    idx % 2 === 0 ? "bg-background" : "bg-muted/5"
                  }`}
                >
                  <td className="px-5 py-3 text-center">
                    <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[12px] font-semibold text-muted-foreground mx-auto">
                      {op.seq}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[13px] font-medium text-muted-foreground">
                      {op.operationCode}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{op.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-medium border bg-slate-50 text-slate-700 border-slate-200">
                      <Cog className="w-3 h-3" />
                      {op.workCenter.name}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {Number(op.standardTime) > 0 ? (
                      <span className="font-semibold text-amber-600">
                        {Number(op.standardTime).toLocaleString("ko-KR")}분
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="py-10 text-center text-muted-foreground text-[14px]">
          등록된 공정이 없습니다.
        </div>
      )}
    </div>
  )
}
