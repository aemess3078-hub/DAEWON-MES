import { getWorkStandards } from "@/lib/actions/work-standards.actions"
import { WorkStandardsClient } from "./work-standards-client"

export const dynamic = "force-dynamic"

export default async function WorkStandardsPage() {
  const data = await getWorkStandards()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          작업표준서관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          공정별 작업 표준서를 등록하고 문서 유형별로 관리합니다.
        </p>
      </div>

      <WorkStandardsClient data={data} />
    </div>
  )
}
