"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { UserRole } from "@prisma/client"
import { Shield, UserCheck, UserX, ChevronDown, Trash2, KeyRound, Hash } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  updateUserRole,
  deactivateUser,
  reactivateUser,
  deleteUserPermanently,
  resetUserPassword,
  resetUserPopPin,
} from "@/lib/actions/user-management.actions"
import type { TenantUserRow } from "@/lib/actions/user-management.actions"

type UserFilter = "ACTIVE" | "ALL" | "INACTIVE"

const FILTER_OPTIONS: { label: string; value: UserFilter }[] = [
  { label: "활성 사용자", value: "ACTIVE" },
  { label: "비활성/퇴사 포함", value: "ALL" },
  { label: "비활성/퇴사만", value: "INACTIVE" },
]

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS: { label: string; value: UserRole }[] = [
  { label: "오너", value: "OWNER" },
  { label: "관리자", value: "ADMIN" },
  { label: "매니저", value: "MANAGER" },
  { label: "작업자", value: "OPERATOR" },
  { label: "조회자", value: "VIEWER" },
]

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "오너",
  ADMIN: "관리자",
  MANAGER: "매니저",
  OPERATOR: "작업자",
  VIEWER: "조회자",
}

const ROLE_COLORS: Record<UserRole, string> = {
  OWNER:    "bg-purple-50 text-purple-700 border-purple-200",
  ADMIN:    "bg-blue-50 text-blue-700 border-blue-200",
  MANAGER:  "bg-amber-50 text-amber-700 border-amber-200",
  OPERATOR: "bg-emerald-50 text-emerald-700 border-emerald-200",
  VIEWER:   "bg-slate-50 text-slate-600 border-slate-200",
}

// ─── PasswordResetDialog ──────────────────────────────────────────────────────
// 임시 비밀번호를 관리자가 직접 입력한다. 값은 서버 액션으로만 전달되며 화면/로그에 남기지 않는다.

