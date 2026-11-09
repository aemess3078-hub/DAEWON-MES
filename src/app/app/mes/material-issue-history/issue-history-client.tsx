"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Search, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { MaterialIssueHistoryPage } from "@/lib/actions/material-issue-history.actions"
import { ISSUE_HISTORY_STATE_LABEL, type MaterialIssueHistoryState } from "@/lib/material-issue/issue-history"
import { formatQuantity } from "@/lib/utils"

const SEARCH_DEBOUNCE_MS = 300

const WORK_ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "초안",
  RELEASED: "릴리즈",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  CANCELLED: "취소",
}

const STATE_BADGE_CLASS: Record<MaterialIssueHistoryState, string> = {
  NORMAL: "border-green-200 bg-green-50 text-green-700",
  PARTIAL_RETURNED: "border-amber-200 bg-amber-100 text-amber-800",
  FULL_RETURNED: "border-slate-300 bg-slate-100 text-slate-700",
  RETURN_ROW: "border-blue-200 bg-blue-100 text-blue-800",
}

type Filters = { q: string; from: string; to: string; wh: string }

function buildHref(pathname: string, f: Filters, page: number): string {
  const params = new URLSearchParams()
  if (f.q) params.set("q", f.q)
  if (f.from) params.set("from", f.from)
  if (f.to) params.set("to", f.to)
  if (f.wh) params.set("wh", f.wh)
  if (page > 1) params.set("page", String(page))
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

const kstFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

function formatTxAt(iso: string): string {
  return kstFormatter.format(new Date(iso))
}

interface Props {
  result: MaterialIssueHistoryPage
  warehouses: Array<{ id: string; code: string; name: string }>
}

export function MaterialIssueHistoryClient({ result, warehouses }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const applied: Filters = { q: result.query, from: result.from ?? "", to: result.to ?? "", wh: result.warehouseId ?? "" }
  const [text, setText] = useState(applied.q)

  useEffect(() => {
    setText(result.query)
  }, [result.query])

  // 검색어: 300ms 디바운스. 검색어·필터가 바뀌면 항상 1페이지로 이동하고 나머지 조건은 유지한다.
  useEffect(() => {
    const next = text.trim().replace(/\s+/g, " ")
    if (next === applied.q) return
    const timer = setTimeout(() => {
      router.replace(buildHref(pathname, { ...applied, q: next }, 1), { scroll: false })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, applied.q, applied.from, applied.to, applied.wh, pathname, router])

  function apply(patch: Partial<Filters>) {
    router.replace(buildHref(pathname, { ...applied, ...patch }, 1), { scroll: false })
  }

  const hasFilter = !!(applied.q || applied.from || applied.to || applied.wh)
  const { rows, total, page, totalPages } = result

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="출고번호, 작업지시번호, 제조번호, 품목, LOT 번호 검색"
            className="h-10 pl-9 pr-9 text-[14px]"
            aria-label="통합 검색"
          />
          {text && (
            <button
              type="button"
              onClick={() => setText("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="검색어 지우기"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 text-[14px]">
          <Input
            type="date"
            value={applied.from}
            max={applied.to || undefined}
            onChange={(e) => apply({ from: e.target.value })}
            className="h-10 w-[160px] text-[14px]"
            aria-label="시작일"
          />
          <span className="text-muted-foreground">~</span>
          <Input
            type="date"
            value={applied.to}
            min={applied.from || undefined}
            onChange={(e) => apply({ to: e.target.value })}
            className="h-10 w-[160px] text-[14px]"
            aria-label="종료일"
          />
        </div>

        <select
          value={applied.wh}
          onChange={(e) => apply({ wh: e.target.value })}
          className="h-10 rounded-md border border-input bg-background px-3 text-[14px]"
          aria-label="출고창고"
        >
          <option value="">전체 창고</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              [{w.code}] {w.name}
            </option>
          ))}
        </select>

        {hasFilter && (
          <Button
            variant="outline"
            size="sm"
            className="h-10 text-[14px]"
            onClick={() => {
              setText("")
              router.replace(pathname, { scroll: false })
            }}
          >
            조건 초기화
          </Button>
        )}

        <span className="text-[14px] text-muted-foreground" data-testid="issue-history-total">
          {hasFilter ? `검색 결과 ${total.toLocaleString()}건` : `전체 ${total.toLocaleString()}건`}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-16 text-center">
          <p className="text-[15px] text-muted-foreground">{hasFilter ? "조건에 맞는 출고 내역이 없습니다." : "출고 내역이 없습니다."}</p>
          {hasFilter && <p className="mt-1 text-[13px] text-muted-foreground">검색어나 기간·창고 조건을 바꿔 보세요.</p>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[1180px] text-[13px]">
            <thead className="border-b bg-muted/30">
              <tr>
                {["출고일시", "구분", "출고번호", "작업지시번호", "제조번호", "자재코드", "자재명", "LOT 번호", "수량", "창고"].map((h, i) => (
                  <th key={h} className={`px-3 py-2.5 font-medium text-muted-foreground ${i === 8 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-muted/20">
                  <td className="whitespace-nowrap px-3 py-2.5">{formatTxAt(row.txAt)}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className={`text-[12px] ${STATE_BADGE_CLASS[row.state]}`}>
                      {ISSUE_HISTORY_STATE_LABEL[row.state]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 font-mono">{row.txNo}</td>
                  <td className="px-3 py-2.5">
                    <span className="font-mono">{row.workOrder.orderNo}</span>
                    <div className="text-[12px] text-muted-foreground">{WORK_ORDER_STATUS_LABEL[row.workOrder.status] ?? row.workOrder.status}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-blue-700">{row.workOrder.manufacturingNo ?? "-"}</td>
                  <td className="px-3 py-2.5 font-mono">{row.item.code}</td>
                  <td className="px-3 py-2.5">{row.item.name}</td>
                  <td className="px-3 py-2.5 font-mono">{row.lotNo ?? "-"}</td>
                  <td className="px-3 py-2.5 text-right">
                    <span className={row.kind === "RETURN" ? "text-blue-700" : undefined}>
                      {row.kind === "RETURN" ? "-" : ""}
                      {formatQuantity(row.qty)} {row.item.uom}
                    </span>
                    {row.kind === "ISSUE" && row.returnedQty > 0 && (
                      <div className="text-[12px] text-amber-700">반납 {formatQuantity(row.returnedQty)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{row.warehouse ? `[${row.warehouse.code}] ${row.warehouse.name}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[14px]">
          <span className="text-muted-foreground">
            {page} / {totalPages} 페이지
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button variant="outline" size="sm" className="h-8 text-[13px]" asChild>
                <Link href={buildHref(pathname, applied, page - 1)} scroll={false}>이전</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-8 text-[13px]" disabled>이전</Button>
            )}
            {page < totalPages ? (
              <Button variant="outline" size="sm" className="h-8 text-[13px]" asChild>
                <Link href={buildHref(pathname, applied, page + 1)} scroll={false}>다음</Link>
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="h-8 text-[13px]" disabled>다음</Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
