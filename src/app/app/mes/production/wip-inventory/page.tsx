import { getTenantId } from "@/lib/auth"

import { getWipInventoryRows } from "@/lib/actions/work-order.actions"
import { WipInventoryDataTable } from "./wip-inventory-data-table"
import { summarizeWipInventory } from "@/lib/actions/wip-receipt.helpers"
import { formatQuantity } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function WipInventoryPage() {
  const tenantId = await getTenantId()
  const rows = await getWipInventoryRows(tenantId)

  // 현재 재공(미입고 잔량) 기준 KPI — 입고완료·폐기완료 재공은 제외, 재작업 보류는 별도 집계
  const summary = summarizeWipInventory(
    rows.map((row) => ({
      workOrderId: row.workOrder.id,
      category: row.wipCategory,
      wipQty: row.wipQty,
      availableReceiptQty: row.availableReceiptQty,
      blocked: row.receiptStatus === "ON_HOLD",
      isCurrent: row.isCurrentWip,
    }))
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          재공품재고
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          MES &gt; 재고관리 · 현재 미입고 재공수량 기준으로 표시합니다. 입고 완료·폐기 완료 수량은 제외되며, 재작업 보류 수량은 별도로 구분합니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <SummaryCard label="재공 작업지시" value={formatQuantity(summary.currentOrderCount)} suffix="건" />
        <SummaryCard label="현재 재공수량" value={formatQuantity(summary.currentWipQty)} suffix="EA" />
        <SummaryCard label="공정 진행 수량" value={formatQuantity(summary.inProcessQty)} suffix="EA" />
        <SummaryCard
          label="입고 대기 수량"
          value={formatQuantity(summary.awaitingReceiptQty)}
          suffix="EA"
          accent="green"
        />
        <SummaryCard
          label="재작업 보류 수량"
          value={formatQuantity(summary.reworkHoldQty)}
          suffix="EA"
          accent="amber"
        />
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
