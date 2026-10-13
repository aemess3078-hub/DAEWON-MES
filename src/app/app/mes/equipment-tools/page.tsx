import { getToolList, getToolFilterOptions, type ToolFilter } from "@/lib/actions/tool.actions"
import { ToolClient } from "./tool-client"

export const dynamic = "force-dynamic"

interface EquipmentToolsPageProps {
  searchParams?: Promise<{
    equipmentType?: string
    status?: string
    itemId?: string
    workCenterId?: string
  }>
}

const VALID_TYPE = new Set(["ALL", "TOOL", "JIG", "FIXTURE"])
const VALID_STATUS = new Set(["ALL", "ACTIVE", "INACTIVE", "MAINTENANCE", "DISCARDED"])

export default async function EquipmentToolsPage({ searchParams }: EquipmentToolsPageProps) {
  const params = searchParams ? await searchParams : {}

  const filter: ToolFilter = {
    equipmentType:
      params.equipmentType && VALID_TYPE.has(params.equipmentType)
        ? (params.equipmentType as ToolFilter["equipmentType"])
        : "ALL",
    status:
      params.status && VALID_STATUS.has(params.status)
        ? (params.status as ToolFilter["status"])
        : "ALL",
    itemId: params.itemId?.trim() || undefined,
    workCenterId: params.workCenterId?.trim() || undefined,
  }

  const [rows, filterOptions] = await Promise.all([getToolList(filter), getToolFilterOptions()])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          공구관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          보유 공구/치공구를 등록하고 적용품목·보관위치·수명·사용/점검/수리 이력을 관리합니다.
        </p>
      </div>

      <ToolClient
        initialFilter={{
          equipmentType: filter.equipmentType ?? "ALL",
          status: filter.status ?? "ALL",
          itemId: filter.itemId ?? "",
          workCenterId: filter.workCenterId ?? "",
        }}
        rows={rows}
        filterOptions={filterOptions}
      />
    </div>
  )
}
