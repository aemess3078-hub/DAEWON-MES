import { getTenantId } from "@/lib/auth"

import { getWipInventoryRows } from "@/lib/actions/work-order.actions"
import { WipInventoryDataTable } from "./wip-inventory-data-table"
import { formatQuantity } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function WipInventoryPage() {
  const tenantId = await getTenantId()
  const rows = await getWipInventoryRows(tenantId)

  const totalOrders = new Set(rows.map((row) => row.workOrder.id)).size
  const rootQty = rows
    .filter((row) => row.unitType === "ROOT")
    .reduce((sum, row) => sum + row.qty, 0)
  const scrappedQty = rows
    .filter((row) => row.wipStatus === "SCRAPPED")
    .reduce((sum, row) => sum + row.qty, 0)
  const unresolvedReworkQty = rows
    .filter((row) => row.unitType === "REWORK_CHILD" && row.wipStatus === "REWORK")
    .reduce((sum, row) => sum + row.qty, 0)
  const availableReceiptQty = Array.from(
    new Map(
      rows
        .filter((row) => row.unitType === "ROOT" && row.receiptStatus === "AVAILABLE")
        .map((row) => [row.workOrder.id, row.availableReceiptQty])
    ).values()
  ).reduce((sum, qty) => sum + qty, 0)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          재공품재고
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          MES &gt; 재고관리 · 입고 대상 재공품과 불량/재작업 분리 재공품을 구분하고 입고 가능 상태를 확인합니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <SummaryCard label="총 작업지시" value={formatQuantity(totalOrders)} suffix="건" />
        <SummaryCard label="입고 대상 수량" value={formatQuantity(rootQty)} suffix="EA" />
        <SummaryCard label="폐기 수량" value={formatQuantity(scrappedQty)} suffix="EA" accent="red" />
        <SummaryCard
          label="미해결 재작업"
          value={formatQuantity(unresolvedReworkQty)}
          suffix="EA"
          accent="amber"
        />
        <SummaryCard label="입고 가능 수량" value={formatQuantity(availableReceiptQty)} suffix="EA" accent="green" />
      </div>

      <WipInventoryDataTable data={rows} />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  suffix,
  accent,
}: {
  label: string
  value: string
  suffix?: string
  accent?: "red" | "amber" | "green"
}) {
  const valueClass =
    accent === "red"
      ? "text-red-700"
      : accent === "amber"
        ? "text-amber-700"
        : accent === "green"
          ? "text-emerald-700"
          : "text-foreground"

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums ${valueClass}`}>
        {value}
        {suffix ? (
          <span className="ml-1 text-[14px] font-normal text-muted-foreground">
            {suffix}
          </span>
        ) : null}
      </p>
    </div>
  )
}
