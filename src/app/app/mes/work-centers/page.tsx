export const dynamic = "force-dynamic"

import { getWorkCentersWithDetails, getSitesForWorkCenter } from "@/lib/actions/work-center.actions"
import { WorkCenterDataTable } from "./work-center-data-table"

export default async function WorkCentersPage() {
  const [workCenters, sites] = await Promise.all([
    getWorkCentersWithDetails(),
    getSitesForWorkCenter(),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">공정관리</h1>
        <p className="text-sm text-muted-foreground mt-1">
          작업장(공정) 마스터를 등록하고 관리합니다
        </p>
      </div>
      <WorkCenterDataTable data={workCenters} sites={sites} />
    </div>
  )
}
