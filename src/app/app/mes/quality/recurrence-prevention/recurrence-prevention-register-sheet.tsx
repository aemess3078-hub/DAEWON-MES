"use client"

import { useEffect, useState } from "react"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatQuantity } from "@/lib/utils"
import {
  createDefectRecurrencePrevention,
  getRecurrencePreventionDefectOptions,
  type RecurrencePreventionDefectOption,
} from "@/lib/actions/defect-recurrence-prevention.actions"

const NONE_VALUE = "__NONE__"

const CORRECTIVE_STATUS_LABEL: Record<string, string> = {
  OPEN: "등록",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface RecurrencePreventionRegisterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  from: string
  to: string
  assignableUsers: { id: string; name: string }[]
  onSaved: () => void
}

export function RecurrencePreventionRegisterSheet({
  open,
  onOpenChange,
  from,
  to,
  assignableUsers,
  onSaved,
}: RecurrencePreventionRegisterSheetProps) {
  const [defectOptions, setDefectOptions] = useState<RecurrencePreventionDefectOption[]>([])
  const [loadingDefects, setLoadingDefects] = useState(false)
  const [defectRecordId, setDefectRecordId] = useState("")
  const [preventionContent, setPreventionContent] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    // 재발방지관리 목록 화면에서 현재 조회 중인 기간과 동일한 범위로 대상 불량을
    // 보여준다(조치관리 등록 다이얼로그와 동일한 이유).
    setLoadingDefects(true)
    getRecurrencePreventionDefectOptions({ from, to })
      .then(setDefectOptions)
      .finally(() => setLoadingDefects(false))
  }, [open, from, to])

  function resetAndClose() {
    setDefectRecordId("")
    setPreventionContent("")
    setAssigneeId("")
    setDueDate("")
    onOpenChange(false)
  }

  const selectedDefect = defectOptions.find((d) => d.defectRecordId === defectRecordId) ?? null

  async function handleSubmit() {
    if (!defectRecordId) {
      alert("재발방지 대책을 등록할 불량을 선택해 주세요.")
      return
    }
    if (!preventionContent.trim()) {
      alert("재발방지 대책을 입력해 주세요.")
      return
    }
    if (!dueDate) {
      alert("목표일을 입력해 주세요.")
      return
    }
    setIsLoading(true)
    try {
      await createDefectRecurrencePrevention({
        defectRecordId,
        preventionContent,
        assigneeId: assigneeId || null,
        dueDate,
      })
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
      mode="create"
      title="재발방지 등록"
      description="완료된 조치가 있는 불량을 대상으로 재발방지 대책을 등록합니다."
      isLoading={isLoading}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>대상 불량 *</Label>
          <Select value={defectRecordId} onValueChange={setDefectRecordId} disabled={loadingDefects}>
            <SelectTrigger>
              <SelectValue placeholder={loadingDefects ? "불러오는 중..." : "재발방지를 등록할 불량을 선택하세요"} />
            </SelectTrigger>
            <SelectContent>
              {defectOptions.map((d) => (
                <SelectItem key={d.defectRecordId} value={d.defectRecordId}>
                  [{d.orderNo}] {d.itemName} · [{d.defectCode}] {d.defectCodeName} · {formatQuantity(d.defectQty)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!loadingDefects && defectOptions.length === 0 && (
            <p className="text-[12px] text-muted-foreground">
              조회 기간({from} ~ {to}) 내 완료된 조치가 있는 불량이 없습니다. 재발방지관리는 조치관리에서
              최소 1건 이상 완료된 불량만 대상으로 할 수 있습니다. 목록 화면에서 기간을 넓혀 다시 시도하세요.
            </p>
          )}
        </div>

        {selectedDefect && (
          <div className="rounded-lg border p-3 space-y-2 text-[14px] bg-muted/30">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div><span className="text-muted-foreground">검사일시</span> {fmtDateTime(selectedDefect.inspectedAt)}</div>
              <div><span className="text-muted-foreground">품목</span> [{selectedDefect.itemCode}] {selectedDefect.itemName}</div>
              <div><span className="text-muted-foreground">공정</span> {selectedDefect.routingOperationName}</div>
              <div><span className="text-muted-foreground">제조번호</span> {selectedDefect.manufacturingNo ?? "—"}</div>
              <div><span className="text-muted-foreground">불량코드</span> [{selectedDefect.defectCode}] {selectedDefect.defectCodeName}</div>
              <div><span className="text-muted-foreground">불량수량</span> {formatQuantity(selectedDefect.defectQty)}</div>
            </div>
            <div className="pt-1.5 border-t">
              <p className="text-muted-foreground">근본원인 (원인분석 참조)</p>
              <p>{selectedDefect.rootCause ?? "—"}</p>
              {selectedDefect.analysisDetail && (
                <p className="mt-1 text-[13px] text-muted-foreground">{selectedDefect.analysisDetail}</p>
              )}
            </div>
            <div className="pt-1.5 border-t space-y-1">
              <p className="text-muted-foreground">조치관리 이력 (참조)</p>
              {selectedDefect.correctiveActions.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-[13px]">
                  <Badge
                    className={`border-0 text-[11px] ${a.status === "COMPLETED" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"}`}
                  >
                    {CORRECTIVE_STATUS_LABEL[a.status] ?? a.status}
                  </Badge>
                  <span className="truncate">{a.actionContent}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>재발방지 대책 *</Label>
          <Textarea
            value={preventionContent}
            onChange={(e) => setPreventionContent(e.target.value)}
            placeholder="예: 작업표준서 개정 및 초물검사 항목에 치수 측정 추가, 담당자 교육 실시"
            rows={4}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>담당자</Label>
            <Select value={assigneeId || NONE_VALUE} onValueChange={(v) => setAssigneeId(v === NONE_VALUE ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="담당자 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>미지정</SelectItem>
                {assignableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>목표일 *</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
      </div>
    </FormSheet>
  )
}
