import { getTenantId } from "@/lib/auth"
import { getDefectCodes } from "@/lib/actions/quality.actions"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"
import { DefectDataTable } from "./defect-data-table"

export const dynamic = "force-dynamic"

export default async function DefectsPage() {
  const tenantId = await getTenantId()

  const [defectCodes, user] = await Promise.all([
    getDefectCodes(tenantId),
    getCurrentUser(),
  ])
  const canBulkDelete = isDeveloperUser(user) || user?.role === "OWNER" || user?.role === "ADMIN"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            불량관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            불량 유형별 코드를 등록하고 관리합니다.
          </p>
        </div>
      </div>

      <DefectDataTable data={defectCodes} tenantId={tenantId} canBulkDelete={canBulkDelete} />
    </div>
  )
}
