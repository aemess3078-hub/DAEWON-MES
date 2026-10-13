"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import { BrandLogo } from "@/components/brand-logo"
import { ClipboardList, PlayCircle } from "lucide-react"

type Props = {
  workerName?: string
  onLogout?: () => void
}

const POP_NAV = [
  { label: "작업대기", href: "/pop/work-select", icon: ClipboardList },
  { label: "생산실적", href: "/pop/production", icon: PlayCircle },
]

export function PopHeader({ workerName = "작업자", onLogout }: Props) {
  const [now, setNow] = useState<Date | null>(null)
  const pathname = usePathname()

  async function handleLogout() {
    if (onLogout) {
      onLogout()
      return
    }

    await fetch("/api/pop/logout", { method: "POST" }).catch(() => null)
    document.cookie = "nmes-mode=; path=/; max-age=0"
    document.cookie = "nmes-worker-name=; path=/; max-age=0"
    window.location.href = "/login"
  }

  useEffect(() => {
    setNow(new Date())
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <header className="bg-slate-800 text-white">
      {/* 상단 바 */}
      <div className="px-6 py-3 flex items-center justify-between">
        <BrandLogo size="sm" tone="onDark" />
        <div className="text-center">
          <div className="text-xl font-mono tabular-nums">
            {now ? format(now, "HH:mm:ss") : "--:--:--"}
          </div>
          <div className="text-sm text-slate-300">
            {now ? format(now, "yyyy년 MM월 dd일 (EEE)", { locale: ko }) : ""}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-300">{workerName}</span>
          <Link
            href="/app/mes/"
            className="text-sm bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded-lg transition-colors"
          >
            시스템모드
          </Link>
          <button
            onClick={handleLogout}
            className="text-sm bg-red-600 hover:bg-red-700 px-3 py-1 rounded-lg transition-colors"
          >
            로그아웃
          </button>
        </div>
      </div>

      {/* POP 탭 네비게이션 */}
      <nav className="flex border-t border-slate-700">
        {POP_NAV.map(({ label, href, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-8 py-3 text-base font-medium transition-colors border-b-2 ${
                isActive
                  ? "border-blue-400 text-white bg-slate-700"
                  : "border-transparent text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              <Icon size={18} />
              {label}
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
