import { getTenantId } from "@/lib/auth"
import { SalesOrderStatus } from "@prisma/client"

import { getSalesOrderStatusRows } from "@/lib/actions/sales-order.actions"
import { OrderStatusDataTable } from "./order-status-data-table"
import { formatQuantity } from "@/lib/utils"

export const dynamic = "force-dynamic"

const OPEN_STATUSES: SalesOrderStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "IN_PRODUCTION",
  "PARTIAL_SHIPPED",
]

export default async function SalesOrderStatusPage() {
  const tenantId = await getTenantId()

  const orders = await getSalesOrderStatusRows(tenantId)
  const today = startOfLocalDay(new Date())

  const totalOrders = orders.length
  const inProgressOrders = orders.filter((order) =>
    OPEN_STATUSES.includes(order.status)
  ).length
  const completedOrders = orders.filter((order) =>
    ["SHIPPED", "CLOSED"].includes(order.status)
  ).length
  const urgentOrOverdueOrders = orders.filter((order) => {
    if (!OPEN_STATUSES.includes(order.status)) return false
    const dueDate = startOfLocalDay(order.deliveryDate)
    const daysUntilDue = Math.ceil(
      (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    )
    return daysUntilDue <= 7
  }).length

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          수주현황
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          MES &gt; 영업관리 · 수주별 납기, 출하 진행률, 미출하 수량을 조회합니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="총 수주 건수" value={formatQuantity(totalOrders)} suffix="건" />
        <SummaryCard label="진행중 수주" value={formatQuantity(inProgressOrders)} suffix="건" />
        <SummaryCard label="완료 수주" value={formatQuantity(completedOrders)} suffix="건" />
        <SummaryCard
          label="납기 임박/지연"
          value={formatQuantity(urgentOrOverdueOrders)}
          suffix="건"
          accent
        />
      </div>

      <OrderStatusDataTable data={orders} />
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
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-[20px] font-semibold tabular-nums ${
          accent ? "text-red-600" : "text-foreground"
        }`}
      >
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

function startOfLocalDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}
