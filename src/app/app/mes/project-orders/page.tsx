export const dynamic = "force-dynamic"

import {
  getProjectOrders,
  getProjectOrderSites,
  getProjectOrderCustomers,
  getProjectOrderItems,
  getProjectOrderAssignableUsers,
  getProjectOrderSalesOrders,
} from "@/lib/actions/project-order.actions"
import { ProjectOrderDataTable } from "./project-order-data-table"

export default async function ProjectOrdersPage() {
  const [projectOrders, sites, customers, items, users, salesOrders] = await Promise.all([
    getProjectOrders(),
    getProjectOrderSites(),
    getProjectOrderCustomers(),
    getProjectOrderItems(),
    getProjectOrderAssignableUsers(),
    getProjectOrderSalesOrders(),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">프로젝트 오더</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          거래처 수주를 프로젝트 단위로 등록하고 담당자·납기를 관리합니다
        </p>
      </div>
      <ProjectOrderDataTable
        data={projectOrders}
        sites={sites}
        customers={customers}
        items={items}
        users={users}
        salesOrders={salesOrders}
      />
    </div>
  )
}
