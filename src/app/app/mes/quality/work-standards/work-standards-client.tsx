"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  BookOpen,
  FileText,
  Link2,
  FileX,
  ExternalLink,
  Pencil,
  Trash2,
  Plus,
  FileUp,
  Unlink,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/common/data-table"
import { ColumnDef } from "@tanstack/react-table"
import {
  createWorkStandardMapping,
  deleteWorkStandard,
  deleteWorkStandardMapping,
  getWorkStandardRoutingOperationOptions,
  updateWorkStandardMapping,
  type WorkStandardOperationOption,
  type WorkStandardsData,
  type WorkStandardRow,
} from "@/lib/actions/work-standards.actions"
import { WorkStandardsForm } from "./work-standards-form"

const DOC_TYPE_LABEL: Record<string, { label: string; className: string }> = {
  SOP: { label: "SOP", className: "bg-blue-100 text-blue-700 border-0" },
  DRAWING: { label: "DRAWING", className: "bg-violet-100 text-violet-700 border-0" },
  SPEC: { label: "SPEC", className: "bg-amber-100 text-amber-700 border-0" },
  CERTIFICATE: { label: "CERT", className: "bg-green-100 text-green-700 border-0" },
  OTHER: { label: "기타", className: "bg-slate-100 text-slate-600 border-0" },
}

const NONE_VALUE = "__none__"

interface Props {
  data: WorkStandardsData
}

