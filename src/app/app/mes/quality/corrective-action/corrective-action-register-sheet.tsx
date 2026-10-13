"use client"

import { useEffect, useState } from "react"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatQuantity } from "@/lib/utils"
import {
  createDefectCorrectiveAction,
  getCorrectiveActionDefectOptions,
  type CorrectiveActionDefectOption,
} from "@/lib/actions/defect-corrective-action.actions"

const NONE_VALUE = "__NONE__"

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface CorrectiveActionRegisterSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  from: string
  to: string
  assignableUsers: { id: string; name: string }[]
  onSaved: () => void
}

export function CorrectiveActionRegisterSheet({
  open,
  onOpenChange,
  from,
  to,
  assignableUsers,
  onSaved,
}: CorrectiveActionRegisterSheetProps) {
  const [defectOptions, setDefectOptions] = useState<CorrectiveActionDefectOption[]>([])
  const [loadingDefects, setLoadingDefects] = useState(false)
  const [defectRecordId, setDefectRecordId] = useState("")
  const [actionContent, setActionContent] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    // 조치관리 목록 화면에서 현재 조회 중인 기간과 동일한 범위로 대상 불량을
    // 보여준다 — 등록 다이얼로그만 별도의 기본 30일 창을 쓰면, 목록에서 이미
    // 넓게 조회해 둔 오래된 불량이 선택지에 안 보이는 혼란을 막기 위함이다.
    setLoadingDefects(true)
    getCorrectiveActionDefectOptions({ from, to })
      .then(setDefectOptions)
      .finally(() => setLoadingDefects(false))
  }, [open, from, to])

  function resetAndClose() {
    setDefectRecordId("")
    setActionContent("")
    setAssigneeId("")
    setDueDate("")
    onOpenChange(false)
  }

  const selectedDefect = defectOptions.find((d) => d.defectRecordId === defectRecordId) ?? null

  async function handleSubmit() {
    if (!defectRecordId) {
      alert("조치를 등록할 불량을 선택해 주세요.")
      return
    }
    if (!actionContent.trim()) {
      alert("조치내용을 입력해 주세요.")
      return
    }
    if (!dueDate) {
      alert("완료예정일을 입력해 주세요.")
      return
    }
    setIsLoading(true)
    try {
      await createDefectCorrectiveAction({
        defectRecordId,
        actionContent,
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
      title="조치 등록"
      description="불량 발생 건에 대한 시정조치를 등록합니다."
      isLoading={isLoading}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>대상 불량 *</Label>
          <Select value={defectRecordId} onValueChange={setDefectRecordId} disabled={loadingDefects}>
            <SelectTrigger>
              <SelectValue placeholder={loadingDefects ? "불러오는 중..." : "조치할 불량을 선택하세요"} />
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
              조회 기간({from} ~ {to}) 내 대상 불량이 없습니다. 목록 화면에서 기간을 넓혀 다시 시도하세요.
            </p>
          )}
        </div>

        {selectedDefect && (
          <div className="rounded-lg border p-3 space-y-1.5 text-[14px] bg-muted/30">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div><span className="text-muted-foreground">검사일시</span> {fmtDateTime(selectedDefect.inspectedAt)}</div>
              <div><span className="text-muted-foreground">품목</span> [{selectedDefect.itemCode}] {selectedDefect.itemName}</div>
              <div><span className="text-muted-foreground">공정</span> {selectedDefect.routingOperationName}</div>
              <div><span className="text-muted-foreground">제조번호</span> {selectedDefect.manufacturingNo ?? "—"}</div>
              <div><span className="text-muted-foreground">불량코드</span> [{selectedDefect.defectCode}] {selectedDefect.defectCodeName}</div>
              <div><span className="text-muted-foreground">불량수량</span> {formatQuantity(selectedDefect.defectQty)}</div>
            </div>
            <div className="pt-1.5 border-t">
              <p className="text-muted-foreground">근본원인</p>
              <p>{selectedDefect.rootCause ?? "원인분석이 아직 등록되지 않았습니다."}</p>
              {selectedDefect.analysisDetail && (
                <p className="mt-1 text-[13px] text-muted-foreground">{selectedDefect.analysisDetail}</p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>조치내용 *</Label>
          <Textarea
            value={actionContent}
            onChange={(e) => setActionContent(e.target.value)}
            placeholder="예: 지그 마모 부위 교체 및 초물검사 강화"
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
            <Label>완료예정일 *</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
      </div>
    </FormSheet>
  )
}
