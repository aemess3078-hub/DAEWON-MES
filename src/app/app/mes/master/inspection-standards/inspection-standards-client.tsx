"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  InspectionSpecWithItems,
  deleteInspectionSpec,
} from "@/lib/actions/quality.actions"
import {
  getInspectionSpecColumns,
  InspectionSpecRow,
  STATUS_CONFIG,
} from "./inspection-spec-columns"
import { InspectionSpecFormSheet } from "./inspection-spec-form-sheet"

// ─── Types ────────────────────────────────────────────────────────────────────

interface InspectionStandardsClientProps {
  tenantId: string
  specs: InspectionSpecWithItems[]
  items: { id: string; code: string; name: string }[]
  routingOperations: {
    id: string
    name: string
    seq: number
    routingId: string
    routing: { id: string; code: string; name: string; version: string }
  }[]
}

const INPUT_TYPE_LABEL: Record<string, string> = {
  NUMERIC: "수치",
  TEXT: "텍스트",
  BOOLEAN: "합불",
  SELECT: "선택",
}

// ─── 확장 패널 ────────────────────────────────────────────────────────────────

function InspectionSpecExpandedPanel({ spec }: { spec: InspectionSpecRow }) {
  const statusCfg = STATUS_CONFIG[spec.status] ?? STATUS_CONFIG.DRAFT
  return (
    <div className="px-6 py-4 space-y-4 bg-slate-50/60 border-t">
      {/* 기본 정보 요약 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
        <InfoPair label="품목" value={spec.itemLabel} />
        <InfoPair label="공정" value={spec.operationLabel} />
        <InfoPair label="버전" value={spec.version} mono />
        <InfoPair
          label="상태"
          value={
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${statusCfg.className}`}>
              {statusCfg.label}
            </span>
          }
        />
      </div>

      {/* 검사항목 목록 */}
      <div>
        <p className="text-[13px] font-semibold text-foreground mb-2">
          검사항목 ({spec.inspectionItems.length}개)
        </p>
        {spec.inspectionItems.length === 0 ? (
          <div className="flex items-center justify-center py-6 border rounded-lg text-[13px] text-muted-foreground bg-white">
            등록된 검사항목이 없습니다.
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-white">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent bg-muted/30">
                  <TableHead className="w-14 text-[12px]">순번</TableHead>
                  <TableHead className="text-[12px]">항목명</TableHead>
                  <TableHead className="w-24 text-[12px]">입력유형</TableHead>
                  <TableHead className="w-24 text-right text-[12px]">하한값</TableHead>
                  <TableHead className="w-24 text-right text-[12px]">상한값</TableHead>
                  <TableHead className="w-16 text-[12px]">단위</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spec.inspectionItems
                  .slice()
                  .sort((a, b) => a.seq - b.seq)
                  .map((item) => (
                    <TableRow key={item.id} className="hover:bg-slate-50/50">
                      <TableCell className="text-[13px] text-muted-foreground font-mono">
                        {item.seq}
                      </TableCell>
                      <TableCell className="text-[13px] font-medium">
                        {item.name}
                      </TableCell>
                      <TableCell>
                        <span className="text-[12px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {INPUT_TYPE_LABEL[item.inputType] ?? item.inputType}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-[13px] font-mono text-muted-foreground">
                        {item.lowerLimit != null ? String(item.lowerLimit) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-[13px] font-mono text-muted-foreground">
                        {item.upperLimit != null ? String(item.upperLimit) : "—"}
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">
                        {item.unit ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}

function InfoPair({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-[13px] font-medium ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InspectionStandardsClient({
  tenantId,
  specs,
  items,
  routingOperations,
}: InspectionStandardsClientProps) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editingSpec, setEditingSpec] = useState<InspectionSpecWithItems | null>(null)
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null)

  const rows: InspectionSpecRow[] = specs.map((spec) => ({
    ...spec,
    itemLabel: `[${spec.item.code}] ${spec.item.name}`,
    operationLabel: `${spec.routingOperation.name} (seq.${spec.routingOperation.seq})`,
  }))

  const activeCount = specs.filter((s) => s.status === "ACTIVE").length
  const totalItems = specs.reduce((sum, s) => sum + s.inspectionItems.length, 0)

  function handleCreate() {
    setEditingSpec(null)
    setFormOpen(true)
  }

  function handleEdit(row: InspectionSpecRow) {
    setEditingSpec(row)
    setFormOpen(true)
  }

  async function handleDelete(row: InspectionSpecRow) {
    if (!confirm(`'[${row.item.code}] ${row.item.name}' 검사표준을 삭제하시겠습니까?\n연결된 검사항목도 함께 삭제됩니다.`)) return
    try {
      await deleteInspectionSpec(row.id)
      if (expandedRowId === row.id) setExpandedRowId(null)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const columns = getInspectionSpecColumns({
    onEdit: handleEdit,
    onDelete: handleDelete,
    expandedRowId,
    onExpandedRowIdChange: setExpandedRowId,
  })

  return (
    <div className="space-y-4">
      {/* 요약 카드 */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="전체 검사표준" value={specs.length} suffix="건" />
        <SummaryCard label="활성 표준" value={activeCount} suffix="건" accent="green" />
        <SummaryCard label="전체 검사항목" value={totalItems} suffix="개" />
      </div>

      <div className="flex justify-end">
        <Button onClick={handleCreate} className="gap-2">
          <Plus className="h-4 w-4" />
          검사표준 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        searchableColumns={[
          { id: "itemLabel" as keyof InspectionSpecRow, title: "품목" },
          { id: "operationLabel" as keyof InspectionSpecRow, title: "공정" },
        ]}
        filterableColumns={[
          {
            id: "status" as keyof InspectionSpecRow,
            title: "상태",
            options: Object.entries(STATUS_CONFIG).map(([value, cfg]) => ({
              label: cfg.label,
              value,
            })),
          },
        ]}
        getRowId={(row) => row.id}
        expandOnRowClick
        expandedRowId={expandedRowId}
        onExpandedRowIdChange={setExpandedRowId}
        renderExpandedRow={(row) => <InspectionSpecExpandedPanel spec={row} />}
      />

      <InspectionSpecFormSheet
        tenantId={tenantId}
        open={formOpen}
        onOpenChange={setFormOpen}
        editingSpec={editingSpec}
        items={items}
        routingOperations={routingOperations}
      />
    </div>
  )
}

// ─── 요약 카드 ────────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  suffix,
  accent,
}: {
  label: string
  value: number
  suffix?: string
  accent?: "green"
}) {
  const textColor = accent === "green" ? "text-emerald-700" : "text-foreground"
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold tabular-nums ${textColor}`}>
        {value.toLocaleString()}
        {suffix && (
          <span className="ml-1 text-[14px] font-normal text-muted-foreground">{suffix}</span>
        )}
      </p>
    </div>
  )
}
