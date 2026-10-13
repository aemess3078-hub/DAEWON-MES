import { getMoldsData, getSitesForMold, getWorkCentersForMold } from "@/lib/actions/mold.actions"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"
import { MoldsDataTable } from "./molds-data-table"
import { Wrench, CheckCircle2, Archive, Hammer } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function MoldsPage() {
  const [moldsData, sites, workCenters, user] = await Promise.all([
    getMoldsData(),
    getSitesForMold(),
    getWorkCentersForMold(),
    getCurrentUser(),
  ])
  const canBulkDelete = isDeveloperUser(user) || user?.role === "OWNER" || user?.role === "ADMIN"

  const { summary, rows } = moldsData

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          금형·치공구관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          금형·치공구 기준정보를 등록하고 위치·상태를 관리합니다.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard
          icon={<Wrench className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-50"
          label="전체"
          value={summary.total}
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          iconBg="bg-emerald-50"
          label="사용중"
          value={summary.active}
        />
        <SummaryCard
          icon={<Archive className="h-5 w-5 text-slate-500" />}
          iconBg="bg-slate-50"
          label="보관중"
          value={summary.inactive}
        />
        <SummaryCard
          icon={<Hammer className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-50"
          label="수리중"
          value={summary.maintenance}
        />
      </div>

      <MoldsDataTable data={rows} sites={sites} workCenters={workCenters} canBulkDelete={canBulkDelete} />
    </div>
  )
}

function SummaryCard({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: number
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 flex items-center gap-3">
      <div className={`p-2 ${iconBg} rounded-lg`}>{icon}</div>
      <div>
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className="text-[22px] font-semibold tabular-nums">
          {value.toLocaleString()}
          <span className="ml-1 text-[14px] font-normal text-muted-foreground">개</span>
        </p>
      </div>
    </div>
  )
}
