export const dynamic = "force-dynamic"

import { getMaterialReturnList } from "@/lib/actions/material-return.actions"
import { MaterialReturnDataTable } from "./material-return-data-table"

export default async function MaterialReturnPage() {
  const returns = await getMaterialReturnList()

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">반품관리</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          정상 입고되어 재고화된 자재를 공급사에 반품 처리합니다
        </p>
      </div>
      <MaterialReturnDataTable data={returns} />
    </div>
  )
}
