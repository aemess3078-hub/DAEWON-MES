export const dynamic = "force-dynamic"

import { getProjectOrderPriceList } from "@/lib/actions/project-order-price.actions"
import { ProjectPriceDataTable } from "./project-price-data-table"

export default async function ProjectPricesPage() {
  const prices = await getProjectOrderPriceList()

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">프로젝트 단가관리</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          프로젝트별 견적단가·수주단가·최종결정단가를 관리하고 가격 변경 흐름을 확인합니다
        </p>
      </div>
      <ProjectPriceDataTable data={prices} />
    </div>
  )
}
