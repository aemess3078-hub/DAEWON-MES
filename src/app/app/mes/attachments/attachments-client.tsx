"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Download, Trash2 } from "lucide-react"
import { ColumnDef } from "@tanstack/react-table"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/common/data-table"
import { getAttachmentDownloadUrl, deleteAttachment, type AttachmentRow } from "@/lib/actions/attachment.actions"
import { ATTACHMENT_ENTITY_TYPES, ATTACHMENT_ENTITY_TYPE_LABEL, ALLOWED_ATTACHMENT_EXTENSIONS, formatFileSize } from "@/lib/actions/attachment.helpers"

const NONE_VALUE = "__ALL__"

type FilterState = {
  entityType: string
  extension: string
  from: string
  to: string
}

interface AttachmentsClientProps {
  initialFilter: FilterState
  rows: AttachmentRow[]
}

export function AttachmentsClient({ initialFilter, rows }: AttachmentsClientProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterState>(initialFilter)
  const [, startTransition] = useTransition()

  function pushFilter(next: FilterState) {
    setFilter(next)
    const params = new URLSearchParams()
    if (next.entityType) params.set("entityType", next.entityType)
    if (next.extension) params.set("extension", next.extension)
    if (next.from) params.set("from", next.from)
    if (next.to) params.set("to", next.to)
    startTransition(() => router.push(`/app/mes/attachments?${params.toString()}`))
  }

  function resetFilter() {
    pushFilter({ entityType: "", extension: "", from: "", to: "" })
  }

  async function handleDownload(row: AttachmentRow) {
    try {
      const { url } = await getAttachmentDownloadUrl(row.id)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (e) {
      alert(e instanceof Error ? e.message : "다운로드 링크 생성에 실패했습니다.")
    }
  }

  async function handleDelete(row: AttachmentRow) {
    if (!confirm(`'${row.fileName}' 파일을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return
    const res = await deleteAttachment(row.id)
    if (!res.ok) {
      alert(res.error ?? "삭제 중 오류가 발생했습니다.")
      return
    }
    router.refresh()
  }

  const columns: ColumnDef<AttachmentRow>[] = [
    {
      accessorKey: "fileName",
      header: "파일명",
      cell: ({ row }) => <span className="text-[13px] font-medium">{row.original.fileName}</span>,
    },
    {
      accessorKey: "entityTypeLabel",
      header: "업무구분",
      cell: ({ row }) => <span className="text-[13px]">{row.original.entityTypeLabel}</span>,
    },
    {
      accessorKey: "entityLabel",
      header: "연결대상",
      cell: ({ row }) => <span className="text-[13px]">{row.original.entityLabel}</span>,
    },
    {
      id: "fileSize",
      header: "파일크기",
      cell: ({ row }) => <span className="text-[13px] tabular-nums">{formatFileSize(row.original.fileSize)}</span>,
    },
    {
      accessorKey: "uploadedByName",
      header: "업로드자",
      cell: ({ row }) => <span className="text-[13px]">{row.original.uploadedByName}</span>,
    },
    {
      accessorKey: "createdAt",
      header: "업로드일시",
      cell: ({ row }) => <span className="text-[13px] whitespace-nowrap">{row.original.createdAt.replace("T", " ").slice(0, 16)}</span>,
    },
    {
      id: "actions",
      header: "작업",
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(row.original)} title="다운로드">
            <Download className="h-3.5 w-3.5" />
          </Button>
          {row.original.canDelete && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => handleDelete(row.original)} title="삭제">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="text-[14px] font-medium text-foreground">조회조건</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[13px]">업무구분</Label>
            <Select value={filter.entityType || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, entityType: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {ATTACHMENT_ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{ATTACHMENT_ENTITY_TYPE_LABEL[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">파일형식</Label>
            <Select value={filter.extension || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, extension: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {ALLOWED_ATTACHMENT_EXTENSIONS.map((ext) => (
                  <SelectItem key={ext} value={ext}>.{ext}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">시작일</Label>
            <Input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, from: e.target.value })} onBlur={() => pushFilter(filter)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">종료일</Label>
            <Input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, to: e.target.value })} onBlur={() => pushFilter(filter)} />
          </div>
        </div>
        <div>
          <Button variant="ghost" size="sm" onClick={resetFilter}>필터 초기화</Button>
        </div>
      </div>

      <p className="text-[15px] font-medium text-foreground">
        첨부파일 목록 <span className="text-muted-foreground font-normal">({rows.length}건)</span>
      </p>

      <DataTable
        columns={columns}
        data={rows}
        searchableColumns={[
          { id: "fileName", title: "파일명" },
          { id: "entityLabel", title: "연결대상" },
        ]}
      />
    </div>
  )
}
