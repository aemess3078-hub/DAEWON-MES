"use client"

import { useMemo, useState } from "react"
import { Search } from "lucide-react"

import { Input } from "@/components/ui/input"
import { DataTable } from "@/components/common/data-table"
import { getColumns } from "./columns"
import { type InventoryTransactionWithDetails } from "@/lib/actions/inventory.actions"

interface InventoryTransactionDataTableProps {
  data: InventoryTransactionWithDetails[]
}

export function InventoryTransactionDataTable({
  data,
}: InventoryTransactionDataTableProps) {
  const [keyword, setKeyword] = useState("")

  const columns = getColumns()

  const filteredData = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()
    if (!normalizedKeyword) return data

    return data.filter((transaction) => {
      const workOrder = transaction.workOrderLinks[0]?.workOrder
      const manufacturingNo =
        transaction.workOrderLinks[0]?.manufacturingNo ??
        workOrder?.manufacturingNo ??
        ""
      const haystack = [
        transaction.txNo,
        transaction.item.code,
        transaction.item.name,
        transaction.item.spec ?? "",
        transaction.lot?.lotNo ?? "",
        transaction.fromLocation?.name ?? "",
        transaction.toLocation?.name ?? "",
        workOrder?.orderNo ?? "",
        manufacturingNo,
        transaction.note ?? "",
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(normalizedKeyword)
    })
  }, [data, keyword])

  const filterableColumns = [
    {
      id: "txType" as keyof InventoryTransactionWithDetails,
      title: "거래유형",
      options: [
        { label: "입고", value: "RECEIPT" },
        { label: "출고", value: "ISSUE" },
        { label: "이동", value: "TRANSFER" },
        { label: "조정", value: "ADJUST" },
        { label: "반품", value: "RETURN" },
        { label: "폐기", value: "SCRAP" },
        { label: "공급사 반품", value: "SUPPLIER_RETURN" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="품목명 / 규격 / LOT / 작업지시 / 제조번호 검색"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            className="h-9 w-[360px] pl-9 text-[14px]"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filteredData}
        filterableColumns={filterableColumns}
      />
    </div>
  )
}
