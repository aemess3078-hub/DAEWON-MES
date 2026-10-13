"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import {
  ColumnDef,
  ColumnFiltersState,
  ExpandedState,
  type Row,
  type RowSelectionState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { DataTablePagination } from "./data-table-pagination"
import { DataTableToolbar } from "./data-table-toolbar"
import { createSelectColumn } from "./select-column"
import {
  DataTableFilterableColumn,
  DataTableSearchableColumn,
} from "./types"

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchableColumns?: DataTableSearchableColumn<TData>[]
  filterableColumns?: DataTableFilterableColumn<TData>[]
  pageSize?: number
  defaultSorting?: SortingState
  onRowClick?: (row: TData) => void
  renderExpandedRow?: (row: TData) => React.ReactNode
  /** 행 클릭 시 해당 행의 expanded row를 토글한다(단일 열기). renderExpandedRow와 함께 사용. */
  expandOnRowClick?: boolean
  getRowId?: (originalRow: TData, index: number, parent?: Row<TData>) => string
  expandedRowId?: string | null
  onExpandedRowIdChange?: (rowId: string | null) => void
  /** 좌측에 체크박스 컬럼을 추가하고 현재 페이지 기준 선택을 지원한다. */
  enableRowSelection?: boolean
  /** 선택된 행이 바뀔 때마다 원본 데이터 배열로 전달된다. */
  onSelectionChange?: (selectedRows: TData[]) => void
  /** 값이 바뀔 때마다 선택 상태를 초기화한다(예: 일괄삭제 완료 후). */
  clearSelectionSignal?: number | string
}

function isInteractiveElement(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(target.closest("button,a,input,select,textarea,[role='button'],[role='menuitem']"))
    : false
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchableColumns = [],
  filterableColumns = [],
  pageSize = 20,
  defaultSorting = [],
  onRowClick,
  renderExpandedRow,
  expandOnRowClick = false,
  getRowId,
  expandedRowId,
  onExpandedRowIdChange,
  enableRowSelection = false,
  onSelectionChange,
  clearSelectionSignal,
}: DataTableProps<TData, TValue>) {
  const [internalExpanded, setInternalExpanded] = React.useState<ExpandedState>({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [sorting, setSorting] = React.useState<SortingState>(defaultSorting)
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [globalFilter, setGlobalFilter] = React.useState("")

  // searchableColumns가 2개 이상이면 단일 입력으로 여러 컬럼을 OR 검색하는
  // 전역 필터를 쓴다(1개일 때는 기존 per-column 필터 동작을 그대로 유지 —
  // 다른 화면의 기존 동작에 영향 없음).
  const useCombinedSearch = searchableColumns.length > 1
  const searchableColumnIds = React.useMemo(
    () => searchableColumns.map((c) => c.id),
    [searchableColumns]
  )
  const isExpandedControlled = expandedRowId !== undefined
  const expanded = React.useMemo<ExpandedState>(
    () => {
      if (!isExpandedControlled) return internalExpanded
      return expandedRowId ? { [expandedRowId]: true } : {}
    },
    [expandedRowId, internalExpanded, isExpandedControlled]
  )

  const tableColumns = React.useMemo(
    () => (enableRowSelection ? [createSelectColumn<TData>(), ...columns] : columns),
    [enableRowSelection, columns]
  )

  const table = useReactTable({
    data,
    columns: tableColumns,
    getRowId,
    state: {
      sorting,
      columnVisibility,
      columnFilters,
      expanded,
      rowSelection,
      ...(useCombinedSearch ? { globalFilter } : {}),
    },
    enableRowSelection,
    getRowCanExpand: () => Boolean(renderExpandedRow),
    onExpandedChange: isExpandedControlled ? undefined : setInternalExpanded,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    ...(useCombinedSearch
      ? {
          onGlobalFilterChange: setGlobalFilter,
          globalFilterFn: (row: Row<TData>, _columnId: string, filterValue: string) => {
            if (!filterValue) return true
            const needle = filterValue.toLowerCase()
            return searchableColumnIds.some((id) => {
              const value = row.getValue(id as string)
              return value != null && String(value).toLowerCase().includes(needle)
            })
          },
        }
      : {}),
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: {
      pagination: { pageSize },
    },
  })

  React.useEffect(() => {
    if (!enableRowSelection) return
    setRowSelection({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearSelectionSignal])

  React.useEffect(() => {
    if (!enableRowSelection || !onSelectionChange) return
    onSelectionChange(table.getSelectedRowModel().rows.map((row) => row.original))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection, enableRowSelection])

  return (
    <div className="space-y-4">
      <DataTableToolbar
        table={table}
        searchableColumns={searchableColumns}
        filterableColumns={filterableColumns}
      />
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} colSpan={header.colSpan}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <React.Fragment key={row.id}>
                  <TableRow
                    onClick={(event) => {
                      if (isInteractiveElement(event.target)) return
                      if (expandOnRowClick && renderExpandedRow) {
                        // 단일 열기: 클릭한 행만 펼치고 나머지는 닫음
                        if (isExpandedControlled) {
                          onExpandedRowIdChange?.(row.getIsExpanded() ? null : row.id)
                        } else {
                          table.setExpanded(row.getIsExpanded() ? {} : { [row.id]: true })
                        }
                      }
                      onRowClick?.(row.original)
                    }}
                    className={cn(
                      "group/row",
                      onRowClick || (expandOnRowClick && renderExpandedRow) ? "cursor-pointer" : undefined,
                      row.getIsExpanded() ? "bg-slate-50/70 hover:bg-slate-50" : undefined,
                      row.getIsSelected() ? "bg-primary/5 hover:bg-primary/10" : undefined
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() && renderExpandedRow && (
                    <TableRow>
                      <TableCell colSpan={row.getVisibleCells().length} className="bg-slate-50/70 p-0">
                        {renderExpandedRow(row.original)}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={tableColumns.length}
                  className="h-24 text-center text-[15px] text-muted-foreground"
                >
                  데이터가 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} />
    </div>
  )
}