export function WorkStandardsClient({ data }: Props) {
  const router = useRouter()
  const [formOpen, setFormOpen] = useState(false)
  const [editRow, setEditRow] = useState<WorkStandardRow | null>(null)
  const [mappingDocumentId, setMappingDocumentId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const mappingRow = useMemo(
    () => data.rows.find((row) => row.id === mappingDocumentId) ?? null,
    [data.rows, mappingDocumentId]
  )

  function openCreate() {
    setEditRow(null)
    setFormOpen(true)
  }

  function openEdit(row: WorkStandardRow) {
    setEditRow(row)
    setFormOpen(true)
  }

  function handleDelete(row: WorkStandardRow) {
    if (!confirm(`"${row.name}" 표준서를 삭제하시겠습니까?`)) return
    setDeleteError(null)
    startTransition(async () => {
      try {
        await deleteWorkStandard(row.id)
        if (mappingDocumentId === row.id) setMappingDocumentId(null)
        router.refresh()
      } catch (e: unknown) {
        setDeleteError(e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다.")
      }
    })
  }

  const columns: ColumnDef<WorkStandardRow>[] = [
    {
      accessorKey: "code",
      header: "문서코드",
      cell: ({ row }) => (
        <span className="font-mono text-[13px] font-medium">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "표준서명",
      cell: ({ row }) => (
        <div className="space-y-1">
          <span className="text-[14px]">{row.original.name}</span>
          {row.original.docType === "SOP" && row.original.mappingCount > 0 && (
            <div className="text-[12px] text-blue-600">
              POP 적용 {row.original.mappingCount}건
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "docType",
      header: "유형",
      cell: ({ row }) => {
        const cfg = DOC_TYPE_LABEL[row.original.docType] ?? DOC_TYPE_LABEL.OTHER
        return (
          <Badge className={`text-[12px] ${cfg.className}`}>{cfg.label}</Badge>
        )
      },
    },
    {
      accessorKey: "fileUrl",
      header: "파일",
      cell: ({ row }) => {
        const url = row.original.fileUrl
        const href = row.original.fileHref
        if (!url) {
          return (
            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
              <FileX className="h-3.5 w-3.5" />
              파일 없음
            </span>
          )
        }
        if (!href) {
          return (
            <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
              <FileX className="h-3.5 w-3.5" />
              링크 생성 실패
            </span>
          )
        }
        const isPdf =
          url.toLowerCase().endsWith(".pdf") ||
          url.includes("/storage/v1/object/")
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[13px] text-blue-600 hover:underline whitespace-nowrap"
          >
            {isPdf ? (
              <>
                <FileText className="h-3.5 w-3.5 text-red-500" />
                PDF 보기
              </>
            ) : (
              <>
                <ExternalLink className="h-3.5 w-3.5" />
                열기
              </>
            )}
          </a>
        )
      },
    },
    {
      accessorKey: "linkCount",
      header: "연결 수",
      cell: ({ row }) => (
        <div className="space-y-1 text-[14px] text-muted-foreground">
          <div>기존 {row.original.linkCount}</div>
          {row.original.docType === "SOP" && <div>POP {row.original.mappingCount}</div>}
        </div>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center gap-1 justify-end">
          {row.original.docType === "SOP" && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setMappingDocumentId(row.original.id)}
              title="적용 품목/공정 관리"
            >
              <Link2 className="h-4 w-4 text-blue-600" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => openEdit(row.original)}
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleDelete(row.original)}
            disabled={isPending}
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      ),
    },
  ]

  const { summary } = data

  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          icon={<BookOpen className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-50"
          label="전체 표준서"
          value={summary.total}
        />
        <SummaryCard
          icon={<FileText className="h-5 w-5 text-violet-600" />}
          iconBg="bg-violet-50"
          label="SOP"
          value={summary.sop}
        />
        <SummaryCard
          icon={<FileUp className="h-5 w-5 text-green-600" />}
          iconBg="bg-green-50"
          label="파일 있음"
          value={summary.withUrl}
        />
        <SummaryCard
          icon={<FileX className="h-5 w-5 text-slate-500" />}
          iconBg="bg-slate-50"
          label="파일 없음"
          value={summary.withoutUrl}
        />
      </div>

      {deleteError && (
        <div className="text-[14px] text-red-500 bg-red-50 rounded-md px-4 py-2">
          {deleteError}
        </div>
      )}

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="text-[15px] font-medium">표준서 목록</p>
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            등록
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={data.rows}
          filterableColumns={[
            {
              id: "docType",
              title: "유형",
              options: [
                { label: "SOP", value: "SOP" },
                { label: "DRAWING", value: "DRAWING" },
                { label: "SPEC", value: "SPEC" },
                { label: "CERTIFICATE", value: "CERTIFICATE" },
                { label: "OTHER", value: "OTHER" },
              ],
            },
          ]}
          searchableColumns={[
            { id: "code", title: "문서코드" },
            { id: "name", title: "표준서명" },
          ]}
        />
      </div>

      {mappingRow && (
        <WorkStandardMappingPanel
          row={mappingRow}
          items={data.items}
          onClose={() => setMappingDocumentId(null)}
          onChanged={() => router.refresh()}
        />
      )}

      <WorkStandardsForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editRow={editRow}
      />
    </>
  )
}

function WorkStandardMappingPanel({
  row,
  items,
  onClose,
  onChanged,
}: {
  row: WorkStandardRow
  items: WorkStandardsData["items"]
  onClose: () => void
  onChanged: () => void
}) {
  const [itemId, setItemId] = useState(NONE_VALUE)
  const [operationId, setOperationId] = useState(NONE_VALUE)
  const [displayOrder, setDisplayOrder] = useState("0")
  const [operations, setOperations] = useState<WorkStandardOperationOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadingOps, setLoadingOps] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setOperationId(NONE_VALUE)
    setOperations([])
    setError(null)
    if (itemId === NONE_VALUE) return

    let mounted = true
    setLoadingOps(true)
    getWorkStandardRoutingOperationOptions(itemId)
      .then((result) => {
        if (mounted) setOperations(result)
      })
      .catch((e: unknown) => {
        if (mounted) setError(e instanceof Error ? e.message : "공정 목록을 불러오지 못했습니다.")
      })
      .finally(() => {
        if (mounted) setLoadingOps(false)
      })

    return () => {
      mounted = false
    }
  }, [itemId])

  function refreshAfter(action: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await action()
        onChanged()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "처리 중 오류가 발생했습니다.")
      }
    })
  }

  function addMapping() {
    if (itemId === NONE_VALUE || operationId === NONE_VALUE) {
      setError("품목과 공정을 선택하세요.")
      return
    }
    refreshAfter(async () => {
      await createWorkStandardMapping({
        documentId: row.id,
        itemId,
        routingOperationId: operationId,
        displayOrder: Number(displayOrder) || 0,
      })
      setItemId(NONE_VALUE)
      setOperationId(NONE_VALUE)
      setDisplayOrder("0")
    })
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-blue-600" />
            <h2 className="text-[19px] font-semibold text-slate-900">적용 품목/공정</h2>
          </div>
          <p className="mt-1 text-[14px] text-slate-500">
            [{row.code}] {row.name} SOP를 POP에 표시할 품목과 라우팅 공정에 연결합니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>닫기</Button>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 px-3 py-2 text-[14px] text-red-600">
          {error}
        </div>
      )}

      <div className="mt-5 grid gap-3 rounded-lg border bg-slate-50 p-4 lg:grid-cols-[1.2fr_1.4fr_120px_auto]">
        <Select value={itemId} onValueChange={setItemId} disabled={isPending}>
          <SelectTrigger className="h-10 text-[14px] bg-white">
            <SelectValue placeholder="품목 선택" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>품목 선택</SelectItem>
            {items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                [{item.code}] {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={operationId} onValueChange={setOperationId} disabled={itemId === NONE_VALUE || loadingOps || isPending}>
          <SelectTrigger className="h-10 text-[14px] bg-white">
            <SelectValue placeholder={loadingOps ? "공정 불러오는 중" : "라우팅 공정 선택"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>라우팅 공정 선택</SelectItem>
            {operations.map((op) => (
              <SelectItem key={op.id} value={op.id}>
                {op.routingCode} v{op.routingVersion} / {op.seq}. [{op.operationCode}] {op.operationName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={displayOrder}
          onChange={(e) => setDisplayOrder(e.target.value)}
          type="number"
          className="h-10 bg-white text-[14px]"
          placeholder="표시순서"
          disabled={isPending}
        />

        <Button onClick={addMapping} disabled={isPending} className="h-10 gap-1.5">
          <Plus className="h-4 w-4" />
          추가
        </Button>
      </div>

      <div className="mt-5 space-y-2">
        {row.mappings.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-slate-50 px-4 py-6 text-center text-[14px] text-slate-500">
            아직 연결된 품목/공정이 없습니다.
          </div>
        ) : (
          row.mappings.map((mapping) => (
            <div key={mapping.id} className="grid gap-3 rounded-lg border px-4 py-3 lg:grid-cols-[1fr_1.4fr_110px_110px_44px] lg:items-center">
              <div>
                <div className="font-mono text-[13px] text-slate-500">{mapping.itemCode}</div>
                <div className="text-[14px] font-medium text-slate-900">{mapping.itemName}</div>
              </div>
              <div>
                <div className="text-[13px] text-slate-500">
                  {mapping.routingCode} v{mapping.routingVersion}
                </div>
                <div className="text-[14px] font-medium text-slate-900">
                  {mapping.operationCode} · {mapping.operationName}
                </div>
              </div>
              <Input
                type="number"
                defaultValue={mapping.displayOrder}
                className="h-9 text-[14px]"
                disabled={isPending}
                onBlur={(e) => {
                  const next = Number(e.currentTarget.value) || 0
                  if (next === mapping.displayOrder) return
                  refreshAfter(() => updateWorkStandardMapping(mapping.id, { isActive: mapping.isActive, displayOrder: next }))
                }}
              />
              <Button
                variant={mapping.isActive ? "default" : "outline"}
                size="sm"
                disabled={isPending}
                onClick={() => refreshAfter(() => updateWorkStandardMapping(mapping.id, { isActive: !mapping.isActive, displayOrder: mapping.displayOrder }))}
              >
                {mapping.isActive ? "사용중" : "비활성"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                disabled={isPending}
                onClick={() => {
                  if (confirm("이 SOP 매핑을 해제하시겠습니까?")) {
                    refreshAfter(() => deleteWorkStandardMapping(mapping.id))
                  }
                }}
              >
                <Unlink className="h-4 w-4 text-slate-500" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function SummaryCard({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: number
}) {
  return (
    <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
      <div className={`p-2 ${iconBg} rounded-lg`}>{icon}</div>
      <div>
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className="text-[22px] font-semibold">{value}</p>
      </div>
    </div>
  )
}
