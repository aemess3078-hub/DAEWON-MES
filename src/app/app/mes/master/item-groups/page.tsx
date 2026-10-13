import { getItemGroupsForManagement } from "@/lib/actions/item-group.actions"
import { getItemCategoriesForManagement } from "@/lib/actions/item-category.actions"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"
import { ItemGroupDataTable } from "./item-group-data-table"

export const dynamic = "force-dynamic"

export default async function ItemGroupsPage() {
  const [groups, categories, user] = await Promise.all([
    getItemGroupsForManagement(),
    getItemCategoriesForManagement(),
    getCurrentUser(),
  ])
  const canBulkDelete = isDeveloperUser(user) || user?.role === "OWNER" || user?.role === "ADMIN"

  const total    = groups.length
  const active   = groups.filter((g) => g.isActive).length
  const inactive = groups.filter((g) => !g.isActive).length

  const categoryOptions = categories.map((c) => ({
    id:   c.id,
    code: c.code,
    name: c.name,
  }))

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          품목군관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          MES &gt; 기준정보관리 · 품목분류별 세부 품목군을 등록하고 관리합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SummaryCard label="전체 품목군"  value={total} />
        <SummaryCard label="사용"         value={active}   accent="green" />
        <SummaryCard label="미사용"       value={inactive} accent="amber" />
      </div>

      {/* 테이블 */}
      <ItemGroupDataTable data={groups} categories={categoryOptions} canBulkDelete={canBulkDelete} />
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
        <span className="ml-1 text-[14px] font-normal text-muted-foreground">개</span>
      </p>
    </div>
  )
}
