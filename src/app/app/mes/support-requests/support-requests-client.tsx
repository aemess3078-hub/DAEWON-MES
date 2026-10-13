"use client"

import { useState, useTransition, useMemo } from "react"
import { Search, Plus, ChevronDown } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  createSupportRequest,
  updateSupportRequest,
  type SupportRequestItem,
  type CreateSupportRequestInput,
} from "@/lib/actions/support-request.actions"
import type { SupportType, SupportStatus, SupportPriority } from "@prisma/client"

// ─── 레이블 매핑 ──────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<SupportType, string> = {
  BUG_REPORT: "오류 신고",
  FEATURE_REQUEST: "기능 요청",
  IMPROVEMENT: "개선 요청",
  OTHER: "기타",
}

const STATUS_LABELS: Record<SupportStatus, string> = {
  OPEN: "접수",
  IN_PROGRESS: "처리중",
  ANSWERED: "답변완료",
  ON_HOLD: "보류",
  COMPLETED: "완료",
}

const PRIORITY_LABELS: Record<SupportPriority, string> = {
  LOW: "낮음",
  NORMAL: "보통",
  HIGH: "높음",
  URGENT: "긴급",
}

const STATUS_BADGE: Record<SupportStatus, string> = {
  OPEN: "bg-slate-100 text-slate-700 border-slate-300",
  IN_PROGRESS: "bg-blue-50 text-blue-700 border-blue-300",
  ANSWERED: "bg-emerald-50 text-emerald-700 border-emerald-300",
  ON_HOLD: "bg-amber-50 text-amber-700 border-amber-300",
  COMPLETED: "bg-green-50 text-green-700 border-green-300",
}

