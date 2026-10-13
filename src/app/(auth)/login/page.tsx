"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Monitor, Factory, Eye, EyeOff, LockKeyhole } from "lucide-react"
import { popLogin } from "@/lib/actions/pop.actions"
import { PopNumberPad } from "@/app/pop/components/pop-number-pad"
import { BrandLogo } from "@/components/brand-logo"

// ─── Types ────────────────────────────────────────────────────────────────────

type LoginMode = "select" | "system" | "worker"

function getLoginTenantId(): string {
  if (typeof document === "undefined") return "tenant-demo-001"
  return (
    document.cookie
      .split("; ")
      .find((c) => c.startsWith("tenantId="))
      ?.split("=")[1] ?? "tenant-demo-001"
  )
}

// ─── 메인 페이지 ──────────────────────────────────────────────────────────────

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>("select")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason")
    if (reason === "idle") {
      setNotice("30분 동안 활동이 없어 자동 로그아웃되었습니다.")
    } else if (reason === "session-expired") {
      setNotice("세션이 만료되었습니다. 다시 로그인해 주세요.")
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* 상단 로고 */}
        <div className="flex flex-col items-center mb-8">
          <BrandLogo size="lg" className="text-slate-900 mb-4" />
          <p className="text-slate-500 text-[15px]">스마트공장 제조실행시스템</p>
        </div>

        {notice && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
            {notice}
          </p>
        )}

        {mode === "select" && <ModeSelectCards onSelect={setMode} />}
        {mode === "system" && <SystemLoginForm onBack={() => setMode("select")} />}
        {mode === "worker" && <WorkerLoginForm onBack={() => setMode("select")} />}
      </div>
    </div>
  )
}

// ─── 모드 선택 카드 ───────────────────────────────────────────────────────────

function ModeSelectCards({ onSelect }: { onSelect: (mode: LoginMode) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <button
        onClick={() => onSelect("system")}
        className="p-8 bg-white rounded-2xl border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all text-left group"
      >
        <Monitor className="h-12 w-12 text-blue-500 mb-4 group-hover:scale-110 transition-transform" />
        <h2 className="text-xl font-bold text-slate-800">시스템모드</h2>
        <p className="text-slate-500 mt-1">관리자·생산관리자용</p>
        <p className="text-sm text-slate-400 mt-2">PC 환경에 최적화된 관리 화면</p>
      </button>

      <button
        onClick={() => onSelect("worker")}
        className="p-8 bg-white rounded-2xl border-2 border-slate-200 hover:border-emerald-400 hover:shadow-lg transition-all text-left group"
      >
        <Factory className="h-12 w-12 text-emerald-500 mb-4 group-hover:scale-110 transition-transform" />
        <h2 className="text-xl font-bold text-slate-800">작업자모드</h2>
        <p className="text-slate-500 mt-1">현장 작업자용</p>
        <p className="text-sm text-slate-400 mt-2">태블릿·키오스크 터치 최적화</p>
      </button>
    </div>
  )
}

// ─── 시스템 로그인 폼 (아이디/비밀번호) ──────────────────────────────────────

