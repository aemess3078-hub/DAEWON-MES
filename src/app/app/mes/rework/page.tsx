export const dynamic = "force-dynamic"

import { getTenantId } from "@/lib/auth"
import { getReworkPendingList } from "@/lib/actions/process-progress.actions"
import { getHolds, getHoldableWipUnits } from "@/lib/actions/wip-hold.actions"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ReworkDataTable } from "./rework-data-table"
import { HoldDataTable } from "./hold-data-table"

export default async function ReworkPage() {
  const tenantId = await getTenantId()

  const [reworkItems, holds, holdableWipUnits] = await Promise.all([
    getReworkPendingList(tenantId),
    getHolds("ACTIVE"),
    getHoldableWipUnits(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          재작업/보류관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          재작업 대상의 처리현황과 생산 보류·해제 이력을 관리합니다.
        </p>
      </div>

      <Tabs defaultValue="rework">
        <TabsList className="h-9">
          <TabsTrigger value="rework" className="text-[13px]">재작업</TabsTrigger>
          <TabsTrigger value="hold" className="text-[13px]">보류</TabsTrigger>
        </TabsList>

        <TabsContent value="rework" className="mt-4">
          {reworkItems.length === 0 ? (
            <div className="rounded-lg border border-dashed p-12 text-center">
              <p className="text-[15px] text-muted-foreground">
                현재 재작업 대기 중인 항목이 없습니다.
              </p>
            </div>
          ) : (
            <ReworkDataTable data={reworkItems} />
          )}
        </TabsContent>

        <TabsContent value="hold" className="mt-4">
          <HoldDataTable initialData={holds} holdableWipUnits={holdableWipUnits} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
