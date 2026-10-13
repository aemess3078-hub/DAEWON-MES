"use client"

import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function PasswordChangeCard() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [show, setShow] = useState({ current: false, next: false, confirm: false })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const toggleShow = (field: keyof typeof show) =>
    setShow((prev) => ({ ...prev, [field]: !prev[field] }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setMessage(null)

    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: "새 비밀번호와 확인 비밀번호가 일치하지 않습니다." })
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
        setMessage({ type: "success", text: "비밀번호가 변경되었습니다." })
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
      } else {
        setMessage({
          type: "error",
          text: data?.message ?? "비밀번호를 변경할 수 없습니다.",
        })
      }
    } catch {
      setMessage({ type: "error", text: "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[18px]">비밀번호 변경</CardTitle>
        <CardDescription className="text-[13px]">
          현재 비밀번호를 확인한 후 새 비밀번호로 변경합니다.
          새 비밀번호는 영문, 숫자, 특수문자를 포함해 8자 이상이어야 합니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PasswordField
              id="pw-current"
              label="현재 비밀번호"
              value={currentPassword}
              visible={show.current}
              autoComplete="current-password"
              onChange={setCurrentPassword}
              onToggle={() => toggleShow("current")}
            />
            <div /> {/* 오른쪽 공백 */}
            <PasswordField
              id="pw-new"
              label="새 비밀번호"
              value={newPassword}
              visible={show.next}
              autoComplete="new-password"
              onChange={setNewPassword}
              onToggle={() => toggleShow("next")}
            />
            <PasswordField
              id="pw-confirm"
              label="새 비밀번호 확인"
              value={confirmPassword}
              visible={show.confirm}
              autoComplete="new-password"
              onChange={setConfirmPassword}
              onToggle={() => toggleShow("confirm")}
            />
          </div>

          {message && (
            <p
              className={`text-[13px] rounded-lg px-3 py-2 ${
                message.type === "success"
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
              }`}
            >
              {message.text}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={submitting || !currentPassword || !newPassword || !confirmPassword}
              className="h-9 px-5 text-[14px]"
            >
              {submitting ? "변경 중..." : "비밀번호 변경"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function PasswordField({
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
  onChange: (v: string) => void
  onToggle: () => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[14px] font-medium">
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
          className="h-10 pr-10 text-[14px]"
        />
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={visible ? `${label} 숨기기` : `${label} 보기`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  )
}
