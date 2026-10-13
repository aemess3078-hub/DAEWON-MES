import {
  getDailyCheckStatusData,
  getEquipmentsForLMS,
} from "@/lib/actions/equipment-management.actions"
import { CheckStatusClient } from "./check-status-client"

export const dynamic = "force-dynamic"

interface Props {
  searchParams?: Promise<{
    from?: string
    to?: string
    equipmentId?: string
  }>
}

function defaultDateRange() {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - 30)
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return { from: fmt(from), to: fmt(to) }
}

export default async function CheckStatusPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {}
  const { from: defaultFrom, to: defaultTo } = defaultDateRange()

  const from = params.from?.trim() || defaultFrom
  const to = params.to?.trim() || defaultTo
  const equipmentId = params.equipmentId?.trim() || undefined

  const [statusData, equipmentList] = await Promise.all([
    getDailyCheckStatusData({ from, to, equipmentId }),
    getEquipmentsForLMS(),
  ])

  const equipments = equipmentList.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          설비일상점검현황
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          설비별 일상점검 결과를 기간·설비별로 조회합니다.
        </p>
      </div>
      <CheckStatusClient
        data={statusData}
        equipments={equipments}
        filter={{ from, to, equipmentId: equipmentId ?? "" }}
      />
    </div>
  )
}
