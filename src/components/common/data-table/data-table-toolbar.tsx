"use client"

import { Table } from "@tanstack/react-table"
import { X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTableFacetedFilter } from "./data-table-faceted-filter"
import {
  DataTableFilterableColumn,
  DataTableSearchableColumn,
} from "./types"

interface DataTableToolbarProps<TData> {
  table: Table<TData>
  searchableColumns?: DataTableSearchableColumn<TData>[]
  filterableColumns?: DataTableFilterableColumn<TData>[]
}

export function DataTableToolbar<TData>({
  table,
  searchableColumns = [],
  filterableColumns = [],
}: DataTableToolbarProps<TData>) {
  // searchableColumns가 2개 이상이면 data-table.tsx가 켜 둔 전역 필터(OR 검색)를
  // 쓴다. 1개일 때는 기존 per-column 필터 동작 그대로 — 다른 화면 영향 없음.
  const useCombinedSearch = searchableColumns.length > 1
  const globalFilterValue = (table.getState() as { globalFilter?: string }).globalFilter ?? ""

  const isFiltered =
    table.getState().columnFilters.length > 0 || (useCombinedSearch && globalFilterValue.length > 0)
  const hasToolbarControls =
    searchableColumns.length > 0 || filterableColumns.length > 0 || isFiltered

  if (!hasToolbarControls) return null

  const searchPlaceholder = useCombinedSearch
    ? `${searchableColumns.map((c) => c.title).join(" / ")} 검색...`
    : `${searchableColumns[0]?.title} 검색...`

  const searchValue = useCombinedSearch
    ? globalFilterValue
    : ((table.getColumn(searchableColumns[0]?.id)?.getFilterValue() as string) ?? "")

  function handleSearchChange(value: string) {
    if (useCombinedSearch) {
      table.setGlobalFilter(value)
    } else {
      table.getColumn(searchableColumns[0]?.id)?.setFilterValue(value)
    }
  }

  return (
    <div className="flex items-center py-4">
      <div className="flex flex-1 items-center space-x-2">
        {searchableColumns.length > 0 && (
          <Input
            placeholder={searchPlaceholder}
            value={searchValue}
            onChange={(event) => handleSearchChange(event.target.value)}
            className="h-8 w-[150px] lg:w-[250px] text-[14px]"
          />
        )}
        {filterableColumns.map((column) =>
          table.getColumn(column.id) ? (
            <DataTableFacetedFilter
              key={column.id}
              column={table.getColumn(column.id)}
              title={column.title}
              options={column.options}
            />
          ) : null
        )}
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => {
              table.resetColumnFilters()
              if (useCombinedSearch) table.setGlobalFilter("")
            }}
            className="h-8 px-2 lg:px-3 text-[13px]"
          >
            초기화
            <X className="ml-2 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
