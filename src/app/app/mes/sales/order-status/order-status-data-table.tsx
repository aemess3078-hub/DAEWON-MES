"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"

import { DataTable } from "@/components/common/data-table"
import { Input } from "@/components/ui/input"
import type { SalesOrderStatusRow } from "@/lib/actions/sales-order.actions"
import { getColumns } from "./columns"

interface OrderStatusDataTableProps {
  data: SalesOrderStatusRow[]
}

export function OrderStatusDataTable({ data }: OrderStatusDataTableProps) {
  const columns = getColumns()
  const [keyword, setKeyword] = useState("")
  const [orderDateFrom, setOrderDateFrom] = useState("")
  const [orderDateTo, setOrderDateTo] = useState("")

  const filteredData = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const fromTime = orderDateFrom ? new Date(`${orderDateFrom}T00:00:00`).getTime() : null
    const toTime = orderDateTo ? new Date(`${orderDateTo}T23:59:59`).getTime() : null

    return data.filter((order) => {
      const orderDateTime = new Date(order.orderDate).getTime()
      if (fromTime !== null && orderDateTime < fromTime) return false
      if (toTime !== null && orderDateTime > toTime) return false

      if (kw.length > 0) {
        const haystack = [
          order.orderNo,
          order.customer.name,
          order.customer.code,
          ...order.items.flatMap((item) => [item.item.code, item.item.name]),
        ]
          .join(" ")
          .toLowerCase()

        if (!haystack.includes(kw)) return false
      }

      return true
    })
  }, [data, keyword, orderDateFrom, orderDateTo])

  const filterableColumns = [
    {
      id: "status" as keyof SalesOrderStatusRow,
      title: "상태",
      options: [
        { label: "초안", value: "DRAFT" },
        { label: "확정", value: "CONFIRMED" },
        { label: "생산중", value: "IN_PRODUCTION" },
        { label: "부분출하", value: "PARTIAL_SHIPPED" },
        { label: "출하완료", value: "SHIPPED" },
        { label: "완료", value: "CLOSED" },
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
            placeholder="수주번호 / 거래처 / 품목 검색"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="h-9 w-[300px] pl-9 text-[14px]"
          />
        </div>

        <label className="space-y-1">
          <span className="block text-[13px] text-muted-foreground">수주일 시작</span>
          <Input
            type="date"
            value={orderDateFrom}
            onChange={(event) => setOrderDateFrom(event.target.value)}
            className="h-9 w-[150px] text-[14px]"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-[13px] text-muted-foreground">수주일 종료</span>
          <Input
            type="date"
            value={orderDateTo}
            onChange={(event) => setOrderDateTo(event.target.value)}
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
