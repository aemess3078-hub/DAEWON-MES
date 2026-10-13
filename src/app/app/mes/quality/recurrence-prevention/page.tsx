import {
  getDefectRecurrencePreventionList,
  getDefectRecurrencePreventionFilterOptions,
  type DefectRecurrencePreventionFilter,
} from "@/lib/actions/defect-recurrence-prevention.actions"
import { kstDefaultDateRange, isValidKstDateRange } from "@/lib/date/kst"
import { RecurrencePreventionClient } from "./recurrence-prevention-client"

export const dynamic = "force-dynamic"

interface RecurrencePreventionPageProps {
  searchParams?: Promise<{
    from?: string
    to?: string
    itemId?: string
    routingOperationId?: string
    manufacturingNo?: string
    defectCodeId?: string
    assigneeId?: string
    verificationResult?: string
    status?: string
  }>
}

const VALID_STATUS = new Set(["ALL", "OPEN", "IN_PROGRESS", "VERIFYING", "COMPLETED", "OVERDUE"])
const VALID_VERIFICATION_RESULT = new Set(["ALL", "EFFECTIVE", "INEFFECTIVE"])

export default async function RecurrencePreventionPage({ searchParams }: RecurrencePreventionPageProps) {
  const params = searchParams ? await searchParams : {}
  const { from: defaultFrom, to: defaultTo } = kstDefaultDateRange(30)

  const rawFrom = params.from?.trim()
  const rawTo = params.to?.trim()
  const bothValid = !!rawFrom && !!rawTo && isValidKstDateRange(rawFrom, rawTo)

  const filter: DefectRecurrencePreventionFilter = {
    from: bothValid ? rawFrom! : defaultFrom,
    to: bothValid ? rawTo! : defaultTo,
    itemId: params.itemId?.trim() || undefined,
    routingOperationId: params.routingOperationId?.trim() || undefined,
    manufacturingNo: params.manufacturingNo?.trim() || undefined,
    defectCodeId: params.defectCodeId?.trim() || undefined,
    assigneeId: params.assigneeId?.trim() || undefined,
    verificationResult:
      params.verificationResult && VALID_VERIFICATION_RESULT.has(params.verificationResult)
        ? (params.verificationResult as "ALL" | "EFFECTIVE" | "INEFFECTIVE")
        : "ALL",
    status:
      params.status && VALID_STATUS.has(params.status)
        ? (params.status as "ALL" | "OPEN" | "IN_PROGRESS" | "VERIFYING" | "COMPLETED" | "OVERDUE")
        : "ALL",
  }

  const [rows, filterOptions] = await Promise.all([
    getDefectRecurrencePreventionList(filter),
    getDefectRecurrencePreventionFilterOptions(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          재발방지관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          완료된 조치에 대해 재발방지 대책을 등록하고, 효과성을 검증하여 CAPA를 종료합니다.
        </p>
      </div>

      <RecurrencePreventionClient
        initialFilter={{
          from: filter.from!,
          to: filter.to!,
          itemId: filter.itemId ?? "",
          routingOperationId: filter.routingOperationId ?? "",
          manufacturingNo: filter.manufacturingNo ?? "",
          defectCodeId: filter.defectCodeId ?? "",
          assigneeId: filter.assigneeId ?? "",
          verificationResult: filter.verificationResult ?? "ALL",
          status: filter.status ?? "ALL",
        }}
        rows={rows}
        filterOptions={filterOptions}
      />
    </div>
  )
}
