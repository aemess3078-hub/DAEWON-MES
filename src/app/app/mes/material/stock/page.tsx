import { getGroupedMaterialInventoryBalances } from "@/lib/actions/inventory.actions"
import { MaterialStockDataTable } from "./material-stock-data-table"

export const dynamic = "force-dynamic"

export default async function MaterialStockPage() {
  const groups = await getGroupedMaterialInventoryBalances()

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          자재재고현황
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          원자재·소모품과 구매입고된 반제품의 LOT별 현재고를 조회합니다.
          품목 행을 클릭하면 LOT별 상세 재고를 확인할 수 있습니다. 현재고가 0인 LOT는 기본적으로 숨겨집니다.
        </p>
      </div>

      <MaterialStockDataTable data={groups} />
    </div>
  )
}
