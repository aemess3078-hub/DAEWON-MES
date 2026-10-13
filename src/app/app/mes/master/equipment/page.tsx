import {
  getEquipmentsWithDetails,
  getSitesForEquipment,
  getWorkCentersForEquipment,
} from "@/lib/actions/equipment.actions"
import { EquipmentDataTable } from "./equipment-data-table"

export const dynamic = "force-dynamic"

export default async function EquipmentMasterPage() {
  const [equipments, sites, workCenters] = await Promise.all([
    getEquipmentsWithDetails(),
    getSitesForEquipment(),
    getWorkCentersForEquipment(),
  ])

  const total       = equipments.length
  const active      = equipments.filter((e) => e.status === "ACTIVE").length
  const inactive    = equipments.filter((e) => e.status === "INACTIVE").length
  const maintenance = equipments.filter((e) => e.status === "MAINTENANCE").length
  const connected   = equipments.filter((e) => e._count.connections > 0).length

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          설비관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          MES &gt; 기준정보관리 · 설비 기준정보를 등록하고 관리합니다.
          설비 모니터링·점검·수리의 기준이 됩니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="총 설비"       value={total}       />
        <SummaryCard label="가동"          value={active}       accent="green" />
        <SummaryCard label="정지 / 유지보수" value={inactive + maintenance} accent="amber" />
        <SummaryCard label="태그 연결 설비" value={connected}    accent="blue" />
      </div>

      {/* 테이블 */}
      <EquipmentDataTable
        data={equipments}
        sites={sites}
        workCenters={workCenters}
      />
    </div>
  )
}

// ─── 요약 카드 ────────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  accent,
}: {
  label:   string
  value:   number
  accent?: "green" | "amber" | "blue"
}) {
  const textColor =
    accent === "green" ? "text-emerald-700"
    : accent === "amber" ? "text-amber-600"
    : accent === "blue"  ? "text-blue-600"
    : "text-foreground"

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold tabular-nums ${textColor}`}>
        {value.toLocaleString()}
        <span className="ml-1 text-[14px] font-normal text-muted-foreground">대</span>
      </p>
    </div>
  )
}
