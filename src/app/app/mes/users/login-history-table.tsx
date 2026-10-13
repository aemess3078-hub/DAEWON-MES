"use client"

import { useState, useTransition } from "react"
import { Search, Download, ChevronLeft, ChevronRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  getLoginHistory,
  getLoginHistoryExport,
  type LoginHistoryRow,
  type LoginHistoryFilter,
  type PaginatedResult,
} from "@/lib/actions/user-management.actions"

const FAIL_REASON_LABELS: Record<string, string> = {
  USER_NOT_FOUND: "계정 없음",
  INVALID_PASSWORD: "비밀번호 불일치",
  PENDING_APPROVAL: "승인 대기",
  HOLD: "보류",
  REJECTED: "거부됨",
  INACTIVE: "비활성 계정",
  LOCKED: "잠김",
  DELETED: "삭제됨",
}

const EVENT_CONFIG: Record<string, { label: string; className: string }> = {
  LOGIN_SUCCESS: { label: "성공", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  LOGIN_FAIL: { label: "실패", className: "bg-red-50 text-red-700 border-red-200" },
  LOGOUT: { label: "로그아웃", className: "bg-slate-50 text-slate-600 border-slate-200" },
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Seoul" })
}

export function LoginHistoryTable({ initialData }: { initialData: PaginatedResult<LoginHistoryRow> }) {
  const [rows, setRows] = useState<LoginHistoryRow[]>(initialData.rows)
  const [total, setTotal] = useState(initialData.total)
  const [page, setPage] = useState(initialData.page)
  const [pageSize, setPageSize] = useState(initialData.pageSize)

  const [search, setSearch] = useState("")
  const [event, setEvent] = useState<"ALL" | "SUCCESS" | "FAIL">("ALL")
  const [days, setDays] = useState<string>("90")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [includeInactive, setIncludeInactive] = useState(true)

  const [isPending, startTransition] = useTransition()
  const [isExporting, setIsExporting] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function buildFilter(overrides: Partial<LoginHistoryFilter> = {}): LoginHistoryFilter {
    return {
      search,
      event,
      days: Number(days),
      dateFrom: days === "0" ? dateFrom : undefined,
      dateTo: days === "0" ? dateTo : undefined,
      page,
      pageSize,
      ...overrides,
    }
  }

  function refetch(overrides: Partial<LoginHistoryFilter> = {}) {
    startTransition(async () => {
      const data = await getLoginHistory(buildFilter(overrides))
      setRows(data.rows)
      setTotal(data.total)
      setPage(data.page)
      setPageSize(data.pageSize)
    })
  }

  function changeFilter(overrides: Partial<LoginHistoryFilter>) {
    refetch({ page: 1, ...overrides })
  }

  async function handleExport() {
    setIsExporting(true)
    try {
      const allRows = await getLoginHistoryExport({
        search,
        event,
        days: Number(days),
        dateFrom: days === "0" ? dateFrom : undefined,
        dateTo: days === "0" ? dateTo : undefined,
      })
      const XLSX = await import("xlsx")
      const wsData = [
        ["일시", "사용자명", "이메일", "아이디", "결과", "실패사유", "IP", "기기정보"],
        ...allRows.map((r) => [
          formatDateTime(r.createdAt),
          r.name ?? "",
          r.email ?? "",
          r.loginId,
          EVENT_CONFIG[r.eventType]?.label ?? r.eventType,
          r.failReason ? (FAIL_REASON_LABELS[r.failReason] ?? r.failReason) : "",
          r.ipAddress ?? "",
          r.userAgent ?? "",
        ]),
      ]
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(wsData)
      XLSX.utils.book_append_sheet(wb, ws, "접속기록")
      const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).replace(/-/g, "")
      XLSX.writeFile(wb, `접속기록_${date}.xlsx`)
    } finally {
      setIsExporting(false)
    }
  }

  const visibleRows = includeInactive ? rows : rows.filter((r) => r.isActiveUser !== false)
  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, total)

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            changeFilter({ search })
          }}
          className="relative"
        >
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="아이디 / 이름 / 이메일 검색"
            className="h-9 w-[260px] pl-9 text-[14px]"
          />
        </form>

        <Select
          value={event}
          onValueChange={(v) => {
            const next = v as "ALL" | "SUCCESS" | "FAIL"
            setEvent(next)
            changeFilter({ event: next })
          }}
        >
          <SelectTrigger className="h-9 w-[130px] text-[14px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체</SelectItem>
            <SelectItem value="SUCCESS">성공만</SelectItem>
            <SelectItem value="FAIL">실패만</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={days}
          onValueChange={(v) => {
            setDays(v)
            changeFilter({ days: Number(v), page: 1 })
          }}
        >
          <SelectTrigger className="h-9 w-[140px] text-[14px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">최근 7일</SelectItem>
            <SelectItem value="30">최근 30일</SelectItem>
            <SelectItem value="90">최근 3개월</SelectItem>
            <SelectItem value="0">직접 기간</SelectItem>
          </SelectContent>
        </Select>

        {days === "0" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-[140px] text-[14px]"
            />
            <span className="text-[13px] text-muted-foreground">~</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-[140px] text-[14px]"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-[13px]"
              onClick={() => changeFilter({ days: 0, dateFrom, dateTo })}
            >
              조회
            </Button>
          </div>
        )}

        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            const next = Number(v)
            setPageSize(next)
            changeFilter({ pageSize: next, page: 1 })
          }}
        >
          <SelectTrigger className="h-9 w-[120px] text-[14px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="20">20개씩 보기</SelectItem>
            <SelectItem value="50">50개씩 보기</SelectItem>
            <SelectItem value="100">100개씩 보기</SelectItem>
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="h-4 w-4"
          />
          비활성 사용자 포함
        </label>

        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-[13px]"
          onClick={handleExport}
          disabled={isExporting || total === 0}
        >
          <Download className="h-4 w-4" />
          {isExporting ? "다운로드 중…" : "엑셀"}
        </Button>

        {isPending && <span className="text-[13px] text-muted-foreground">불러오는 중…</span>}
      </div>

      {/* 테이블 */}
      <div className="border rounded-xl overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              {["일시", "사용자", "아이디", "결과", "사유", "IP", "기기 / 브라우저"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-[14px] text-muted-foreground">
                  접속 기록이 없습니다.
                </td>
              </tr>
            ) : (
              visibleRows.map((r) => {
                const cfg = EVENT_CONFIG[r.eventType] ?? EVENT_CONFIG.LOGOUT
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground whitespace-nowrap">
                      {formatDateTime(r.createdAt)}
                    </td>
                    <td className="px-4 py-2.5 text-[14px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{r.name ?? "—"}</span>
                        {r.isActiveUser === false && (
                          <span className="text-[11px] rounded bg-slate-100 text-slate-500 border border-slate-200 px-1.5 py-0.5">
                            비활성
                          </span>
                        )}
                      </div>
                      {r.email && <div className="text-[12px] text-muted-foreground">{r.email}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] font-mono text-muted-foreground whitespace-nowrap">
                      {r.loginId}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[12px] whitespace-nowrap ${cfg.className}`}>
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground whitespace-nowrap">
                      {r.failReason ? (FAIL_REASON_LABELS[r.failReason] ?? r.failReason) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] font-mono text-muted-foreground whitespace-nowrap">
                      {r.ipAddress ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-muted-foreground max-w-[260px] truncate" title={r.userAgent ?? ""}>
                      {r.userAgent ?? "—"}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {total === 0 ? "0건" : `${startItem}–${endItem} / 총 ${total.toLocaleString()}건`}
          {total >= 10000 && " (최대 10,000건 표시)"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page <= 1 || isPending}
            onClick={() => refetch({ page: page - 1 })}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-[13px] min-w-[80px] text-center">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page >= totalPages || isPending}
            onClick={() => refetch({ page: page + 1 })}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
