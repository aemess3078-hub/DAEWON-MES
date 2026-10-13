"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
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
import { AttachmentSection } from "@/components/common/attachments/attachment-section"
import {
  updateDefectCorrectiveAction,
  startDefectCorrectiveAction,
  completeDefectCorrectiveAction,
} from "@/lib/actions/defect-corrective-action.actions"
import { STATUS_CONFIG, type DefectCorrectiveActionRow } from "./columns"

const NONE_VALUE = "__NONE__"

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

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface CorrectiveActionDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionId: string | null
  row: DefectCorrectiveActionRow | null
  assignableUsers: { id: string; name: string }[]
  onChanged: () => void
}

export function CorrectiveActionDetailSheet({
  open,
  onOpenChange,
  actionId,
  row,
  assignableUsers,
  onChanged,
}: CorrectiveActionDetailSheetProps) {
  const [actionContent, setActionContent] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [completionNote, setCompletionNote] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [initializedFor, setInitializedFor] = useState<string | null>(null)

  useEffect(() => {
    if (open && row && initializedFor !== row.id) {
      setActionContent(row.actionContent)
      setAssigneeId(row.assigneeId ?? "")
      setDueDate(fmtDate(row.dueDate))
      setCompletionNote(row.completionNote ?? "")
      setInitializedFor(row.id)
    }
    if (!open) setInitializedFor(null)
  }, [open, row, initializedFor])

  if (!row || !actionId) return null

  const cfg = STATUS_CONFIG[row.status]

  async function handleSaveEdit() {
    if (!actionContent.trim()) {
      alert("조치내용을 입력해 주세요.")
      return
    }
    if (!dueDate) {
      alert("완료예정일을 입력해 주세요.")
      return
    }
    setIsSaving(true)
    try {
      await updateDefectCorrectiveAction(actionId!, {
        actionContent,
        assigneeId: assigneeId || null,
        dueDate,
      })
      onChanged()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleStart() {
    setIsTransitioning(true)
    try {
      const res = await startDefectCorrectiveAction(actionId!)
      if (!res.ok) {
        alert(res.error ?? "처리 중 오류가 발생했습니다.")
        return
      }
      onChanged()
    } finally {
      setIsTransitioning(false)
    }
  }

  async function handleComplete() {
    setIsTransitioning(true)
    try {
      const res = await completeDefectCorrectiveAction(actionId!, completionNote || null)
      if (!res.ok) {
        alert(res.error ?? "처리 중 오류가 발생했습니다.")
        return
      }
      onChanged()
    } finally {
      setIsTransitioning(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            조치 상세
            <Badge className={`${cfg.className} border-0 text-[12px] font-medium`}>{cfg.label}</Badge>
            {row.overdue && <Badge className="bg-red-100 text-red-700 border-0 text-[11px]">기한초과</Badge>}
          </SheetTitle>
          <SheetDescription>불량정보부터 조치 진행상태까지 한 화면에서 확인합니다.</SheetDescription>
        </SheetHeader>

        <div className="space-y-5 pt-4">
          {/* 불량정보 */}
          <div className="rounded-lg border p-3 space-y-1.5 text-[14px] bg-muted/30">
            <p className="text-[13px] font-semibold text-muted-foreground">불량정보</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div><span className="text-muted-foreground">검사일시</span> {fmtDateTime(row.inspectedAt)}</div>
              <div><span className="text-muted-foreground">작업지시</span> <span className="font-mono">{row.orderNo}</span></div>
              <div><span className="text-muted-foreground">제조번호</span> <span className="font-mono">{row.manufacturingNo ?? "—"}</span></div>
              <div><span className="text-muted-foreground">품목</span> [{row.itemCode}] {row.itemName}</div>
              <div><span className="text-muted-foreground">공정</span> {row.routingOperationName}</div>
              <div><span className="text-muted-foreground">불량코드</span> [{row.defectCode}] {row.defectCodeName}</div>
              <div><span className="text-muted-foreground">불량수량</span> {formatQuantity(row.defectQty)}</div>
              <div><span className="text-muted-foreground">심각도</span> {SEVERITY_LABEL[row.severity] ?? row.severity}</div>
              <div><span className="text-muted-foreground">처분</span> {row.disposition ? (DISPOSITION_LABEL[row.disposition] ?? row.disposition) : "—"}</div>
            </div>
          </div>

          {/* 원인분석 — 참조만, 이 화면에서는 수정하지 않는다 */}
          <div className="rounded-lg border p-3 space-y-1 text-[14px]">
            <p className="text-[13px] font-semibold text-muted-foreground">원인분석 (참조)</p>
            {row.rootCause ? (
              <>
                <p>{row.rootCause}</p>
                {row.analysisDetail && <p className="text-[13px] text-muted-foreground">{row.analysisDetail}</p>}
              </>
            ) : (
              <p className="text-muted-foreground">등록된 원인분석이 없습니다. 원인분석 등록은 품질검사 &gt; 원인분석 메뉴에서 진행하세요.</p>
            )}
          </div>

          {/* 조치내용 / 담당자 / 기한 (수정 가능) */}
          <div className="space-y-3">
            <p className="text-[13px] font-semibold text-muted-foreground">조치내용</p>
            <Textarea value={actionContent} onChange={(e) => setActionContent(e.target.value)} rows={4} />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">담당자</Label>
                <Select value={assigneeId || NONE_VALUE} onValueChange={(v) => setAssigneeId(v === NONE_VALUE ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="담당자 선택" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>미지정</SelectItem>
                    {assignableUsers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[13px]">완료예정일</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={handleSaveEdit} disabled={isSaving}>
              {isSaving ? "저장 중..." : "내용 저장"}
            </Button>
          </div>

          {/* 진행상태 / 완료결과 */}
          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-[13px] font-semibold text-muted-foreground">진행상태</p>
            {row.status === "OPEN" && (
              <Button size="sm" onClick={handleStart} disabled={isTransitioning}>
                {isTransitioning ? "처리 중..." : "조치 진행 시작"}
              </Button>
            )}
            {row.status === "IN_PROGRESS" && (
              <div className="space-y-2">
                <Label className="text-[13px]">완료결과 (선택)</Label>
                <Textarea
                  value={completionNote}
                  onChange={(e) => setCompletionNote(e.target.value)}
                  placeholder="조치 완료 결과를 입력하세요"
                  rows={3}
                />
                <Button size="sm" onClick={handleComplete} disabled={isTransitioning}>
                  {isTransitioning ? "처리 중..." : "조치 완료 처리"}
                </Button>
              </div>
            )}
            {row.status === "COMPLETED" && (
              <div className="text-[14px] space-y-1">
                <p><span className="text-muted-foreground">완료일</span> {row.completedAt ? fmtDateTime(row.completedAt) : "—"}</p>
                <p><span className="text-muted-foreground">완료결과</span> {row.completionNote ?? "—"}</p>
                {/* 조치가 완료된 불량은 재발방지관리 등록 대상이 될 수 있다(§ 재발방지관리 선행조건: 완료된 조치 1건 이상). 화면 이동 편의만을 위한 최소 연결 — 조치관리 기능 자체는 변경하지 않는다. */}
                <p className="pt-1">
                  <Link
                    href={`/app/mes/quality/recurrence-prevention${row.manufacturingNo ? `?manufacturingNo=${encodeURIComponent(row.manufacturingNo)}` : ""}`}
                    className="text-blue-700 hover:underline"
                  >
                    재발방지관리에서 진행 →
                  </Link>
                </p>
              </div>
            )}
          </div>

          {/* 첨부파일 — 조치관리 데이터/상태전이 로직과 완전히 독립된 부가기능(§ STEP 19) */}
          <AttachmentSection entityType="DEFECT_CORRECTIVE_ACTION" entityId={actionId!} />

          <div className="text-[12px] text-muted-foreground">
            등록: {row.createdByName} · 최종수정: {row.updatedByName} ({fmtDateTime(row.updatedAt)})
          </div>
        </div>

        <SheetFooter className="pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
