import { getInventoryTransactions } from "@/lib/actions/inventory.actions"
import { InventoryTransactionDataTable } from "./inventory-transaction-data-table"

export const dynamic = "force-dynamic"

export default async function InventoryTransactionsPage() {
  const transactions = await getInventoryTransactions()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            전체입출고내역
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            입출고 이력 기준으로 LOT 입고, 출고, 조정 이력과 제조번호 연결 상태를 조회합니다.
          </p>
        </div>
      </div>

      <InventoryTransactionDataTable data={transactions} />
    </div>
  )
}
