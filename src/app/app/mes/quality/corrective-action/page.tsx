import {
  getDefectCorrectiveActionList,
  getDefectCorrectiveActionFilterOptions,
  type DefectCorrectiveActionFilter,
} from "@/lib/actions/defect-corrective-action.actions"
import { kstDefaultDateRange, isValidKstDateRange } from "@/lib/date/kst"
import { CorrectiveActionClient } from "./corrective-action-client"

export const dynamic = "force-dynamic"

interface CorrectiveActionPageProps {
  searchParams?: Promise<{
    from?: string
    to?: string
    itemId?: string
    routingOperationId?: string
    manufacturingNo?: string
    defectCodeId?: string
    assigneeId?: string
    status?: string
  }>
}

const VALID_STATUS = new Set(["ALL", "OPEN", "IN_PROGRESS", "COMPLETED", "OVERDUE"])

export default async function CorrectiveActionPage({ searchParams }: CorrectiveActionPageProps) {
  const params = searchParams ? await searchParams : {}
  const { from: defaultFrom, to: defaultTo } = kstDefaultDateRange(30)

  const rawFrom = params.from?.trim()
  const rawTo = params.to?.trim()
  const bothValid = !!rawFrom && !!rawTo && isValidKstDateRange(rawFrom, rawTo)

  const filter: DefectCorrectiveActionFilter = {
    from: bothValid ? rawFrom! : defaultFrom,
    to: bothValid ? rawTo! : defaultTo,
    itemId: params.itemId?.trim() || undefined,
    routingOperationId: params.routingOperationId?.trim() || undefined,
    manufacturingNo: params.manufacturingNo?.trim() || undefined,
    defectCodeId: params.defectCodeId?.trim() || undefined,
    assigneeId: params.assigneeId?.trim() || undefined,
    status:
      params.status && VALID_STATUS.has(params.status)
        ? (params.status as "ALL" | "OPEN" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE")
        : "ALL",
  }

  const [rows, filterOptions] = await Promise.all([
    getDefectCorrectiveActionList(filter),
    getDefectCorrectiveActionFilterOptions(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          조치관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          불량 발생에 대한 시정조치를 등록하고 담당자·기한·진행상태를 관리합니다.
        </p>
      </div>

      <CorrectiveActionClient
        initialFilter={{
          from: filter.from!,
          to: filter.to!,
          itemId: filter.itemId ?? "",
          routingOperationId: filter.routingOperationId ?? "",
          manufacturingNo: filter.manufacturingNo ?? "",
          defectCodeId: filter.defectCodeId ?? "",
          assigneeId: filter.assigneeId ?? "",
          status: filter.status ?? "ALL",
        }}
        rows={rows}
        filterOptions={filterOptions}
      />
    </div>
  )
}
