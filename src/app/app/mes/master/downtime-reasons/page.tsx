import { Info } from "lucide-react"
import { getDowntimeReasons } from "@/lib/actions/downtime-reason.actions"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"
import { DowntimeReasonsClient } from "./downtime-reasons-client"

export const dynamic = "force-dynamic"

export default async function DowntimeReasonsPage() {
  const [reasons, user] = await Promise.all([
    getDowntimeReasons(),
    getCurrentUser(),
  ])
  const canBulkDelete = isDeveloperUser(user) || user?.role === "OWNER" || user?.role === "ADMIN"

  const total    = reasons.length
  const active   = reasons.filter((r) => r.isActive).length
  const inactive = reasons.filter((r) => !r.isActive).length

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          비가동사유
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          MES &gt; 기준정보관리 · 설비 비가동 발생 시 사용할 사유 기준정보를 관리합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="전체 사유"  value={total}    />
        <SummaryCard label="사용중"     value={active}   accent="green" />
        <SummaryCard label="미사용"     value={inactive} accent="amber" />
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 dark:bg-blue-950/20 dark:border-blue-900 px-4 py-3 flex flex-col justify-between">
          <p className="text-[13px] text-blue-700 dark:text-blue-400 font-medium">설비통계 연계</p>
          <p className="text-[12px] text-blue-600/80 dark:text-blue-500 mt-1 leading-relaxed">
            STOP / MAINTENANCE 이벤트 기준 집계
          </p>
        </div>
      </div>

      {/* 테이블 */}
      <DowntimeReasonsClient data={reasons} canBulkDelete={canBulkDelete} />

      {/* 설비통계분석 연계 안내 */}
      <div className="flex gap-3 rounded-lg border border-border bg-muted/30 px-4 py-4">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          현재 설비 비가동 시간 통계는 EquipmentEvent의 STOP / MAINTENANCE 이벤트 기준으로 집계됩니다.
          본 비가동사유는 비가동 발생 시 사유 표준화를 위한 기준정보이며,
          이벤트별 사유 연결은 추후 고도화 항목입니다.
        </p>
      </div>
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
  accent?: "green" | "amber"
}) {
  const textColor =
    accent === "green" ? "text-emerald-700"
    : accent === "amber" ? "text-amber-600"
    : "text-foreground"

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold tabular-nums ${textColor}`}>
        {value.toLocaleString()}
        <span className="ml-1 text-[14px] font-normal text-muted-foreground">개</span>
      </p>
    </div>
  )
}
