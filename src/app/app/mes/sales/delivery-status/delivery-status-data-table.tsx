"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"

import { DataTable } from "@/components/common/data-table"
import { Input } from "@/components/ui/input"
import type { DeliveryStatusRow } from "@/lib/actions/shipment.actions"
import { getColumns } from "./columns"

interface DeliveryStatusDataTableProps {
  data: DeliveryStatusRow[]
}

export function DeliveryStatusDataTable({ data }: DeliveryStatusDataTableProps) {
  const columns = getColumns()
  const [keyword, setKeyword] = useState("")
  const [shipmentDateFrom, setShipmentDateFrom] = useState("")
  const [shipmentDateTo, setShipmentDateTo] = useState("")

  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const fromTime = shipmentDateFrom ? new Date(`${shipmentDateFrom}T00:00:00`).getTime() : null
    const toTime = shipmentDateTo ? new Date(`${shipmentDateTo}T23:59:59`).getTime() : null

    return data.filter((delivery) => {
      const shipmentDateTime = getDisplayShipmentDate(delivery).getTime()
      if (fromTime !== null && shipmentDateTime < fromTime) return false
      if (toTime !== null && shipmentDateTime > toTime) return false

      if (kw.length > 0) {
        const haystack = [
          delivery.shipmentNo,
          delivery.salesOrder.orderNo,
          delivery.salesOrder.customer.code,
          delivery.salesOrder.customer.name,
          ...delivery.items.flatMap((item) => [item.item.code, item.item.name]),
          ...delivery.salesOrder.items.flatMap((item) => [item.item.code, item.item.name]),
        ]
          .join(" ")
          .toLowerCase()

        if (!haystack.includes(kw)) return false
      }

      return true
    })
  }, [data, keyword, shipmentDateFrom, shipmentDateTo])

  const filterableColumns = [
    {
      id: "status" as keyof DeliveryStatusRow,
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
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="출하번호 / 수주번호 / 거래처 / 품목 검색"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="h-9 w-[340px] pl-9 text-[14px]"
          />
        </div>

        <label className="space-y-1">
          <span className="block text-[13px] text-muted-foreground">출하일 시작</span>
          <Input
            type="date"
            value={shipmentDateFrom}
            onChange={(event) => setShipmentDateFrom(event.target.value)}
            className="h-9 w-[150px] text-[14px]"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-[13px] text-muted-foreground">출하일 종료</span>
          <Input
            type="date"
            value={shipmentDateTo}
            onChange={(event) => setShipmentDateTo(event.target.value)}
            className="h-9 w-[150px] text-[14px]"
          />
        </label>
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        filterableColumns={filterableColumns}
        pageSize={20}
      />
    </div>
  )
}

function getDisplayShipmentDate(delivery: DeliveryStatusRow) {
  return new Date(delivery.deliveredDate ?? delivery.shippedDate ?? delivery.plannedDate)
}
