"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle, Eye, EyeOff, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  createSignupRequest,
  checkSignupPopPinAvailability,
} from "@/lib/actions/signup-request.actions"
import { validatePassword } from "@/lib/password"

const POP_PIN_RE = /^\d{4}$/

export default function SignupRequestPage() {
  const [form, setForm] = useState({
    loginId: "",
    password: "",
    confirmPassword: "",
    popPin: "",
    confirmPopPin: "",
    name: "",
    department: "",
    employeeNo: "",
    phone: "",
    email: "",
    jobTitle: "",
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [pinChecked, setPinChecked] = useState(false)
  const [pinCheckLoading, setPinCheckLoading] = useState(false)
  const [pinCheckMessage, setPinCheckMessage] = useState<{ available: boolean; text: string } | null>(null)

  function updatePinField(field: "popPin" | "confirmPopPin", value: string) {
    setForm((prev) => ({ ...prev, [field]: value.replace(/\D/g, "").slice(0, 4) }))
    if (field === "popPin") {
      setPinChecked(false)
      setPinCheckMessage(null)
    }
  }

  function validate(): string | null {
    if (!form.loginId.trim() || form.loginId.trim().length < 3) {
      return "로그인 아이디는 3자 이상이어야 합니다."
    }
    if (!/^[A-Za-z0-9_-]+$/.test(form.loginId.trim())) {
      return "로그인 아이디는 영문, 숫자, _, - 만 사용할 수 있습니다."
    }
    const pwError = validatePassword(form.password)
    if (pwError) return pwError
    if (form.password !== form.confirmPassword) {
      return "비밀번호가 일치하지 않습니다."
    }
    if (!POP_PIN_RE.test(form.popPin)) {
      return "작업자 POP PIN은 4자리 숫자로 입력해 주세요."
    }
    if (form.popPin !== form.confirmPopPin) {
      return "작업자 POP PIN이 일치하지 않습니다."
    }
    if (!pinChecked) {
      return "POP PIN 중복확인을 완료해 주세요."
    }
    if (!form.name.trim()) return "이름을 입력해 주세요."
    if (!form.department.trim()) return "부서를 입력해 주세요."
    if (!form.phone.trim()) return "연락처를 입력해 주세요."
    if (!form.email.trim()) return "이메일을 입력해 주세요."
    if (!form.jobTitle.trim()) return "직급을 입력해 주세요."
    return null
  }

  const handlePinCheck = async () => {
    if (!POP_PIN_RE.test(form.popPin)) {
      setPinCheckMessage({ available: false, text: "POP PIN을 4자리 숫자로 먼저 입력해 주세요." })
      return
    }
    setPinCheckLoading(true)
    try {
      const res = await checkSignupPopPinAvailability(form.popPin)
      setPinChecked(res.available)
      setPinCheckMessage({ available: res.available, text: res.message })
    } catch {
      setPinCheckMessage({ available: false, text: "중복검사 중 오류가 발생했습니다." })
    } finally {
      setPinCheckLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setClientError(null)

    const err = validate()
    if (err) {
      setClientError(err)
      return
    }

    setLoading(true)
    try {
      const res = await createSignupRequest({
        loginId: form.loginId.trim().toLowerCase(),
        email: form.email.trim(),
        name: form.name.trim(),
        department: form.department.trim(),
        employeeNo: form.employeeNo.trim() || undefined,
        phone: form.phone.trim(),
        jobTitle: form.jobTitle.trim(),
        password: form.password,
        popPin: form.popPin,
      })
      setResult(res)
    } catch {
      setResult({ success: false, message: "서버 오류가 발생했습니다." })
    } finally {
      setLoading(false)
    }
  }

  if (result?.success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-10 text-center space-y-4">
          <CheckCircle className="h-14 w-14 text-emerald-500 mx-auto" />
          <h2 className="text-2xl font-bold text-slate-800">신청 완료</h2>
          <p className="text-slate-600 text-[15px]">{result.message}</p>
          <Link href="/login">
            <Button variant="outline" className="mt-2 w-full">
              로그인 페이지로
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-slate-800 text-white text-xl font-bold mb-4">
            M
          </div>
          <h1 className="text-2xl font-bold text-slate-800">가입 신청</h1>
          <p className="text-slate-500 mt-1 text-[14px]">
            관리자 승인 후 신청한 아이디로 로그인할 수 있습니다
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <p className="text-[13px] font-semibold text-slate-500 mb-3">로그인 정보</p>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-[14px] font-medium text-slate-700">
                    로그인 아이디 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    required
                    placeholder="영문, 숫자, _, - (3자 이상)"
                    value={form.loginId}
                    onChange={(e) => setForm({ ...form, loginId: e.target.value })}
                    autoComplete="username"
                    className="h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[14px] font-medium text-slate-700">
                    비밀번호 <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      required
                      type={showPassword ? "text" : "password"}
                      placeholder="8자 이상, 영문·숫자·특수문자 포함"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      autoComplete="new-password"
                      className="h-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[14px] font-medium text-slate-700">
                    비밀번호 확인 <span className="text-red-500">*</span>
                  </Label>
                  <div className="relative">
                    <Input
                      required
                      type={showConfirm ? "text" : "password"}
                      placeholder="비밀번호를 다시 입력하세요"
                      value={form.confirmPassword}
                      onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                      autoComplete="new-password"
                      className="h-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={showConfirm ? "비밀번호 확인 숨기기" : "비밀번호 확인 보기"}
                    >
                      {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-[13px] font-semibold text-slate-500 mb-1">작업자 POP PIN</p>
              <p className="text-[13px] text-slate-500 mb-3">
                현장 작업자 모드에서 본인을 빠르게 식별할 때 사용하는 4자리 숫자입니다.
                로그인 비밀번호와 별도로 관리됩니다.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[14px] font-medium text-slate-700">
                    POP PIN <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    required
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4}"
                    maxLength={4}
                    placeholder="4자리"
                    value={form.popPin}
                    onChange={(e) => updatePinField("popPin", e.target.value)}
                    autoComplete="off"
                    className="h-10 text-center tracking-[0.25em]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[14px] font-medium text-slate-700">
                    PIN 확인 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    required
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4}"
                    maxLength={4}
                    placeholder="다시 입력"
                    value={form.confirmPopPin}
                    onChange={(e) => updatePinField("confirmPopPin", e.target.value)}
                    autoComplete="off"
                    className="h-10 text-center tracking-[0.25em]"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-[13px] shrink-0"
                  onClick={handlePinCheck}
                  disabled={pinCheckLoading || !POP_PIN_RE.test(form.popPin)}
                >
                  {pinCheckLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "중복확인"}
                </Button>
                {pinCheckMessage && (
                  <span className={`text-[13px] ${pinCheckMessage.available ? "text-emerald-600" : "text-red-500"}`}>
                    {pinCheckMessage.text}
                  </span>
                )}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <p className="text-[13px] font-semibold text-slate-500 mb-3">개인 정보</p>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[14px] font-medium text-slate-700">
                      이름 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      required
                      placeholder="홍길동"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[14px] font-medium text-slate-700">
                      직급 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      required
                      placeholder="사원"
                      value={form.jobTitle}
                      onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                      className="h-10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[14px] font-medium text-slate-700">
                      부서 <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      required
                      placeholder="생산팀"
                      value={form.department}
                      onChange={(e) => setForm({ ...form, department: e.target.value })}
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[14px] font-medium text-slate-700">사번</Label>
                    <Input
                      placeholder="선택 입력"
                      value={form.employeeNo}
                      onChange={(e) => setForm({ ...form, employeeNo: e.target.value })}
                      className="h-10"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[14px] font-medium text-slate-700">
                    연락처 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="tel"
                    required
                    placeholder="010-0000-0000"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="h-10"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[14px] font-medium text-slate-700">
                    이메일 <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="h-10"
                  />
                </div>
              </div>
            </div>

            {(clientError || (result && !result.success)) && (
              <p className="text-[13px] text-red-500 bg-red-50 rounded-lg px-3 py-2">
                {clientError ?? result?.message}
              </p>
            )}

            <Button
              type="submit"
              className="w-full h-10 bg-slate-800 hover:bg-slate-700 text-white"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  처리 중...
                </>
              ) : (
                "가입 신청"
              )}
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link
              href="/login"
              className="text-[13px] text-slate-400 hover:text-slate-600 transition-colors"
            >
              이미 계정이 있으신가요? 로그인
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
