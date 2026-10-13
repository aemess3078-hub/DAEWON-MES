import {
  getItems,
  getItemCategories,
  getItemGroupsForForm,
  getWarehousesForItemForm,
} from "@/lib/actions/item.actions"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"
import { ItemDataTable } from "./item-data-table"

export const dynamic = "force-dynamic"

export default async function ItemsPage() {
  const [items, categories, itemGroups, warehouses, user] = await Promise.all([
    getItems(),
    getItemCategories(),
    getItemGroupsForForm(),
    getWarehousesForItemForm(),
    getCurrentUser(),
  ])

  const tenantId = items[0]?.tenantId ?? ""
  const canBulkDelete = isDeveloperUser(user) || user?.role === "OWNER" || user?.role === "ADMIN"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            품목관리
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            원자재, 반제품, 완제품 품목을 관리합니다.
          </p>
        </div>
      </div>

      <ItemDataTable
        items={items}
        categories={categories}
        itemGroups={itemGroups}
        warehouses={warehouses}
        tenantId={tenantId}
        canBulkDelete={canBulkDelete}
      />
    </div>
  )
}