const PRIORITY_BADGE: Record<SupportPriority, string> = {
  LOW: "bg-slate-50 text-slate-500 border-slate-200",
  NORMAL: "bg-blue-50 text-blue-600 border-blue-200",
  HIGH: "bg-amber-50 text-amber-700 border-amber-300",
  URGENT: "bg-red-50 text-red-700 border-red-300",
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function StatusBadge({ status }: { status: SupportStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[12px] font-medium ${STATUS_BADGE[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: SupportPriority }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[12px] font-medium ${PRIORITY_BADGE[priority]}`}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  )
}

// ─── 등록 시트 ────────────────────────────────────────────────────────────────

interface CreateSheetProps {
  open: boolean
  onClose: () => void
  tenantId: string
  authorId: string
  onCreated: (item: SupportRequestItem) => void
}

function CreateSheet({ open, onClose, tenantId, authorId, onCreated }: CreateSheetProps) {
  const [isPending, startTransition] = useTransition()
  const [type, setType] = useState<SupportType>("BUG_REPORT")
  const [priority, setPriority] = useState<SupportPriority>("NORMAL")
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [error, setError] = useState("")

  function reset() {
    setType("BUG_REPORT")
    setPriority("NORMAL")
    setTitle("")
    setContent("")
    setError("")
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleSubmit() {
    if (!title.trim()) { setError("제목을 입력해주세요."); return }
    if (!content.trim()) { setError("상세 내용을 입력해주세요."); return }
    setError("")

    const input: CreateSupportRequestInput = {
      tenantId,
      authorId,
      type,
      priority,
      title: title.trim(),
      content: content.trim(),
    }

    startTransition(async () => {
      try {
        const created = await createSupportRequest(input)
        onCreated(created)
        reset()
        onClose()
      } catch {
        setError("등록 중 오류가 발생했습니다. 다시 시도해주세요.")
      }
    })
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <SheetContent className="w-full sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[18px]">요청사항 등록</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-5 px-1">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-[14px]">유형 <span className="text-red-500">*</span></Label>
              <Select value={type} onValueChange={(v) => setType(v as SupportType)}>
                <SelectTrigger className="text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as SupportType[]).map((k) => (
                    <SelectItem key={k} value={k}>{TYPE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[14px]">우선순위</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as SupportPriority)}>
                <SelectTrigger className="text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABELS) as SupportPriority[]).map((k) => (
                    <SelectItem key={k} value={k}>{PRIORITY_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">제목 <span className="text-red-500">*</span></Label>
            <Input
              placeholder="요청 제목을 입력하세요"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-[14px]"
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">상세 내용 <span className="text-red-500">*</span></Label>
            <Textarea
              placeholder="상세 내용을 입력하세요. 오류 신고의 경우 재현 방법을 함께 기재해주세요."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[160px] text-[14px] resize-none"
              maxLength={5000}
            />
            <p className="text-right text-[12px] text-muted-foreground">{content.length} / 5000</p>
          </div>

          {error && (
            <p className="text-[13px] text-red-600">{error}</p>
          )}
        </div>

        <SheetFooter className="mt-6 flex gap-2 px-1">
          <Button variant="outline" onClick={handleClose} disabled={isPending} className="flex-1">
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending} className="flex-1">
            {isPending ? "등록 중..." : "등록"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

// ─── 상세 다이얼로그 ───────────────────────────────────────────────────────────

interface DetailDialogProps {
  item: SupportRequestItem | null
  onClose: () => void
  isAdmin: boolean
  currentProfileId: string
  onUpdated: (item: SupportRequestItem) => void
}

function DetailDialog({ item, onClose, isAdmin, currentProfileId, onUpdated }: DetailDialogProps) {
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<SupportStatus>(item?.status ?? "OPEN")
  const [answer, setAnswer] = useState(item?.answer ?? "")
  const [adminNote, setAdminNote] = useState(item?.adminNote ?? "")
  const [editMode, setEditMode] = useState(false)

  if (!item) return null

  function handleSave() {
    if (!item) return
    startTransition(async () => {
      try {
        const updated = await updateSupportRequest({
          id: item.id,
          status,
          answer: answer.trim() || null,
          adminNote: adminNote.trim() || null,
          handledById: currentProfileId,
        })
        onUpdated(updated)
        setEditMode(false)
      } catch {
        // silent
      }
    })
  }

  return (
    <Dialog open={!!item} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[18px] pr-8 leading-snug">{item.title}</DialogTitle>
        </DialogHeader>

        {/* 메타 정보 */}
        <div className="flex flex-wrap gap-2 text-[13px] text-muted-foreground border-b pb-3">
          <span className="flex items-center gap-1">
            <span className="font-medium text-foreground">유형</span>
            {TYPE_LABELS[item.type]}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <PriorityBadge priority={item.priority} />
          <span className="text-muted-foreground/40">·</span>
          <StatusBadge status={item.status} />
          <span className="text-muted-foreground/40">·</span>
          <span>{item.authorName}</span>
          <span className="text-muted-foreground/40">·</span>
          <span>{formatDate(item.createdAt)}</span>
          {item.handledAt && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>처리: {formatDate(item.handledAt)}</span>
            </>
          )}
        </div>

        {/* 요청 내용 */}
        <div className="space-y-1">
          <p className="text-[13px] font-semibold text-muted-foreground">요청 내용</p>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed rounded-lg bg-muted/30 px-3 py-2.5">
            {item.content}
          </p>
        </div>

        {/* 이미지 첨부 */}
        {item.imageUrl && (
          <div>
            <p className="mb-1 text-[13px] font-semibold text-muted-foreground">첨부 이미지</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt="첨부 이미지" className="max-w-full rounded-lg border" />
          </div>
        )}

        {/* 답변 (관리자가 아닐 때 or 보기 모드) */}
        {!editMode && item.answer && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="mb-1 text-[13px] font-semibold text-emerald-800">답변</p>
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-emerald-900">
              {item.answer}
            </p>
            {item.handledByName && (
              <p className="mt-1.5 text-[12px] text-emerald-700">답변자: {item.handledByName}</p>
            )}
          </div>
        )}

        {/* 관리자 편집 폼 */}
        {isAdmin && editMode && (
          <div className="space-y-4 rounded-lg border border-dashed border-blue-300 bg-blue-50/40 p-4">
            <p className="text-[13px] font-semibold text-blue-800">관리자 처리</p>

            <div className="space-y-1.5">
              <Label className="text-[13px]">상태 변경</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as SupportStatus)}>
                <SelectTrigger className="text-[14px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABELS) as SupportStatus[]).map((k) => (
                    <SelectItem key={k} value={k}>{STATUS_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">답변 내용</Label>
              <Textarea
                placeholder="사용자에게 전달할 답변을 입력하세요."
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                className="min-h-[100px] text-[14px] resize-none"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[13px]">내부 메모 (사용자에게 미노출)</Label>
              <Textarea
                placeholder="처리 메모를 입력하세요."
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                className="min-h-[60px] text-[14px] resize-none"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {isAdmin && !editMode && (
            <Button variant="outline" size="sm" onClick={() => {
              setStatus(item.status)
              setAnswer(item.answer ?? "")
              setAdminNote(item.adminNote ?? "")
              setEditMode(true)
            }}>
              처리 / 답변
            </Button>
          )}
          {isAdmin && editMode && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditMode(false)}>
                취소
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isPending}>
                {isPending ? "저장 중..." : "저장"}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── 메인 클라이언트 컴포넌트 ─────────────────────────────────────────────────

interface SupportRequestsClientProps {
  initialData: SupportRequestItem[]
  tenantId: string
  currentProfileId: string
  isAdmin: boolean
}

export function SupportRequestsClient({
  initialData,
  tenantId,
  currentProfileId,
  isAdmin,
}: SupportRequestsClientProps) {
  const [items, setItems] = useState<SupportRequestItem[]>(initialData)
  const [createOpen, setCreateOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<SupportRequestItem | null>(null)
  const [keyword, setKeyword] = useState("")
  const [filterType, setFilterType] = useState<SupportType | "ALL">("ALL")
  const [filterStatus, setFilterStatus] = useState<SupportStatus | "ALL">("ALL")
  const [filterPriority, setFilterPriority] = useState<SupportPriority | "ALL">("ALL")

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return items.filter((item) => {
      if (filterType !== "ALL" && item.type !== filterType) return false
      if (filterStatus !== "ALL" && item.status !== filterStatus) return false
      if (filterPriority !== "ALL" && item.priority !== filterPriority) return false
      if (kw && !item.title.toLowerCase().includes(kw) && !item.content.toLowerCase().includes(kw)) return false
      return true
    })
  }, [items, keyword, filterType, filterStatus, filterPriority])

  function handleCreated(item: SupportRequestItem) {
    setItems((prev) => [item, ...prev])
  }

  function handleUpdated(item: SupportRequestItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)))
    setSelectedItem(item)
  }

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-3">
        {/* 검색 */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="제목 / 내용 검색"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-9 w-[220px] pl-9 text-[14px]"
          />
        </div>

        {/* 유형 필터 */}
        <Select value={filterType} onValueChange={(v) => setFilterType(v as SupportType | "ALL")}>
          <SelectTrigger className="h-9 w-[130px] text-[14px]">
            <SelectValue placeholder="유형 전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">유형 전체</SelectItem>
            {(Object.keys(TYPE_LABELS) as SupportType[]).map((k) => (
              <SelectItem key={k} value={k}>{TYPE_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 상태 필터 */}
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as SupportStatus | "ALL")}>
          <SelectTrigger className="h-9 w-[130px] text-[14px]">
            <SelectValue placeholder="상태 전체" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">상태 전체</SelectItem>
            {(Object.keys(STATUS_LABELS) as SupportStatus[]).map((k) => (
              <SelectItem key={k} value={k}>{STATUS_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 우선순위 필터 */}
        <Select value={filterPriority} onValueChange={(v) => setFilterPriority(v as SupportPriority | "ALL")}>
          <SelectTrigger className="h-9 w-[120px] text-[14px]">
            <SelectValue placeholder="우선순위" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">우선순위 전체</SelectItem>
            {(Object.keys(PRIORITY_LABELS) as SupportPriority[]).map((k) => (
              <SelectItem key={k} value={k}>{PRIORITY_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        {/* 등록 버튼 */}
        <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          요청 등록
        </Button>
      </div>

      {/* 목록 테이블 */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full min-w-[700px] text-[14px]">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-[36px]">#</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-[100px]">유형</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-[80px]">우선순위</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground">제목</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-[80px]">작성자</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-[80px]">상태</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-[80px]">답변</th>
              <th className="px-3 py-2.5 text-left font-medium text-muted-foreground w-[90px]">등록일</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-[15px] text-muted-foreground">
                  {items.length === 0
                    ? "등록된 요청이 없습니다."
                    : "검색 조건에 맞는 요청이 없습니다."}
                </td>
              </tr>
            ) : (
              filtered.map((item, idx) => (
                <tr
                  key={item.id}
                  className="border-b last:border-0 hover:bg-muted/10 cursor-pointer transition-colors"
                  onClick={() => setSelectedItem(item)}
                >
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums text-[13px]">
                    {filtered.length - idx}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                    {TYPE_LABELS[item.type]}
                  </td>
                  <td className="px-3 py-2.5">
                    <PriorityBadge priority={item.priority} />
                  </td>
                  <td className="px-3 py-2.5 font-medium">
                    <div className="truncate max-w-[280px]">{item.title}</div>
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-muted-foreground">{item.authorName}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="px-3 py-2.5 text-[13px]">
                    {item.answer ? (
                      <span className="text-emerald-700 font-medium">있음</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                    {formatDate(item.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[13px] text-muted-foreground text-right">
        전체 {items.length}건 · 표시 {filtered.length}건
      </p>

      {/* 등록 시트 */}
      <CreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        tenantId={tenantId}
        authorId={currentProfileId}
        onCreated={handleCreated}
      />

      {/* 상세 다이얼로그 */}
      <DetailDialog
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        isAdmin={isAdmin}
        currentProfileId={currentProfileId}
        onUpdated={handleUpdated}
      />
    </div>
  )
}
