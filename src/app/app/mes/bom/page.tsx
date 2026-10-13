import { getBoms, getItemsForBom, getComponentItems } from "@/lib/actions/bom.actions"
import { BomDataTable } from "./bom-data-table"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { getTenantId } from "@/lib/auth"

export const dynamic = "force-dynamic"

export default async function BomPage() {
  const tenantId = await getTenantId()
  const enabled = await isFeatureEnabled(tenantId, "BOM")

  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">이 기능은 활성화되어 있지 않습니다.</p>
      </div>
    )
  }

  const [boms, parentItems, componentItems] = await Promise.all([
    getBoms(),
    getItemsForBom(),
    getComponentItems(),
  ])

  const resolvedTenantId = boms[0]?.tenantId ?? ""

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            BOM관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            품목별 자재 명세(BOM)를 관리합니다.
          </p>
        </div>
      </div>
      <BomDataTable
        boms={boms}
        parentItems={parentItems}
        componentItems={componentItems}
        tenantId={resolvedTenantId}
      />
    </div>
  )
}
