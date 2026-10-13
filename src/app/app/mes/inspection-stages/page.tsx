import {
  getInspectionsByStage,
  getInspectionStageSummary,
  getWorkOrdersForInspection,
} from "@/lib/actions/inspection-stages.actions"
import { InspectionStageTable } from "./inspection-stage-table"
import { Card, CardContent } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export default async function InspectionStagesPage() {
  const [inspections, summary, workOrders] = await Promise.all([
    getInspectionsByStage(),
    getInspectionStageSummary(),
    getWorkOrdersForInspection(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          검사결과 관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          생산 공정별 초물, 중간, 종물 검사를 등록하고 이력을 관리합니다.
        </p>
      </div>

      {/* Stage summary */}
      <div className="grid grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-[13px] text-muted-foreground mb-1">오늘 초물검사</p>
            <p className="text-[26px] font-semibold text-blue-600">{summary.first}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-[13px] text-muted-foreground mb-1">오늘 중간검사</p>
            <p className="text-[26px] font-semibold text-yellow-600">{summary.mid}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-[13px] text-muted-foreground mb-1">오늘 종물검사</p>
            <p className="text-[26px] font-semibold text-purple-600">{summary.final}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-[13px] text-muted-foreground mb-1">합격</p>
            <p className="text-[26px] font-semibold text-green-600">{summary.passCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-[13px] text-muted-foreground mb-1">불합격</p>
            <p className="text-[26px] font-semibold text-red-600">{summary.failCount}</p>
          </CardContent>
        </Card>
      </div>

      <InspectionStageTable data={inspections} workOrders={workOrders} />
    </div>
  )
}
