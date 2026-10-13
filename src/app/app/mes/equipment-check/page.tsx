import {
  getDailyChecks,
  getEquipmentsForLMS,
} from "@/lib/actions/equipment-management.actions"
import { DailyCheckTable } from "./daily-check-table"

export const dynamic = "force-dynamic"

interface EquipmentCheckPageProps {
  searchParams: Promise<{ equipmentId?: string }>
}

export default async function EquipmentCheckPage({ searchParams }: EquipmentCheckPageProps) {
  const params = await searchParams
  const [checks, equipments] = await Promise.all([
    getDailyChecks(),
    getEquipmentsForLMS(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          정기점검
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          매일 설비 상태를 점검하고 이상 여부를 기록합니다.
        </p>
      </div>

      <DailyCheckTable data={checks} equipments={equipments} defaultEquipmentId={params.equipmentId} />
    </div>
  )
}
