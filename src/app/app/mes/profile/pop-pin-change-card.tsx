"use client"

import { useState } from "react"
import { Eye, EyeOff, Hash } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { changeMyPopPin } from "@/lib/actions/profile.actions"

export function PopPinChangeCard() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [newPin, setNewPin] = useState("")
  const [confirmPin, setConfirmPin] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const pinIsValid = newPin.length === 4 && confirmPin.length === 4 && newPin === confirmPin
  const canSubmit = !!currentPassword && pinIsValid

  function handlePinInput(value: string, setter: (v: string) => void) {
    setter(value.replace(/\D/g, "").slice(0, 4))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return
    setMessage(null)
    setSubmitting(true)

    try {
      const result = await changeMyPopPin(currentPassword, newPin)
      if (result.success) {
        setMessage({ type: "success", text: "POP PIN이 변경되었습니다." })
        setCurrentPassword("")
        setNewPin("")
        setConfirmPin("")
      } else {
        setMessage({ type: "error", text: result.error ?? "PIN을 변경할 수 없습니다." })
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
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-emerald-500" />
          <CardTitle className="text-[18px]">POP PIN 변경</CardTitle>
        </div>
        <CardDescription className="text-[13px]">
          POP 작업자모드 로그인에 사용하는 4자리 PIN입니다.
          동일 사업장 내 중복 PIN은 사용할 수 없습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 현재 비밀번호 */}
          <div className="space-y-1.5">
            <Label htmlFor="pop-pin-current-pw" className="text-[14px] font-medium">
              현재 비밀번호
            </Label>
            <div className="relative max-w-xs">
              <Input
                id="pop-pin-current-pw"
                type={showPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="현재 비밀번호 입력"
                autoComplete="current-password"
                className="h-10 pr-10 text-[14px]"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* 새 PIN / 확인 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xs sm:max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="pop-pin-new" className="text-[14px] font-medium">
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
                autoComplete="off"
                className="h-10 text-center tracking-[0.5em] font-mono text-[16px]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pop-pin-confirm" className="text-[14px] font-medium">
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
                autoComplete="off"
                className="h-10 text-center tracking-[0.5em] font-mono text-[16px]"
              />
            </div>
          </div>

          {confirmPin.length === 4 && newPin !== confirmPin && (
            <p className="text-[12px] text-red-500">PIN이 일치하지 않습니다.</p>
          )}

          {message && (
            <p
              className={`text-[13px] rounded-lg px-3 py-2 ${
                message.type === "success"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-red-50 text-red-600"
              }`}
            >
              {message.text}
            </p>
          )}

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!canSubmit || submitting}
              className="h-9 px-5 text-[14px] bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {submitting ? "변경 중..." : "POP PIN 변경"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
