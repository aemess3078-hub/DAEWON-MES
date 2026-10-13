"use client"

import { X, Layers, Package, Wrench, FlaskConical } from "lucide-react"
import { BOMWithDetails } from "@/lib/actions/bom.actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const ITEM_TYPE_CONFIG: Record<string, {
  label: string
  badgeClass: string
  rowClass: string
  icon: React.ElementType
}> = {
  SEMI_FINISHED: {
    label: "반제품",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    rowClass: "bg-blue-50/30",
    icon: Layers,
  },
  RAW_MATERIAL: {
    label: "원자재",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rowClass: "bg-emerald-50/20",
    icon: Package,
  },
  CONSUMABLE: {
    label: "소모품",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200",
    rowClass: "bg-amber-50/20",
    icon: Wrench,
  },
  FINISHED: {
    label: "완제품",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200",
    rowClass: "bg-purple-50/20",
    icon: FlaskConical,
  },
}

const BOM_STATUS_CONFIG = {
  ACTIVE:   { label: "활성", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  DRAFT:    { label: "초안", className: "bg-muted text-muted-foreground border-border" },
  INACTIVE: { label: "비활성", className: "bg-red-50 text-red-600 border-red-200" },
}

type Props = {
  bom: BOMWithDetails
  onClose: () => void
}

export function BomDetailPanel({ bom, onClose }: Props) {
  // 유형별 그룹화
  const grouped = bom.bomItems.reduce<Record<string, typeof bom.bomItems>>((acc, item) => {
    const type = item.componentItem.itemType
    if (!acc[type]) acc[type] = []
    acc[type].push(item)
    return acc
  }, {})

  const typeOrder = ["SEMI_FINISHED", "RAW_MATERIAL", "CONSUMABLE", "FINISHED"]
  const summaryTypes = typeOrder.filter((t) => grouped[t]?.length)

  const statusCfg = BOM_STATUS_CONFIG[bom.status as keyof typeof BOM_STATUS_CONFIG] ?? BOM_STATUS_CONFIG.DRAFT

  return (
    <div className="border rounded-xl overflow-hidden shadow-sm animate-in slide-in-from-top-2 duration-200">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 py-4 bg-muted/20 border-b">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[15px] font-bold text-primary">{bom.item.code}</span>
              <span className="text-[15px] font-semibold">{bom.item.name}</span>
              <span className={`text-[12px] px-2 py-0.5 rounded-full border font-medium ${statusCfg.className}`}>
                {statusCfg.label}
              </span>
              <span className="text-[12px] text-muted-foreground border rounded px-1.5 py-0.5">
                v{bom.version}
              </span>
              {bom.isDefault && (
                <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                  기본 BOM
                </span>
              )}
            </div>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              총 {bom.bomItems.length}개 자재 구성
            </p>
          </div>
        </div>

        {/* 요약 뱃지 */}
        <div className="flex items-center gap-2">
          {summaryTypes.map((type) => {
            const cfg = ITEM_TYPE_CONFIG[type]
            const Icon = cfg?.icon ?? Package
            return (
              <div
                key={type}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[13px] font-medium ${cfg?.badgeClass ?? ""}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {cfg?.label ?? type} {grouped[type].length}개
              </div>
            )
          })}
          <Button variant="ghost" size="icon" className="h-8 w-8 ml-2" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 자재 목록 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b bg-muted/10">
              <th className="text-left px-5 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide w-12">순서</th>
              <th className="text-left px-4 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">품목코드</th>
              <th className="text-left px-4 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">품목명</th>
              <th className="text-left px-4 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">유형</th>
              <th className="text-right px-4 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">소요수량</th>
              <th className="text-center px-4 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">단위</th>
              <th className="text-right px-5 py-2.5 text-[12px] font-semibold text-muted-foreground uppercase tracking-wide">스크랩율</th>
            </tr>
          </thead>
          <tbody>
            {bom.bomItems.map((item, idx) => {
              const cfg = ITEM_TYPE_CONFIG[item.componentItem.itemType]
              const Icon = cfg?.icon ?? Package
              return (
                <tr
                  key={item.id}
                  className={`border-b last:border-0 transition-colors hover:brightness-95 ${
                    idx % 2 === 0 ? "bg-background" : "bg-muted/5"
                  }`}
                >
                  <td className="px-5 py-3 text-center">
                    <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[12px] font-semibold text-muted-foreground mx-auto">
                      {item.seq}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-[13px] font-medium text-muted-foreground">
                      {item.componentItem.code}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{item.componentItem.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[12px] font-medium border ${cfg?.badgeClass ?? "bg-muted text-muted-foreground"}`}>
                      <Icon className="w-3 h-3" />
                      {cfg?.label ?? item.componentItem.itemType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {Number(item.qtyPer).toLocaleString("ko-KR", { maximumFractionDigits: 4 })}
                  </td>
                  <td className="px-4 py-3 text-center text-muted-foreground">
                    {item.componentItem.uom}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {Number(item.scrapRate) > 0 ? (
                      <span className="text-amber-600 font-medium">
                        {(Number(item.scrapRate) * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* 빈 상태 */}
      {bom.bomItems.length === 0 && (
        <div className="py-10 text-center text-muted-foreground text-[14px]">
          등록된 자재가 없습니다.
        </div>
      )}
    </div>
  )
}