function SystemLoginForm({ onBack }: { onBack: () => void }) {
  const router = useRouter()
  const [loginId, setLoginId] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: loginId.trim(), password }),
      })

      let data: { success?: boolean; message?: string }
      try {
        data = await res.json()
      } catch {
        // 서버가 JSON이 아닌 응답(500 HTML 등)을 반환한 경우
        setError("서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.")
        return
      }

      if (res.ok && data.success) {
        document.cookie = "nmes-mode=system; path=/"
        router.push("/app")
        return
      }

      setError(data.message ?? "로그인에 실패했습니다.")
    } catch {
      setError("서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-8">
      <button
        onClick={onBack}
        className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-6 flex items-center gap-1"
      >
        ← 모드 선택으로
      </button>

      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Monitor className="h-5 w-5 text-blue-500" />
          <h2 className="text-xl font-bold text-slate-800">시스템모드 로그인</h2>
        </div>
        <p className="text-slate-500 text-sm">관리자·생산관리자 계정으로 로그인하세요</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="loginId" className="text-sm font-medium text-slate-700">
            아이디
          </Label>
          <Input
            id="loginId"
            type="text"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            placeholder="로그인 아이디 입력"
            required
            autoComplete="username"
            className="h-11"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm font-medium text-slate-700">
            비밀번호
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className="h-11 pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full h-11 bg-slate-800 hover:bg-slate-700 text-white"
          disabled={loading || !loginId.trim() || !password}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              로그인 중...
            </>
          ) : (
            "로그인"
          )}
        </Button>
      </form>

      <div className="mt-5 flex flex-col items-center gap-2">
        <a
          href="/signup-request"
          className="text-sm text-blue-500 hover:text-blue-700 transition-colors"
        >
          계정이 없으신가요? 가입 신청 →
        </a>
        <button
          type="button"
          onClick={() => setForgotOpen(true)}
          className="text-sm text-slate-400 hover:text-slate-600 transition-colors"
        >
          비밀번호를 잊으셨나요?
        </button>
      </div>

      {/* 비밀번호 찾기 안내 다이얼로그 */}
      <Dialog open={forgotOpen} onOpenChange={setForgotOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2 mb-1">
              <LockKeyhole className="h-5 w-5 text-blue-500" />
              <DialogTitle>비밀번호를 잊으셨나요?</DialogTitle>
            </div>
            <DialogDescription asChild>
              <div className="space-y-3 text-[14px] text-slate-600 pt-1">
                <p>
                  비밀번호 초기화는{" "}
                  <span className="font-semibold text-slate-800">회사 OWNER 계정 담당자</span>에게
                  구두·전화·카톡으로 요청해 주세요.
                </p>
                <p className="text-[13px] text-slate-500">
                  초기화 후 임시 비밀번호로 로그인하면 새 비밀번호로 변경하는 화면이 자동으로 표시됩니다.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="default"
              className="w-full"
              onClick={() => setForgotOpen(false)}
            >
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── 작업자 로그인 폼 (PIN) ───────────────────────────────────────────────────

function WorkerLoginForm({ onBack }: { onBack: () => void }) {
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handlePinComplete = async (completedPin: string) => {
    setLoading(true)
    setError("")

    try {
      const result = await popLogin(completedPin, getLoginTenantId())

      if (!result) {
        setError("등록되지 않았거나 사용할 수 없는 작업자 PIN입니다. 관리자에게 PIN 등록 또는 상태 확인을 요청하세요.")
        setPin("")
        setLoading(false)
        return
      }

      document.cookie = "nmes-mode=worker; path=/"
      // Legacy display cookie only; server actions must trust the signed POP worker session cookie.
      document.cookie = `nmes-worker-name=${encodeURIComponent(result.name)}; path=/`
      window.location.href = "/pop/work-select"
    } catch {
      setError("로그인 중 오류가 발생했습니다.")
      setPin("")
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-sm mx-auto">
      <button
        onClick={onBack}
        className="text-sm text-slate-500 hover:text-slate-700 transition-colors mb-6 flex items-center gap-1"
      >
        ← 모드 선택으로
      </button>

      <div className="mb-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Factory className="h-5 w-5 text-emerald-500" />
          <h2 className="text-xl font-bold text-slate-800">작업자 PIN 로그인</h2>
        </div>
        <p className="text-slate-500 text-sm">관리자에게 발급받은 4자리 POP PIN을 입력하세요</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        </div>
      ) : (
        <PopNumberPad
          value={pin}
          onChange={setPin}
          onComplete={handlePinComplete}
          maxLength={4}
        />
      )}

      {error && (
        <p className="text-sm text-red-500 text-center mt-4">{error}</p>
      )}
    </div>
  )
}
