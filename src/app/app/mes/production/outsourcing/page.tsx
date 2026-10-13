import { getOutsourcingData } from "@/lib/actions/outsourcing.actions"
import { OutsourcingClient } from "./outsourcing-client"
import { PurchaseOrderStatus } from "@prisma/client"

export const dynamic = "force-dynamic"

interface Props {
  searchParams?: Promise<{
    from?: string
    to?: string
    supplierId?: string
    status?: string
  }>
}

export default async function OutsourcingPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {}

  const rawStatus = params.status?.trim()
  const status =
    rawStatus &&
    Object.values(PurchaseOrderStatus).includes(rawStatus as PurchaseOrderStatus)
      ? (rawStatus as PurchaseOrderStatus)
      : undefined

  const data = await getOutsourcingData({
    from: params.from?.trim() || undefined,
    to: params.to?.trim() || undefined,
    supplierId: params.supplierId?.trim() || undefined,
    status: status || undefined,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          외주관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          외주발주 현황과 입고 이력을 한 화면에서 조회합니다.
        </p>
      </div>

      <OutsourcingClient data={data} />
    </div>
  )
}
