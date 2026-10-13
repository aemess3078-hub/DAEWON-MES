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

import { getColumns, ItemPriceRow } from "./columns"
import { ItemPriceFormSheet } from "./item-price-form-sheet"
import { deleteItemPrice } from "@/lib/actions/item-price.actions"

// ─── Types ────────────────────────────────────────────────────────────────────

type PartnerOption = { id: string; name: string; code: string }
type ItemOption = { id: string; code: string; name: string }

interface ItemPriceDataTableProps {
  data: ItemPriceRow[]
  tenantId: string
  partners: PartnerOption[]
  items: ItemOption[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ItemPriceDataTable({
  data,
  tenantId,
  partners,
  items,
}: ItemPriceDataTableProps) {
  const router = useRouter()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetMode, setSheetMode] = useState<"create" | "edit">("create")
  const [selectedPrice, setSelectedPrice] = useState<ItemPriceRow | null>(null)

  // ─── 필터 ────────────────────────────────────────────────────────────────────
  const [priceTypeFilter, setPriceTypeFilter] = useState<"ALL" | "PURCHASE" | "SALES">("ALL")
  const [partnerFilter, setPartnerFilter] = useState("ALL")

  const filtered = useMemo(() => {
    return data.filter((row) => {
      const matchType = priceTypeFilter === "ALL" || row.priceType === priceTypeFilter
      const matchPartner = partnerFilter === "ALL" || row.partner.id === partnerFilter
      return matchType && matchPartner
    })
  }, [data, priceTypeFilter, partnerFilter])

  // ─── 핸들러 ──────────────────────────────────────────────────────────────────

  function handleEdit(row: ItemPriceRow) {
    setSelectedPrice(row)
    setSheetMode("edit")
    setSheetOpen(true)
  }

  async function handleDelete(id: string) {
    if (!confirm("단가를 삭제하시겠습니까?")) return
    try {
      await deleteItemPrice(id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  // ─── 테이블 ──────────────────────────────────────────────────────────────────

  const columns = useMemo(
    () => getColumns(handleEdit, handleDelete),
    [] // eslint-disable-line react-hooks/exhaustive-deps
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
        <Select
          value={priceTypeFilter}
          onValueChange={(v) => setPriceTypeFilter(v as "ALL" | "PURCHASE" | "SALES")}
        >
          <SelectTrigger className="w-36 text-[14px]">
            <SelectValue placeholder="단가 유형" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 유형</SelectItem>
            <SelectItem value="PURCHASE">구매</SelectItem>
            <SelectItem value="SALES">판매</SelectItem>
          </SelectContent>
        </Select>

        <Select value={partnerFilter} onValueChange={setPartnerFilter}>
          <SelectTrigger className="w-44 text-[14px]">
            <SelectValue placeholder="거래처" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 거래처</SelectItem>
            {partners.map((p) => (
              <SelectItem key={p.id} value={p.id} className="text-[13px]">
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto">
          <Button
            size="sm"
            onClick={() => {
              setSelectedPrice(null)
              setSheetMode("create")
              setSheetOpen(true)
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            단가 등록
          </Button>
        </div>
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
                <TableRow key={row.id} className="hover:bg-muted/20 transition-colors">
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
                  단가 데이터가 없습니다.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* FormSheet */}
      <ItemPriceFormSheet
        mode={sheetMode}
        itemPrice={selectedPrice}
        tenantId={tenantId}
        partners={partners}
        items={items}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
      />
    </div>
  )
}
