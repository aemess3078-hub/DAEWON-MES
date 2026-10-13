"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Truck, PackageCheck } from "lucide-react"
import { format, isPast } from "date-fns"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/common/data-table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getColumns, ShipmentRow } from "./columns"
import { ShipmentFormSheet } from "./shipment-form-sheet"
import { confirmShipment, deleteShipment } from "@/lib/actions/shipment.actions"
import { useUserRole } from "@/lib/contexts/user-role-context"

type SalesOrderOption = {
  id: string
  orderNo: string
  status: string
  deliveryDate?: Date | string | null
  customer: { name: string }
  items: {
    id: string
    itemId: string
    qty: number | string
    shippedQty: number | string
    item: { id: string; code: string; name: string; isLotTracked: boolean }
  }[]
}

type WarehouseOption = { id: string; code: string; name: string }

interface ShipmentDataTableProps {
  data: ShipmentRow[]
  tenantId: string
  salesOrders: SalesOrderOption[]
  warehouses: WarehouseOption[]
  initialSalesOrderId?: string
}

const SO_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  CONFIRMED:       { label: "수주 확정",  className: "bg-blue-50 text-blue-700 border-blue-200" },
  IN_PRODUCTION:   { label: "생산 중",    className: "bg-amber-50 text-amber-700 border-amber-200" },
  PARTIAL_SHIPPED: { label: "부분 출하",  className: "bg-purple-50 text-purple-700 border-purple-200" },
}

