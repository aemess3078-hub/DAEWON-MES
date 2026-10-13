import { getItemCategoriesForManagement } from "@/lib/actions/item-category.actions"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"
import { ItemCategoryDataTable } from "./item-category-data-table"

export const dynamic = "force-dynamic"

export default async function ItemCategoriesPage() {
  const [categories, user] = await Promise.all([
    getItemCategoriesForManagement(),
    getCurrentUser(),
  ])
  const canBulkDelete = isDeveloperUser(user) || user?.role === "OWNER" || user?.role === "ADMIN"

  const total      = categories.length
  const withType   = categories.filter((c) => c.itemType != null).length
  const withGroups = categories.filter((c) => c._count.itemGroups > 0).length

  return (
    <div className="p-6 space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          품목분류관리
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          MES &gt; 기준정보관리 · 품목 분류 코드를 등록하고 관리합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SummaryCard label="전체 품목분류" value={total} />
        <SummaryCard label="시스템 유형 지정" value={withType}   accent="blue" />
        <SummaryCard label="품목군 연결"    value={withGroups} accent="green" />
      </div>

      {/* 테이블 */}
      <ItemCategoryDataTable data={categories} canBulkDelete={canBulkDelete} />
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
  accent?: "green" | "blue"
}) {
  const textColor =
    accent === "green" ? "text-emerald-700"
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
