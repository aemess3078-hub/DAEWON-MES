import { getProblemTypes } from "@/lib/actions/equipment-management.actions"
import { ProblemTypeTable } from "./problem-type-table"

export const dynamic = "force-dynamic"

export default async function EquipmentProblemsPage() {
  const problemTypes = await getProblemTypes()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          설비 문제유형 관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          수리요청에 사용할 문제유형 코드를 관리합니다.
        </p>
      </div>

      <ProblemTypeTable data={problemTypes} />
    </div>
  )
}
