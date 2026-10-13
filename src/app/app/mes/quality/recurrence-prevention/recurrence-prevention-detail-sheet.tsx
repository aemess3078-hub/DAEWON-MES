"use client"

import { useEffect, useState } from "react"
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
  updateDefectRecurrencePrevention,
  startDefectRecurrencePrevention,
  submitDefectRecurrencePreventionForVerification,
  verifyDefectRecurrencePrevention,
} from "@/lib/actions/defect-recurrence-prevention.actions"
import { STATUS_CONFIG, VERIFICATION_RESULT_CONFIG, type DefectRecurrencePreventionRow } from "./columns"

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

const CORRECTIVE_STATUS_LABEL: Record<string, string> = {
  OPEN: "등록",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface RecurrencePreventionDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preventionId: string | null
  row: DefectRecurrencePreventionRow | null
  assignableUsers: { id: string; name: string }[]
  onChanged: () => void
}

export function RecurrencePreventionDetailSheet({
  open,
  onOpenChange,
  preventionId,
  row,
  assignableUsers,
  onChanged,
}: RecurrencePreventionDetailSheetProps) {
  const [preventionContent, setPreventionContent] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [dueDate, setDueDate] = useState("")
  const [verificationContent, setVerificationContent] = useState("")
  const [verificationResult, setVerificationResult] = useState<"EFFECTIVE" | "INEFFECTIVE" | "">("")
  const [verifierId, setVerifierId] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [initializedFor, setInitializedFor] = useState<string | null>(null)

  useEffect(() => {
    if (open && row && initializedFor !== row.id) {
      setPreventionContent(row.preventionContent)
      setAssigneeId(row.assigneeId ?? "")
      setDueDate(fmtDate(row.dueDate))
      setVerificationContent(row.verificationContent ?? "")
      setVerificationResult("")
      setVerifierId(row.verifierId ?? "")
      setInitializedFor(row.id)
    }
    if (!open) setInitializedFor(null)
  }, [open, row, initializedFor])

  if (!row || !preventionId) return null

  const cfg = STATUS_CONFIG[row.status]

  async function handleSaveEdit() {
    if (!preventionContent.trim()) {
      alert("재발방지 대책을 입력해 주세요.")
      return
    }
    if (!dueDate) {
      alert("목표일을 입력해 주세요.")
      return
    }
    setIsSaving(true)
    try {
      await updateDefectRecurrencePrevention(preventionId!, {
        preventionContent,
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
      const res = await startDefectRecurrencePrevention(preventionId!)
      if (!res.ok) {
        alert(res.error ?? "처리 중 오류가 발생했습니다.")
        return
      }
      onChanged()
    } finally {
      setIsTransitioning(false)
    }
  }

  async function handleSubmitForVerification() {
    setIsTransitioning(true)
    try {
      const res = await submitDefectRecurrencePreventionForVerification(preventionId!)
      if (!res.ok) {
        alert(res.error ?? "처리 중 오류가 발생했습니다.")
        return
      }
      onChanged()
    } finally {
      setIsTransitioning(false)
    }
  }

  async function handleVerify() {
    if (!verificationContent.trim()) {
      alert("검증내용을 입력해 주세요.")
      return
    }
    if (verificationResult !== "EFFECTIVE" && verificationResult !== "INEFFECTIVE") {
      alert("검증결과를 선택해 주세요.")
      return
    }
    if (!verifierId) {
      alert("검증담당자를 선택해 주세요.")
      return
    }
    setIsTransitioning(true)
    try {
      const res = await verifyDefectRecurrencePrevention(preventionId!, {
        verificationContent,
        verificationResult,
        verifierId,
      })
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
            재발방지 상세
            <Badge className={`${cfg.className} border-0 text-[12px] font-medium`}>{cfg.label}</Badge>
            {row.overdue && <Badge className="bg-red-100 text-red-700 border-0 text-[11px]">기한초과</Badge>}
          </SheetTitle>
          <SheetDescription>불량정보부터 효과성 검증까지 CAPA 흐름을 한 화면에서 확인합니다.</SheetDescription>
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

          {/* 조치관리 이력 — 참조만, 이 화면에서는 수정하지 않는다 */}
          <div className="rounded-lg border p-3 space-y-1.5 text-[14px]">
            <p className="text-[13px] font-semibold text-muted-foreground">조치관리 이력 (참조)</p>
            {row.correctiveActions.length === 0 ? (
              <p className="text-muted-foreground">등록된 조치가 없습니다. 조치 등록은 품질검사 &gt; 조치관리 메뉴에서 진행하세요.</p>
            ) : (
              <div className="space-y-1">
                {row.correctiveActions.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 text-[13px]">
                    <Badge
                      className={`border-0 text-[11px] shrink-0 ${a.status === "COMPLETED" ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-700"}`}
                    >
                      {CORRECTIVE_STATUS_LABEL[a.status] ?? a.status}
                    </Badge>
                    <span>{a.actionContent}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 재발방지 대책 / 담당자 / 목표일 (수정 가능) */}
          <div className="space-y-3">
            <p className="text-[13px] font-semibold text-muted-foreground">재발방지 대책</p>
            <Textarea value={preventionContent} onChange={(e) => setPreventionContent(e.target.value)} rows={4} />
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
                <Label className="text-[13px]">목표일</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={handleSaveEdit} disabled={isSaving}>
              {isSaving ? "저장 중..." : "내용 저장"}
            </Button>
          </div>

          {/* 진행상태 / 효과성 검증 */}
          <div className="rounded-lg border p-3 space-y-3">
            <p className="text-[13px] font-semibold text-muted-foreground">진행상태</p>
            {row.status === "OPEN" && (
              <Button size="sm" onClick={handleStart} disabled={isTransitioning}>
                {isTransitioning ? "처리 중..." : "대책 수행 시작"}
              </Button>
            )}
            {row.status === "IN_PROGRESS" && (
              <Button size="sm" onClick={handleSubmitForVerification} disabled={isTransitioning}>
                {isTransitioning ? "처리 중..." : "검증 요청"}
              </Button>
            )}
            {row.status === "VERIFYING" && (
              <div className="space-y-2">
                <Label className="text-[13px]">검증내용 *</Label>
                <Textarea
                  value={verificationContent}
                  onChange={(e) => setVerificationContent(e.target.value)}
                  placeholder="효과성 검증 내용을 입력하세요"
                  rows={3}
                />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">검증결과 *</Label>
                    <Select value={verificationResult} onValueChange={(v) => setVerificationResult(v as "EFFECTIVE" | "INEFFECTIVE")}>
                      <SelectTrigger><SelectValue placeholder="검증결과 선택" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EFFECTIVE">유효 (재발방지 완료)</SelectItem>
                        <SelectItem value="INEFFECTIVE">무효 (추가 대책 필요)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[13px]">검증담당자 *</Label>
                    <Select value={verifierId} onValueChange={setVerifierId}>
                      <SelectTrigger><SelectValue placeholder="검증담당자 선택" /></SelectTrigger>
                      <SelectContent>
                        {assignableUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button size="sm" onClick={handleVerify} disabled={isTransitioning}>
                  {isTransitioning ? "처리 중..." : "검증 처리"}
                </Button>
              </div>
            )}
            {row.status === "COMPLETED" && (
              <div className="text-[14px] space-y-1">
                <p>
                  <span className="text-muted-foreground">검증결과</span>{" "}
                  {row.verificationResult && (
                    <Badge className={`${VERIFICATION_RESULT_CONFIG[row.verificationResult].className} border-0 text-[12px] font-medium`}>
                      {VERIFICATION_RESULT_CONFIG[row.verificationResult].label}
                    </Badge>
                  )}
                </p>
                <p><span className="text-muted-foreground">검증내용</span> {row.verificationContent ?? "—"}</p>
                <p><span className="text-muted-foreground">검증담당자</span> {row.verifierName ?? "—"}</p>
                <p><span className="text-muted-foreground">검증일</span> {row.verifiedAt ? fmtDateTime(row.verifiedAt) : "—"}</p>
                <p><span className="text-muted-foreground">완료일</span> {row.completedAt ? fmtDateTime(row.completedAt) : "—"}</p>
              </div>
            )}
            {row.status === "IN_PROGRESS" && row.verificationResult === "INEFFECTIVE" && (
              <p className="text-[12px] text-amber-700">
                직전 검증결과가 무효로 판정되어 추가 대책 수행 중입니다. 대책 내용을 보완한 후 다시 검증을 요청하세요.
              </p>
            )}
          </div>

          {/* 첨부파일 — 재발방지관리 CAPA 상태전이 로직과 완전히 독립된 부가기능(§ STEP 19) */}
          <AttachmentSection entityType="DEFECT_RECURRENCE_PREVENTION" entityId={preventionId!} />

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
