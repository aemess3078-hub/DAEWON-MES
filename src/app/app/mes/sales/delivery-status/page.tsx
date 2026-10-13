import { getTenantId } from "@/lib/auth"
import { ShipmentStatus } from "@prisma/client"

import { getDeliveryStatusRows } from "@/lib/actions/shipment.actions"
import { DeliveryStatusDataTable } from "./delivery-status-data-table"
import { formatQuantity } from "@/lib/utils"

export const dynamic = "force-dynamic"

const IN_PROGRESS_STATUSES: ShipmentStatus[] = ["PLANNED", "PICKED"]
const COMPLETE_STATUSES: ShipmentStatus[] = ["SHIPPED", "DELIVERED"]

export default async function DeliveryStatusPage() {
  const tenantId = await getTenantId()

  const deliveries = await getDeliveryStatusRows(tenantId)
  const today = startOfLocalDay(new Date())

  const totalDeliveries = deliveries.length
  const inProgressDeliveries = deliveries.filter((delivery) =>
    IN_PROGRESS_STATUSES.includes(delivery.status)
  ).length
  const completedDeliveries = deliveries.filter((delivery) =>
    COMPLETE_STATUSES.includes(delivery.status)
  ).length
  const urgentOrOverdueDeliveries = deliveries.filter((delivery) => {
    if (isClosedStatus(delivery.status)) return false
    const dueDate = startOfLocalDay(delivery.salesOrder.deliveryDate)
    const daysUntilDue = Math.ceil(
      (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    )
    return daysUntilDue <= 7
  }).length

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          납품현황
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          MES &gt; 영업관리 · 출하 건별 납품 진행률과 납기 상태를 조회합니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="총 출하 건수" value={formatQuantity(totalDeliveries)} suffix="건" />
        <SummaryCard label="진행중 건수" value={formatQuantity(inProgressDeliveries)} suffix="건" />
        <SummaryCard label="완료 건수" value={formatQuantity(completedDeliveries)} suffix="건" />
        <SummaryCard
          label="납기 임박/지연"
          value={formatQuantity(urgentOrOverdueDeliveries)}
          suffix="건"
          accent
        />
      </div>

      <DeliveryStatusDataTable data={deliveries} />
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

function isClosedStatus(status: ShipmentStatus) {
  return status === "SHIPPED" || status === "DELIVERED" || status === "CANCELLED"
}

function startOfLocalDay(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}
