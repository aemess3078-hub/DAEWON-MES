"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import type {
  DefectCauseAnalysisRow,
  DefectCauseAnalysisFilterOptions,
} from "@/lib/actions/defect-cause-analysis.actions"
import {
  createDefectCauseAnalysis,
  updateDefectCauseAnalysis,
} from "@/lib/actions/defect-cause-analysis.actions"
import { formatQuantity } from "@/lib/utils"
import { AttachmentSection } from "@/components/common/attachments/attachment-section"

const NONE_VALUE = "__ALL__"

const SEVERITY_LABEL: Record<string, string> = {
  CRITICAL: "치명",
  MAJOR: "주요",
  MINOR: "경미",
}

const DISPOSITION_LABEL: Record<string, string> = {
  SCRAP: "폐기",
  REWORK: "재작업",
  ACCEPT: "합격처리",
  USE_AS_IS: "특채",
}

const STAGE_LABEL: Record<string, string> = {
  FIRST: "초물",
  MID: "중간",
  FINAL: "종물",
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type FilterState = {
  from: string
  to: string
  itemId: string
  routingOperationId: string
  manufacturingNo: string
  defectCodeId: string
  analysisStatus: string
}

interface CauseAnalysisClientProps {
  initialFilter: FilterState
  rows: DefectCauseAnalysisRow[]
  filterOptions: DefectCauseAnalysisFilterOptions
}

export function CauseAnalysisClient({ initialFilter, rows, filterOptions }: CauseAnalysisClientProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterState>(initialFilter)
  const [, startTransition] = useTransition()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<DefectCauseAnalysisRow | null>(null)

  function pushFilter(next: FilterState) {
    setFilter(next)
    const params = new URLSearchParams()
    params.set("from", next.from)
    params.set("to", next.to)
    if (next.itemId) params.set("itemId", next.itemId)
    if (next.routingOperationId) params.set("routingOperationId", next.routingOperationId)
    if (next.manufacturingNo) params.set("manufacturingNo", next.manufacturingNo)
    if (next.defectCodeId) params.set("defectCodeId", next.defectCodeId)
    if (next.analysisStatus && next.analysisStatus !== "ALL") params.set("analysisStatus", next.analysisStatus)
    startTransition(() => router.push(`/app/mes/quality/cause-analysis?${params.toString()}`))
  }

  function resetFilter() {
    pushFilter({
      from: initialFilter.from,
      to: initialFilter.to,
      itemId: "",
      routingOperationId: "",
      manufacturingNo: "",
      defectCodeId: "",
      analysisStatus: "ALL",
    })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="text-[14px] font-medium text-foreground">조회조건</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[13px]">시작일</Label>
            <Input
              type="date"
              value={filter.from}
              onChange={(e) => setFilter({ ...filter, from: e.target.value })}
              onBlur={() => pushFilter(filter)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">종료일</Label>
            <Input
              type="date"
              value={filter.to}
              onChange={(e) => setFilter({ ...filter, to: e.target.value })}
              onBlur={() => pushFilter(filter)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">품목</Label>
            <Select value={filter.itemId || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, itemId: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>[{it.code}] {it.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">공정</Label>
            <Select value={filter.routingOperationId || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, routingOperationId: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.routingOperations.map((op) => (
                  <SelectItem key={op.id} value={op.id}>{op.routingCode} / {op.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">불량코드</Label>
            <Select value={filter.defectCodeId || NONE_VALUE} onValueChange={(v) => pushFilter({ ...filter, defectCodeId: v === NONE_VALUE ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="전체" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.defectCodes.map((dc) => (
                  <SelectItem key={dc.id} value={dc.id}>[{dc.code}] {dc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">분석여부</Label>
            <Select value={filter.analysisStatus} onValueChange={(v) => pushFilter({ ...filter, analysisStatus: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">전체</SelectItem>
                <SelectItem value="ANALYZED">분석완료</SelectItem>
                <SelectItem value="UNANALYZED">미분석</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="space-y-1.5 w-64">
            <Label className="text-[13px]">제조번호</Label>
            <Input
              placeholder="제조번호로 좁혀보기"
              value={filter.manufacturingNo}
              onChange={(e) => setFilter({ ...filter, manufacturingNo: e.target.value })}
              onBlur={() => pushFilter(filter)}
            />
          </div>
          <Button variant="ghost" size="sm" className="mt-6" onClick={resetFilter}>
            필터 초기화
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <div className="p-4 border-b text-[15px] font-medium text-foreground">
          원인분석 대상 목록 <span className="text-muted-foreground font-normal">({rows.length}건)</span>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>검사일시</TableHead>
                <TableHead>품목</TableHead>
                <TableHead>공정</TableHead>
                <TableHead>제조번호</TableHead>
                <TableHead>불량코드</TableHead>
                <TableHead>불량수량</TableHead>
                <TableHead>심각도</TableHead>
                <TableHead>처분</TableHead>
                <TableHead>분석여부</TableHead>
                <TableHead>근본원인</TableHead>
                <TableHead>최종수정자</TableHead>
                <TableHead>최종수정일</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                    조건에 해당하는 불량 기록이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.defectRecordId}>
                    <TableCell className="whitespace-nowrap">
                      {fmtDateTime(r.inspectedAt)}
                      <span className="ml-1 text-[13px] text-muted-foreground">{STAGE_LABEL[r.stage] ?? r.stage}</span>
                    </TableCell>
                    <TableCell>[{r.itemCode}] {r.itemName}</TableCell>
                    <TableCell>{r.routingOperationName}</TableCell>
                    <TableCell>{r.manufacturingNo ?? "—"}</TableCell>
                    <TableCell>[{r.defectCode}] {r.defectCodeName}</TableCell>
                    <TableCell>{formatQuantity(r.qty)}</TableCell>
                    <TableCell>{SEVERITY_LABEL[r.severity] ?? r.severity}</TableCell>
                    <TableCell>{r.disposition ? (DISPOSITION_LABEL[r.disposition] ?? r.disposition) : "—"}</TableCell>
                    <TableCell>
                      {r.analysisStatus === "ANALYZED" ? (
                        <Badge className="bg-green-100 text-green-700">분석완료</Badge>
                      ) : (
                        <Badge variant="secondary">미분석</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate">{r.rootCause ?? "—"}</TableCell>
                    <TableCell>{r.updatedByName ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{r.updatedAt ? fmtDateTime(r.updatedAt) : "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingRow(r)
                          setSheetOpen(true)
                        }}
                      >
                        {r.analysisStatus === "ANALYZED" ? "분석 수정" : "분석 등록"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <CauseAnalysisFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        row={editingRow}
        onSaved={() => router.refresh()}
      />
    </div>
  )
}

function CauseAnalysisFormSheet({
  open,
  onOpenChange,
  row,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  row: DefectCauseAnalysisRow | null
  onSaved: () => void
}) {
  const isEdit = row?.analysisStatus === "ANALYZED"
  const [rootCause, setRootCause] = useState("")
  const [analysisDetail, setAnalysisDetail] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [initializedFor, setInitializedFor] = useState<string | null>(null)

  if (open && row && initializedFor !== row.defectRecordId) {
    setRootCause(row.rootCause ?? "")
    setAnalysisDetail(row.analysisDetail ?? "")
    setInitializedFor(row.defectRecordId)
  }

  function resetAndClose() {
    setRootCause("")
    setAnalysisDetail("")
    setInitializedFor(null)
    onOpenChange(false)
  }

  async function handleSubmit() {
    if (!row) return
    if (!rootCause.trim()) {
      alert("근본원인을 입력해 주세요.")
      return
    }
    setIsLoading(true)
    try {
      if (isEdit && row.analysisId) {
        await updateDefectCauseAnalysis(row.analysisId, { rootCause, analysisDetail: analysisDetail || null })
      } else {
        await createDefectCauseAnalysis({ defectRecordId: row.defectRecordId, rootCause, analysisDetail: analysisDetail || null })
      }
      onSaved()
      resetAndClose()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={(v) => {
        if (!v) resetAndClose()
        else onOpenChange(v)
      }}
      mode={isEdit ? "edit" : "create"}
      title={isEdit ? "원인분석 수정" : "원인분석 등록"}
      description="불량 발생 원인을 등록하고 분석 내용을 기록합니다."
      isLoading={isLoading}
      onSubmit={handleSubmit}
    >
      {row && (
        <div className="space-y-4">
          <div className="rounded-lg border p-3 space-y-1.5 text-[14px] bg-muted/30">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div><span className="text-muted-foreground">검사일시</span> {fmtDateTime(row.inspectedAt)}</div>
              <div><span className="text-muted-foreground">품목</span> [{row.itemCode}] {row.itemName}</div>
              <div><span className="text-muted-foreground">공정</span> {row.routingOperationName}</div>
              <div><span className="text-muted-foreground">제조번호</span> {row.manufacturingNo ?? "—"}</div>
              <div><span className="text-muted-foreground">불량코드</span> [{row.defectCode}] {row.defectCodeName}</div>
              <div><span className="text-muted-foreground">수량</span> {formatQuantity(row.qty)}</div>
              <div><span className="text-muted-foreground">심각도</span> {SEVERITY_LABEL[row.severity] ?? row.severity}</div>
              <div><span className="text-muted-foreground">처분</span> {row.disposition ? (DISPOSITION_LABEL[row.disposition] ?? row.disposition) : "—"}</div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>근본원인 *</Label>
            <Input value={rootCause} onChange={(e) => setRootCause(e.target.value)} placeholder="예: 지그 마모로 인한 치수 이탈" />
          </div>
          <div className="space-y-1.5">
            <Label>분석상세</Label>
            <Textarea
              value={analysisDetail}
              onChange={(e) => setAnalysisDetail(e.target.value)}
              placeholder="상세 분석 내용을 입력하세요"
              rows={5}
            />
          </div>

          {row.analysisId && (
            <AttachmentSection entityType="DEFECT_CAUSE_ANALYSIS" entityId={row.analysisId} />
          )}
        </div>
      )}
    </FormSheet>
  )
}