function PasswordResetDialog({
  target,
  onClose,
  onSuccess,
}: {
  target: { tenantUserId: string; name: string } | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [tempPassword, setTempPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, startTransition] = useTransition()

  const isValid = tempPassword.length >= 8 && tempPassword === confirmPassword

  function handleClose() {
    setTempPassword("")
    setConfirmPassword("")
    setError(null)
    onClose()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!target || !isValid) return
    setError(null)
    startTransition(async () => {
      const result = await resetUserPassword(target.tenantUserId, tempPassword)
      if (result.success) {
        handleClose()
        onSuccess()
      } else {
        setError(result.error ?? "비밀번호 초기화에 실패했습니다.")
      }
    })
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="h-5 w-5 text-amber-500" />
            <DialogTitle>비밀번호 초기화</DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="text-[14px] text-slate-600 pt-1">
              <span className="font-semibold text-slate-800">{target?.name}</span> 계정의 임시 비밀번호를 입력하세요.
              <br />
              <span className="text-[13px] text-slate-500">
                영문, 숫자, 특수문자를 모두 포함해 8자 이상. 해당 계정은 다음 로그인 시 비밀번호를 변경해야 합니다.
                임시 비밀번호는 사용자에게 별도로 안전하게 전달해 주세요.
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="reset-pw-new" className="text-[13px] font-medium text-slate-700">
              임시 비밀번호
            </Label>
            <Input
              id="reset-pw-new"
              type="password"
              value={tempPassword}
              onChange={(e) => setTempPassword(e.target.value)}
              className="h-10"
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reset-pw-confirm" className="text-[13px] font-medium text-slate-700">
              임시 비밀번호 확인
            </Label>
            <Input
              id="reset-pw-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-10"
              autoComplete="new-password"
            />
            {confirmPassword.length > 0 && tempPassword !== confirmPassword && (
              <p className="text-[12px] text-red-500">비밀번호가 일치하지 않습니다.</p>
            )}
          </div>

          {error && (
            <p className="text-[13px] text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={loading}>
              취소
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={!isValid || loading}
            >
              {loading ? "처리 중..." : "초기화"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── PopPinResetDialog ────────────────────────────────────────────────────────

function PopPinResetDialog({
  target,
  onClose,
  onSuccess,
}: {
  target: { tenantUserId: string; name: string } | null
  onClose: () => void
  onSuccess: () => void
}) {
  const [newPin, setNewPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, startTransition] = useTransition()

  const isValid = newPin.length === 4 && confirmPin.length === 4 && newPin === confirmPin

  function handleClose() {
    setNewPin("")
    setConfirmPin("")
    setError(null)
    onClose()
  }

  function handlePinInput(
    value: string,
    setter: (v: string) => void
  ) {
    const digits = value.replace(/\D/g, "").slice(0, 4)
    setter(digits)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!target || !isValid) return
    setError(null)
    startTransition(async () => {
      const result = await resetUserPopPin(target.tenantUserId, newPin)
      if (result.success) {
        handleClose()
        onSuccess()
      } else {
        setError(result.error ?? "PIN 재설정에 실패했습니다.")
      }
    })
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) handleClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <Hash className="h-5 w-5 text-emerald-500" />
            <DialogTitle>POP PIN 재설정</DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="text-[14px] text-slate-600 pt-1">
              <span className="font-semibold text-slate-800">{target?.name}</span> 계정의 POP PIN을 변경합니다.
              <br />
              <span className="text-[13px] text-slate-500">
                4자리 숫자 POP PIN을 입력하세요. 동일 사업장 내 중복 PIN은 사용할 수 없습니다.
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="pop-pin-new" className="text-[13px] font-medium text-slate-700">
              새 POP PIN
            </Label>
            <Input
              id="pop-pin-new"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              maxLength={4}
              value={newPin}
              onChange={(e) => handlePinInput(e.target.value, setNewPin)}
              placeholder="••••"
              className="h-10 text-center tracking-[0.5em] font-mono"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pop-pin-confirm" className="text-[13px] font-medium text-slate-700">
              PIN 확인
            </Label>
            <Input
              id="pop-pin-confirm"
              type="password"
              inputMode="numeric"
              pattern="\d*"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => handlePinInput(e.target.value, setConfirmPin)}
              placeholder="••••"
              className="h-10 text-center tracking-[0.5em] font-mono"
              autoComplete="off"
            />
            {confirmPin.length === 4 && newPin !== confirmPin && (
              <p className="text-[12px] text-red-500">PIN이 일치하지 않습니다.</p>
            )}
          </div>

          {error && (
            <p className="text-[13px] text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={loading}>
              취소
            </Button>
            <Button
              type="submit"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!isValid || loading}
            >
              {loading ? "저장 중..." : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UserManagementTable({
  users,
  currentUserId,
  canResetPassword = false,
}: {
  users: TenantUserRow[]
  currentUserId: string
  canResetPassword?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<UserFilter>("ACTIVE")
  const [passwordResetTarget, setPasswordResetTarget] = useState<{ tenantUserId: string; name: string } | null>(null)
  const [popPinTarget, setPopPinTarget] = useState<{ tenantUserId: string; name: string } | null>(null)

  // canResetPassword=false(ADMIN 이하)는 활성 사용자만 고정 표시
  const effectiveFilter = canResetPassword ? filter : "ACTIVE"

  const filteredUsers = useMemo(() => {
    if (effectiveFilter === "ACTIVE") return users.filter((u) => u.isActive)
    if (effectiveFilter === "INACTIVE") return users.filter((u) => !u.isActive)
    return users
  }, [users, effectiveFilter])

  const activeCount = useMemo(() => users.filter((u) => u.isActive).length, [users])
  const inactiveCount = users.length - activeCount

  function handleDeletePermanently(tenantUserId: string) {
    if (
      !confirm(
        "영구삭제는 복구할 수 없습니다. 단, 업무 이력이 있는 사용자는 삭제되지 않습니다.\n\n계속하시겠습니까?",
      )
    )
      return
    setError(null)
    startTransition(async () => {
      const result = await deleteUserPermanently(tenantUserId)
      if (result.success) {
        router.refresh()
      } else {
        setError(result.error ?? "영구삭제에 실패했습니다.")
      }
    })
  }

  function handleRoleChange(tenantUserId: string, newRole: UserRole) {
    setError(null)
    startTransition(async () => {
      const result = await updateUserRole(tenantUserId, newRole)
      if (result.success) {
        router.refresh()
      } else {
        setError(result.error ?? "역할 변경에 실패했습니다.")
      }
    })
  }

  function handleDeactivate(tenantUserId: string) {
    if (
      !confirm(
        "퇴사처리 시 로그인할 수 없으며 기본 사용자 목록에서 숨겨집니다. 기존 업무 이력은 유지됩니다.\n\n계속하시겠습니까?",
      )
    )
      return
    setError(null)
    startTransition(async () => {
      const result = await deactivateUser(tenantUserId)
      if (result.success) {
        router.refresh()
      } else {
        setError(result.error ?? "비활성화에 실패했습니다.")
      }
    })
  }

  function handleReactivate(tenantUserId: string) {
    setError(null)
    startTransition(async () => {
      const result = await reactivateUser(tenantUserId)
      if (result.success) {
        router.refresh()
      } else {
        setError(result.error ?? "재활성화에 실패했습니다.")
      }
    })
  }

  function handleResetPassword(tenantUserId: string, userName: string) {
    setError(null)
    setPasswordResetTarget({ tenantUserId, name: userName })
  }

  return (
    <>
      <PasswordResetDialog
        target={passwordResetTarget}
        onClose={() => setPasswordResetTarget(null)}
        onSuccess={() => router.refresh()}
      />
      <PopPinResetDialog
        target={popPinTarget}
        onClose={() => setPopPinTarget(null)}
        onSuccess={() => router.refresh()}
      />

      {/* 필터 바 — full-access(OWNER/test)만 전체 필터 사용 가능 */}
      {canResetPassword ? (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {FILTER_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              size="sm"
              variant={filter === opt.value ? "default" : "outline"}
              className="h-8 text-[13px]"
              onClick={() => setFilter(opt.value)}
            >
              {opt.label}
              {opt.value === "ACTIVE" && ` (${activeCount})`}
              {opt.value === "INACTIVE" && ` (${inactiveCount})`}
            </Button>
          ))}
        </div>
      ) : (
        <div className="mb-3">
          <span className="text-[13px] text-muted-foreground">
            활성 사용자 ({activeCount}명)
          </span>
        </div>
      )}

      {filteredUsers.length === 0 ? (
        <div className="flex items-center justify-center h-48 border rounded-xl text-[14px] text-muted-foreground">
          {filter === "ACTIVE"
            ? "활성 사용자가 없습니다."
            : filter === "INACTIVE"
              ? "비활성/퇴사 사용자가 없습니다."
              : "등록된 사용자가 없습니다."}
        </div>
      ) : (
      <div className="border rounded-xl overflow-hidden shadow-sm">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">이름</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">아이디</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">이메일</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">부서 / 직급</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">역할</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">상태</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">등록일</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user, idx) => {
              const isSelf = user.profileId === currentUserId
              const isOwner = user.role === "OWNER"

              return (
                <tr
                  key={user.profileId}
                  className={`border-b last:border-0 transition-colors ${
                    !user.isActive
                      ? "opacity-50"
                      : idx % 2 === 0
                      ? "bg-background"
                      : "bg-muted/[0.03]"
                  } hover:bg-muted/10`}
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium">{user.name || "—"}</span>
                      {isSelf && (
                        <span className="text-[11px] bg-blue-50 text-blue-600 border border-blue-200 rounded px-1.5 py-0.5">나</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-[14px] font-mono text-muted-foreground">
                    {user.loginId ?? <span className="text-[12px] italic text-muted-foreground/40">없음</span>}
                  </td>
                  <td className="px-5 py-3 text-[14px] text-muted-foreground">{user.email}</td>
                  <td className="px-5 py-3 text-[14px] text-muted-foreground">
                    <span>{user.department ?? "—"}</span>
                    {user.jobTitle && (
                      <span className="ml-1 text-[12px] text-muted-foreground/70">/ {user.jobTitle}</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[12px] font-medium border ${ROLE_COLORS[user.role]}`}>
                      {isOwner && <Shield className="w-3 h-3" />}
                      {ROLE_LABELS[user.role]}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={user.isActive ? "default" : "secondary"} className="text-[12px]">
                      {user.isActive ? "활성" : "비활성"}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString("ko-KR")}
                  </td>
                  <td className="px-5 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[12px]"
                          disabled={isPending}
                        >
                          관리 <ChevronDown className="w-3 h-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel className="text-[12px]">역할 변경</DropdownMenuLabel>
                        {ROLE_OPTIONS.map((opt) => (
                          <DropdownMenuItem
                            key={opt.value}
                            className={`text-[13px] ${user.role === opt.value ? "font-semibold text-primary" : ""}`}
                            disabled={user.role === opt.value}
                            onClick={() => handleRoleChange(user.id, opt.value)}
                          >
                            {opt.label}
                            {user.role === opt.value && " ✓"}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        {user.isActive ? (
                          <DropdownMenuItem
                            className="text-[13px] text-destructive focus:text-destructive"
                            disabled={isSelf || isOwner}
                            onClick={() => handleDeactivate(user.id)}
                          >
                            <UserX className="w-3.5 h-3.5 mr-1.5" />
                            퇴사처리 (목록에서 숨김)
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            className="text-[13px] text-emerald-600 focus:text-emerald-600"
                            onClick={() => handleReactivate(user.id)}
                          >
                            <UserCheck className="w-3.5 h-3.5 mr-1.5" />
                            재활성화
                          </DropdownMenuItem>
                        )}
                        {canResetPassword && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-[13px] text-amber-600 focus:text-amber-600"
                              disabled={isSelf}
                              onClick={() => handleResetPassword(user.id, user.name)}
                            >
                              <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                              비밀번호 초기화
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-[13px] text-emerald-600 focus:text-emerald-600"
                              onClick={() => setPopPinTarget({ tenantUserId: user.id, name: user.name })}
                            >
                              <Hash className="w-3.5 h-3.5 mr-1.5" />
                              POP PIN 재설정
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-[13px] text-destructive focus:text-destructive"
                          disabled={isSelf || isOwner}
                          onClick={() => handleDeletePermanently(user.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                          영구삭제
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      )}

      {error && (
        <p className="text-[13px] text-destructive bg-destructive/10 rounded-lg px-4 py-2 mt-2">
          {error}
        </p>
      )}

    </>
  )
}