export function ShipmentDataTable({
  data,
  tenantId,
  salesOrders,
  warehouses,
  initialSalesOrderId,
}: ShipmentDataTableProps) {
  const router = useRouter()
  const canMutate = useUserRole() !== "VIEWER"
  const [formOpen, setFormOpen] = useState(false)
  const [preselectedOrderId, setPreselectedOrderId] = useState<string | undefined>()
  const [contextError, setContextError] = useState<string | null>(null)

  useEffect(() => {
    if (!initialSalesOrderId) return
    const order = salesOrders.find((so) => so.id === initialSalesOrderId)
    if (!order) {
      setContextError("전달된 수주가 현재 출하 대기 목록에 없거나 출하 가능한 상태가 아닙니다.")
      return
    }
    setContextError(null)
    setPreselectedOrderId(order.id)
    setFormOpen(true)
  }, [initialSalesOrderId, salesOrders])

  const openFormWithOrder = (orderId?: string) => {
    setPreselectedOrderId(orderId)
    setFormOpen(true)
  }

  const handleConfirm = async (id: string) => {
    const shipment = data.find((d) => d.id === id)
    if (!shipment) return
    if (!confirm(`'${shipment.shipmentNo}' 출하를 확정하면 실제 재고가 차감됩니다. 계속하시겠습니까?`)) return
    try {
      await confirmShipment(id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "확정 중 오류가 발생했습니다.")
    }
  }

  const handleDelete = async (id: string) => {
    const shipment = data.find((d) => d.id === id)
    if (!shipment) return
    if (shipment.status !== "PLANNED") {
      alert("PLANNED 상태인 출하만 삭제할 수 있습니다.")
      return
    }
    if (!confirm(`'${shipment.shipmentNo}' 출하를 삭제하시겠습니까?`)) return
    try {
      await deleteShipment(id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const allColumns = getColumns(handleConfirm, handleDelete)
  const columns = canMutate ? allColumns : allColumns.filter((c) => c.id !== "actions")

  const filterableColumns = [
    {
      id: "status" as keyof ShipmentRow,
      title: "상태",
      options: [
        { label: "출하예정", value: "PLANNED" },
        { label: "피킹완료", value: "PICKED" },
        { label: "출하완료", value: "SHIPPED" },
        { label: "배송완료", value: "DELIVERED" },
        { label: "취소", value: "CANCELLED" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      {initialSalesOrderId && (
        <div className={`flex items-center justify-between rounded-lg border px-4 py-3 text-[14px] ${
          contextError
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-blue-200 bg-blue-50 text-blue-800"
        }`}>
          <span>{contextError ?? "수주 컨텍스트를 유지해 출하예정 등록 화면을 열었습니다."}</span>
          <Button variant="outline" size="sm" className="h-8 bg-white text-[13px]" asChild>
            <Link href="/app/mes/shipments">전체 보기</Link>
          </Button>
        </div>
      )}
      <Tabs defaultValue="pending">
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            <PackageCheck className="h-3.5 w-3.5" />
            출하 대기
            {salesOrders.length > 0 && (
              <span className="ml-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold px-1.5 py-0.5">
                {salesOrders.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="list" className="gap-1.5">
            <Truck className="h-3.5 w-3.5" />
            출하 목록
          </TabsTrigger>
        </TabsList>

        {/* ── 출하 대기 탭 ── */}
        <TabsContent value="pending" className="mt-4">
          {salesOrders.length === 0 ? (
            <div className="border rounded-xl py-16 text-center text-[14px] text-muted-foreground">
              출하 대기 중인 수주가 없습니다.
            </div>
          ) : (
            <div className="border rounded-xl overflow-hidden">
              {/* 헤더 */}
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr_120px] bg-muted/30 border-b">
                {["수주번호", "고객사", "납기일", "상태", ""].map((h) => (
                  <div key={h} className="px-4 py-2.5 text-[13px] font-medium text-muted-foreground last:text-right">
                    {h}
                  </div>
                ))}
              </div>

              <div className="divide-y">
                {salesOrders.map((so) => {
                  const cfg = SO_STATUS_CONFIG[so.status] ?? { label: so.status, className: "" }
                  const pendingItems = so.items.filter(
                    (i) => Number(i.qty) - Number(i.shippedQty) > 0
                  )
                  const deliveryDate = so.deliveryDate ? new Date(so.deliveryDate) : null
                  const isOverdue = deliveryDate && isPast(deliveryDate)

                  return (
                    <div
                      key={so.id}
                      className="grid grid-cols-[1fr_1fr_1fr_1fr_120px] items-center hover:bg-muted/20 transition-colors"
                    >
                      <div className="px-4 py-3">
                        <span className="font-mono text-[13px] font-medium">{so.orderNo}</span>
                        <span className="ml-2 text-[12px] text-muted-foreground">
                          {pendingItems.length}개 품목
                        </span>
                      </div>
                      <div className="px-4 py-3 text-[14px]">{so.customer.name}</div>
                      <div className="px-4 py-3">
                        {deliveryDate ? (
                          <span className={`text-[13px] font-medium ${isOverdue ? "text-red-600" : "text-muted-foreground"}`}>
                            {format(deliveryDate, "yyyy-MM-dd")}
                            {isOverdue && <span className="ml-1 text-[11px]">(지연)</span>}
                          </span>
                        ) : (
                          <span className="text-[13px] text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium border ${cfg.className}`}>
                          {cfg.label}
                        </span>
                      </div>
                      <div className="px-4 py-3 flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[12px] gap-1.5"
                          onClick={() => openFormWithOrder(so.id)}
                        >
                          <Truck className="h-3.5 w-3.5" />
                          출하예정 등록
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── 출하 목록 탭 ── */}
        <TabsContent value="list" className="mt-4 space-y-4">
          {canMutate && (
            <div className="flex justify-end">
              <Button onClick={() => openFormWithOrder(undefined)}>
                <Plus className="mr-2 h-4 w-4" />
                출하예정 등록
              </Button>
            </div>
          )}
          <DataTable
            columns={columns}
            data={data}
            searchableColumns={[
              { id: "shipmentNo" as keyof ShipmentRow, title: "출하번호" },
            ]}
            filterableColumns={filterableColumns}
          />
        </TabsContent>
      </Tabs>

      <ShipmentFormSheet
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setPreselectedOrderId(undefined)
        }}
        tenantId={tenantId}
        salesOrders={salesOrders}
        warehouses={warehouses}
        defaultSalesOrderId={preselectedOrderId}
      />
    </div>
  )
}
