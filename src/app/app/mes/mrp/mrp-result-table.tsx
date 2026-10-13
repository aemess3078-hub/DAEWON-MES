"use client"

import { Checkbox } from "@/components/ui/checkbox"
import type { MRPItem } from "@/lib/services/mrp.service"

const STATUS_CONFIG = {
  CRITICAL: { label: "긴급", className: "bg-red-50 border-red-200 text-red-700" },
  SHORTAGE: { label: "부족", className: "bg-amber-50 border-amber-200 text-amber-700" },
  SUFFICIENT: { label: "충분", className: "bg-emerald-50 border-emerald-200 text-emerald-700" },
}

const TABLE_HEADERS = [
  "자재코드",
  "자재명",
  "단위",
  "총소요량",
  "현재재고",
  "가용재고",
  "발주중",
  "순소요량",
  "제안수량",
  "상태",
]

type Props = {
  items: MRPItem[]
  selectedIds: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
}

export function MrpResultTable({ items, selectedIds, onToggle, onToggleAll }: Props) {
  const shortageItems = items.filter((i) => i.status !== "SUFFICIENT")
  const allSelected =
    shortageItems.length > 0 && selectedIds.size === shortageItems.length

  return (
    <div className="border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[14px] border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b">
              <th className="px-4 py-3 w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onToggleAll}
                  aria-label="전체 선택"
                />
              </th>
              {TABLE_HEADERS.map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-[12px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const isShortage = item.status !== "SUFFICIENT"
              const cfg = STATUS_CONFIG[item.status]
              return (
                <tr
                  key={item.itemId}
                  className={`border-b last:border-0 transition-colors ${
                    item.status === "CRITICAL"
                      ? "bg-red-50/40 hover:bg-red-50/60"
                      : item.status === "SHORTAGE"
                        ? "bg-amber-50/30 hover:bg-amber-50/50"
                        : idx % 2 === 0
                          ? "bg-background hover:bg-muted/10"
                          : "bg-muted/5 hover:bg-muted/10"
                  }`}
                >
                  <td className="px-4 py-3">
                    {isShortage && (
                      <Checkbox
                        checked={selectedIds.has(item.itemId)}
                        onCheckedChange={() => onToggle(item.itemId)}
                        aria-label={`${item.itemName} 선택`}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px]">{item.itemCode}</td>
                  <td className="px-4 py-3 font-medium">{item.itemName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{item.uom}</td>
                  <td className="px-4 py-3 text-right">{item.grossRequirement.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">{item.currentStock.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">{item.availableStock.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {item.onOrder.toFixed(2)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${
                      item.netRequirement > 0 ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {item.netRequirement.toFixed(2)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-semibold ${
                      item.suggestedOrderQty > 0 ? "text-red-600" : "text-muted-foreground"
                    }`}
                  >
                    {item.suggestedOrderQty.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium border ${cfg.className}`}
                    >
                      {cfg.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
