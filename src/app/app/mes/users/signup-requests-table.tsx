"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { UserRole, SignupRequestStatus } from "@prisma/client"
import { CheckCircle, XCircle, Clock, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { approveSignupRequest, rejectSignupRequest, deleteSignupRequest } from "@/lib/actions/signup-request.actions"
import type { SignupRequestRow } from "@/lib/actions/signup-request.actions"

// ─── Types ────────────────────────────────────────────────────────────────────

const ROLE_OPTIONS: { label: string; value: UserRole }[] = [
  { label: "오너", value: "OWNER" },
  { label: "관리자", value: "ADMIN" },
  { label: "매니저", value: "MANAGER" },
  { label: "작업자", value: "OPERATOR" },
  { label: "조회자", value: "VIEWER" },
]

const STATUS_CONFIG: Record<
  SignupRequestStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  PENDING:  { label: "대기중",  variant: "outline",     icon: <Clock className="w-3 h-3" /> },
  APPROVED: { label: "승인됨",  variant: "default",     icon: <CheckCircle className="w-3 h-3" /> },
  REJECTED: { label: "거절됨",  variant: "destructive", icon: <XCircle className="w-3 h-3" /> },
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SignupRequestsTable({ requests }: { requests: SignupRequestRow[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // 승인 다이얼로그
  const [approveTarget, setApproveTarget] = useState<SignupRequestRow | null>(null)
  const [grantedRole, setGrantedRole] = useState<UserRole>("OPERATOR")

  // 거절 다이얼로그
  const [rejectTarget, setRejectTarget] = useState<SignupRequestRow | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const [error, setError] = useState<string | null>(null)

  function handleDelete(requestId: string, name: string) {
    if (!confirm(`"${name}" 신청 이력을 삭제하시겠습니까?`)) return
    setError(null)
    startTransition(async () => {
      const result = await deleteSignupRequest(requestId)
      if (result.success) {
        router.refresh()
      } else {
        setError(result.error ?? "삭제에 실패했습니다.")
      }
    })
  }

  function handleApprove() {
    if (!approveTarget) return
    setError(null)
    startTransition(async () => {
      const result = await approveSignupRequest(approveTarget.id, grantedRole)
      if (result.success) {
        setApproveTarget(null)
        router.refresh()
      } else {
        setError(result.error ?? "오류가 발생했습니다.")
      }
    })
  }

  function handleReject() {
    if (!rejectTarget || !rejectReason.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await rejectSignupRequest(rejectTarget.id, rejectReason.trim())
      if (result.success) {
        setRejectTarget(null)
        setRejectReason("")
        router.refresh()
      } else {
        setError(result.error ?? "오류가 발생했습니다.")
      }
    })
  }

  if (requests.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 border rounded-xl text-[14px] text-muted-foreground">
        가입 신청이 없습니다.
      </div>
    )
  }

  return (
    <>
      <div className="border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">이름</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">아이디</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">이메일</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">부서 / 직급</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">상태</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">신청일</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {requests.map((req, idx) => {
              const statusCfg = STATUS_CONFIG[req.status]
              return (
                <tr
                  key={req.id}
                  className={`border-b last:border-0 transition-colors ${
                    idx % 2 === 0 ? "bg-background" : "bg-muted/[0.03]"
                  } hover:bg-muted/10`}
                >
                  <td className="px-5 py-3 text-[14px] font-medium">{req.name}</td>
                  <td className="px-5 py-3 text-[14px] font-mono text-muted-foreground">
                    {req.loginId ?? <span className="text-[12px] italic text-muted-foreground/50">없음</span>}
                  </td>
                  <td className="px-5 py-3 text-[14px] text-muted-foreground">{req.email}</td>
                  <td className="px-5 py-3 text-[14px] text-muted-foreground">
                    <span>{req.department ?? "—"}</span>
                    {req.jobTitle && (
                      <span className="ml-1 text-[12px] text-muted-foreground/70">/ {req.jobTitle}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={statusCfg.variant} className="flex items-center gap-1 w-fit text-[12px]">
                      {statusCfg.icon}
                      {statusCfg.label}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-muted-foreground">
                    {new Date(req.createdAt).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="px-5 py-3">
                    {req.status === "PENDING" && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-[12px]"
                          disabled={isPending}
                          onClick={() => {
                            setGrantedRole("OPERATOR")
                            setError(null)
                            setApproveTarget(req)
                          }}
                        >
                          승인
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[12px] text-destructive border-destructive/30 hover:bg-destructive/10"
                          disabled={isPending}
                          onClick={() => {
                            setRejectReason("")
                            setError(null)
                            setRejectTarget(req)
                          }}
                        >
                          거절
                        </Button>
                      </div>
                    )}
                    {req.status === "APPROVED" && (
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] text-muted-foreground">
                          승인: {req.approvedBy?.name ?? "—"}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                          disabled={isPending}
                          onClick={() => handleDelete(req.id, req.name)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    {req.status === "REJECTED" && (
                      <div className="flex items-center gap-2">
                        {req.rejectReason && (
                          <span className="text-[12px] text-muted-foreground truncate max-w-[120px] block" title={req.rejectReason}>
                            사유: {req.rejectReason}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                          disabled={isPending}
                          onClick={() => handleDelete(req.id, req.name)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="text-[13px] text-destructive bg-destructive/10 rounded-lg px-4 py-2 mt-2">
          {error}
        </p>
      )}

      {/* 승인 다이얼로그 */}
      <Dialog
        open={!!approveTarget}
        onOpenChange={(v) => { if (!v) { setApproveTarget(null); setError(null) } }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>가입 신청 승인</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1.5">
              <p className="text-[14px] font-medium">{approveTarget?.name}</p>
              <p className="text-[13px] text-muted-foreground">{approveTarget?.email}</p>
              {approveTarget?.loginId && (
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="text-[11px] text-muted-foreground">아이디</span>
                  <span className="text-[13px] font-mono font-medium">{approveTarget.loginId}</span>
                </div>
              )}
            </div>

            {!approveTarget?.loginId && (
              <p className="text-[12px] text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                이 신청 건에 로그인 아이디 정보가 없습니다. 재신청을 요청하세요.
              </p>
            )}

            <div className="space-y-1.5">
              <Label className="text-[13px]">부여할 역할</Label>
              <Select value={grantedRole} onValueChange={(v) => setGrantedRole(v as UserRole)}>
                <SelectTrigger className="h-9 text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-[13px]">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-[12px] text-muted-foreground">
              승인 시 사용자가 신청한 아이디와 비밀번호로 로그인할 수 있게 됩니다.
            </p>

            {error && (
              <p className="text-[12px] text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setApproveTarget(null); setError(null) }} disabled={isPending}>
              취소
            </Button>
            <Button
              onClick={handleApprove}
              disabled={isPending || !approveTarget?.loginId}
            >
              {isPending ? "처리 중..." : "승인 확정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 거절 다이얼로그 */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => !v && setRejectTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>가입 신청 거절</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/40 px-4 py-3 space-y-1">
              <p className="text-[14px] font-medium">{rejectTarget?.name}</p>
              <p className="text-[13px] text-muted-foreground">{rejectTarget?.email}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">거절 사유 <span className="text-destructive">*</span></Label>
              <Textarea
                placeholder="거절 사유를 입력하세요"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="resize-none text-[13px]"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={isPending}>
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={isPending || !rejectReason.trim()}
            >
              {isPending ? "처리 중..." : "거절 확정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
