import {
  getRepairRequests,
  getEquipmentsForLMS,
  getProfilesForLMS,
  getProblemTypes,
  getRepairStats,
} from "@/lib/actions/equipment-management.actions"
import { RepairDataTable } from "./repair-data-table"
import { Card, CardContent } from "@/components/ui/card"
import { Wrench, Clock, CheckCircle, AlertTriangle } from "lucide-react"

export const dynamic = "force-dynamic"

interface EquipmentRepairPageProps {
  searchParams: Promise<{ equipmentId?: string }>
}

export default async function EquipmentRepairPage({ searchParams }: EquipmentRepairPageProps) {
  const params = await searchParams
  const [requests, equipments, profiles, problemTypes, stats] = await Promise.all([
    getRepairRequests(),
    getEquipmentsForLMS(),
    getProfilesForLMS(),
    getProblemTypes(),
    getRepairStats(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          설비수리관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          수리 요청부터 완료까지 설비 점검·수리 이력을 한 화면에서 관리합니다.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg">
              <Wrench className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-[13px] text-muted-foreground">접수</p>
              <p className="text-[22px] font-semibold">{stats.open}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-yellow-50 rounded-lg">
              <Clock className="h-5 w-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-[13px] text-muted-foreground">수리중</p>
              <p className="text-[22px] font-semibold">{stats.inProgress}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg">
              <CheckCircle className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-[13px] text-muted-foreground">완료</p>
              <p className="text-[22px] font-semibold">{stats.completed}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-[13px] text-muted-foreground">긴급</p>
              <p className="text-[22px] font-semibold text-red-600">{stats.critical}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <RepairDataTable
        data={requests}
        equipments={equipments}
        profiles={profiles}
        problemTypes={problemTypes}
        defaultEquipmentId={params.equipmentId}
      />
    </div>
  )
}
