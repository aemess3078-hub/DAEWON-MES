export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getOperationProgressList } from "@/lib/actions/process-progress.actions"
import { ProcessProgressDataTable } from "./process-progress-data-table"

export default async function ProcessProgressPage() {
  const tenantId = await getTenantId()

  const operations = await getOperationProgressList(tenantId)

  const totalDefectOps = operations.filter((op) => op.totalDefectQty > 0).length
  const inProgressOps = operations.filter((op) => op.status === "IN_PROGRESS").length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            공정진행 관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            작업지시별 공정 진행 현황을 확인하고 부적합을 처리합니다.
          </p>
        </div>
        {(inProgressOps > 0 || totalDefectOps > 0) && (
          <div className="flex gap-3 text-[13px]">
            {inProgressOps > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-center">
                <div className="font-semibold text-amber-800 text-[18px]">{inProgressOps}</div>
                <div className="text-amber-700">진행중</div>
              </div>
            )}
            {totalDefectOps > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-center">
                <div className="font-semibold text-red-700 text-[18px]">{totalDefectOps}</div>
                <div className="text-red-600">부적합</div>
              </div>
            )}
          </div>
        )}
      </div>

      <ProcessProgressDataTable data={operations} />
    </div>
  )
}
