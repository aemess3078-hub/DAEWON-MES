"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react"
import { BrandLogo } from "@/components/brand-logo"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type PasswordField = "current" | "next" | "confirm"

export default function ChangePasswordPage() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [visible, setVisible] = useState<Record<PasswordField, boolean>>({
    current: false,
    next: false,
    confirm: false,
  })
  const [checkingSession, setCheckingSession] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let mounted = true

    async function checkSession() {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" })
        if (!mounted) return

        if (res.status === 401) {
          router.replace("/login")
          return
        }

        const data = await res.json().catch(() => null)
        if (!res.ok || !data?.success) {
          setError(data?.message ?? "계정 상태를 확인할 수 없습니다.")
          return
        }

        if (!data.user?.mustChangePw) {
          router.replace("/app")
        }
      } catch {
        if (mounted) setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.")
      } finally {
        if (mounted) setCheckingSession(false)
      }
    }

    checkSession()

    return () => {
      mounted = false
    }
  }, [router])

  const toggleVisible = (field: PasswordField) => {
    setVisible((prev) => ({ ...prev, [field]: !prev[field] }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return

    setError("")

    if (newPassword !== confirmPassword) {
      setError("새 비밀번호와 확인 비밀번호가 일치하지 않습니다.")
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json().catch(() => null)

      if (res.ok && data?.success) {
        router.replace("/app")
        router.refresh()
        return
      }

      if (res.status === 401) {
        setError(data?.message ?? "인증이 만료되었습니다. 다시 로그인해 주세요.")
        return
      }

      setError(data?.message ?? "비밀번호를 변경할 수 없습니다.")
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.")
    } finally {
      setSubmitting(false)
    }
  }

  const isSubmitDisabled =
    checkingSession ||
    submitting ||
    !currentPassword ||
    !newPassword ||
    !confirmPassword

  return (
    <div className="flex min-h-screen overflow-y-auto items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <BrandLogo size="lg" className="text-slate-900 mb-3" />
          <p className="text-sm text-slate-500">계정 보안을 위해 비밀번호를 변경하세요</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6">
            <div className="mb-1 flex items-center gap-2">
              <LockKeyhole className="h-5 w-5 text-blue-500" />
              <h2 className="text-xl font-bold text-slate-800">비밀번호 변경</h2>
            </div>
            <p className="text-sm text-slate-500">
              새 비밀번호는 영문, 숫자, 특수문자를 포함해 8자 이상이어야 합니다.
            </p>
          </div>

          {checkingSession ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              계정 상태 확인 중
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <PasswordInput
                id="currentPassword"
                label="현재 비밀번호"
                value={currentPassword}
                visible={visible.current}
                autoComplete="current-password"
                onChange={setCurrentPassword}
                onToggle={() => toggleVisible("current")}
              />
              <PasswordInput
                id="newPassword"
                label="새 비밀번호"
                value={newPassword}
                visible={visible.next}
                autoComplete="new-password"
                onChange={setNewPassword}
                onToggle={() => toggleVisible("next")}
              />
              <PasswordInput
                id="confirmPassword"
                label="새 비밀번호 확인"
                value={confirmPassword}
                visible={visible.confirm}
                autoComplete="new-password"
                onChange={setConfirmPassword}
                onToggle={() => toggleVisible("confirm")}
              />

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="h-11 w-full bg-slate-800 text-white hover:bg-slate-700"
                disabled={isSubmitDisabled}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    변경 중
                  </>
                ) : (
                  "비밀번호 변경"
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function PasswordInput({
  id,
  label,
  value,
  visible,
  autoComplete,
  onChange,
  onToggle,
}: {
  id: string
  label: string
  value: string
  visible: boolean
  autoComplete: string
  onChange: (value: string) => void
  onToggle: () => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          autoComplete={autoComplete}
          className="h-11 pr-11"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
          tabIndex={-1}
          aria-label={visible ? `${label} 숨기기` : `${label} 보기`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
