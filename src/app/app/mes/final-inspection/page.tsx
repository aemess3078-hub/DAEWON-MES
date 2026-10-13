export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getWorkOrdersForReceipt } from "@/lib/actions/finished-goods.actions"
import { FinalInspectionDataTable } from "./final-inspection-data-table"

export default async function FinalInspectionPage() {
  const tenantId = await getTenantId()

  const workOrders = await getWorkOrdersForReceipt(tenantId)

  const pendingInspection = workOrders.filter(
    (wo) => wo.qualityRelease.requiresInspection && wo.qualityRelease.inspectionStatus === "NOT_INSPECTED"
  ).length
  const failCount = workOrders.filter(
    (wo) => wo.qualityRelease.inspectionResult === "FAIL"
  ).length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            최종검사 관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            생산 완료된 작업지시의 최종 품질검사 결과를 확인하고 입고 여부를 결정합니다.
          </p>
        </div>
        {(pendingInspection > 0 || failCount > 0) && (
          <div className="flex gap-3">
            {pendingInspection > 0 && (
              <div className="rounded-lg bg-slate-50 border px-3 py-2 text-center">
                <div className="font-semibold text-slate-700 text-[18px]">{pendingInspection}</div>
                <div className="text-[13px] text-slate-600">검사 미완료</div>
              </div>
            )}
            {failCount > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-center">
                <div className="font-semibold text-red-700 text-[18px]">{failCount}</div>
                <div className="text-[13px] text-red-600">불합격</div>
              </div>
            )}
          </div>
        )}
      </div>

      {workOrders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-[15px] text-muted-foreground">
            최종검사 대상 작업지시가 없습니다.
          </p>
          <p className="text-[13px] text-muted-foreground mt-1">
            생산 완료(COMPLETED) 상태의 작업지시가 여기에 표시됩니다.
          </p>
        </div>
      ) : (
        <FinalInspectionDataTable data={workOrders} />
      )}
    </div>
  )
}
