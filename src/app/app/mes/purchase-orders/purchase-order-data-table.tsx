"use client"

import { useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Plus } from "lucide-react"
import { PurchaseOrderStatus } from "@prisma/client"

import { getColumns, PurchaseOrderRow } from "./columns"
import { PurchaseOrderFormSheet } from "./purchase-order-form-sheet"
import { deletePurchaseOrder } from "@/lib/actions/purchase-order.actions"
import { useUserRole } from "@/lib/contexts/user-role-context"

// ─── Types ────────────────────────────────────────────────────────────────────

type SupplierOption = { id: string; name: string; code: string }
type ItemOption = { id: string; code: string; name: string }

interface PurchaseOrderDataTableProps {
  data: PurchaseOrderRow[]
  tenantId: string
  siteId: string
  suppliers: SupplierOption[]
  items: ItemOption[]
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT:            "초안",
  ORDERED:          "발주완료",
  PARTIAL_RECEIVED: "부분입고",
  RECEIVED:         "입고완료",
  CLOSED:           "종료",
  CANCELLED:        "취소",
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PurchaseOrderDataTable({
  data,
  tenantId,
  siteId,
  suppliers,
  items,
}: PurchaseOrderDataTableProps) {
  const router = useRouter()
  const canMutate = useUserRole() !== "VIEWER"

  // ─── Sheet 상태 ──────────────────────────────────────────────────────────────
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetMode, setSheetMode] = useState<"create" | "edit">("create")
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrderRow | null>(null)

  // ─── 필터 상태 ───────────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState("")
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | "ALL">("ALL")

  // ─── 필터링 ──────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return data.filter((row) => {
      const matchText =
        !searchText ||
        row.orderNo.toLowerCase().includes(searchText.toLowerCase()) ||
        row.supplier.name.toLowerCase().includes(searchText.toLowerCase())
      const matchStatus = statusFilter === "ALL" || row.status === statusFilter
      return matchText && matchStatus
    })
  }, [data, searchText, statusFilter])

  // ─── 컬럼 핸들러 ─────────────────────────────────────────────────────────────

  function handleEdit(row: PurchaseOrderRow) {
    setSelectedOrder(row)
    setSheetMode("edit")
    setSheetOpen(true)
  }

  async function handleDelete(id: string) {
    if (!confirm("발주를 삭제하시겠습니까? DRAFT 상태만 삭제할 수 있습니다.")) return
    try {
      await deletePurchaseOrder(id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  // ─── 테이블 ──────────────────────────────────────────────────────────────────

  const columns = useMemo(
    () => getColumns(handleEdit, handleDelete, canMutate),
    [canMutate] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex items-center gap-3">
        <Input
          placeholder="발주번호 또는 공급사 검색..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="max-w-xs text-[14px]"
        />

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as PurchaseOrderStatus | "ALL")}
        >
          <SelectTrigger className="w-36 text-[14px]">
            <SelectValue placeholder="상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 상태</SelectItem>
            {(Object.keys(STATUS_LABELS) as PurchaseOrderStatus[]).map((s) => (
              <SelectItem key={s} value={s} className="text-[13px]">
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canMutate && (
          <div className="ml-auto">
            <Button
              size="sm"
              onClick={() => {
                setSelectedOrder(null)
                setSheetMode("create")
                setSheetOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              신규 발주
            </Button>
          </div>
        )}
      </div>

      {/* 테이블 */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/30">
                {hg.headers.map((h) => (
                  <TableHead key={h.id} className="text-[13px] font-medium py-2.5">
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="hover:bg-muted/20 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="py-2.5">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-center py-12 text-[14px] text-muted-foreground"
                >
                  발주 데이터가 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* FormSheet */}
      <PurchaseOrderFormSheet
        mode={sheetMode}
        purchaseOrder={selectedOrder}
        tenantId={tenantId}
        siteId={siteId}
        suppliers={suppliers}
        items={items}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />

    </div>
  )
}
