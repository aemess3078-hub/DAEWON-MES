"use client"

import Link from "next/link"
import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ClipboardCheck, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CompletionTabs, initialCompletionTab, type CompletionTab } from "@/components/common/completion-tabs"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { startStockCount, type StockCountListRow } from "@/lib/actions/stock-count.actions"
import { STOCK_COUNT_STATUS_LABEL } from "@/lib/stock-count/stock-count-calc"
import { formatQuantity } from "@/lib/utils"
import { STATUS_BADGE, formatDuration, formatKstDateTime } from "./stock-count-format"

interface Props {
  rows: StockCountListRow[]
  warehouses: { id: string; code: string; name: string }[]
  canCreate: boolean
}

export function StockCountListClient({ rows, warehouses, canCreate }: Props) {
  const router = useRouter()
  const activeRows = useMemo(() => rows.filter((r) => r.status === "IN_PROGRESS"), [rows])
  const historyRows = useMemo(() => rows.filter((r) => r.status !== "IN_PROGRESS"), [rows])
  const [tab, setTab] = useState<CompletionTab>(() => initialCompletionTab(activeRows.length, historyRows.length))
  const shown = tab === "completed" ? historyRows : activeRows

  const [open, setOpen] = useState(false)
  const [warehouseId, setWarehouseId] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const runningWarehouseIds = useMemo(() => new Set(activeRows.map((r) => r.warehouse.id)), [activeRows])

  function submit() {
    setError(null)
    startTransition(async () => {
      const res = await startStockCount({ warehouseId, note })
      if (!res.success) {
        setError(res.error)
        return
      }
      setOpen(false)
      setNote("")
      router.push(`/app/mes/stock-count/${res.data?.id}`)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <CompletionTabs value={tab} onChange={setTab} activeCount={activeRows.length} completedCount={historyRows.length} activeLabel="진행 중" completedLabel="실사 이력" />
        {canCreate && (
          <Button onClick={() => { setError(null); setWarehouseId(""); setOpen(true) }}>
            <ClipboardCheck className="mr-2 h-4 w-4" />
            실사 시작
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full min-w-[1000px] text-[14px]">
          <thead>
            <tr className="border-b bg-slate-50 text-[13px] text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">실사번호</th>
              <th className="px-4 py-3 text-left font-medium">창고</th>
              <th className="px-4 py-3 text-left font-medium">상태</th>
              <th className="px-4 py-3 text-left font-medium">실사 시작</th>
              <th className="px-4 py-3 text-left font-medium">실사 종료</th>
              <th className="px-4 py-3 text-right font-medium">대상</th>
              <th className="px-4 py-3 text-right font-medium">입력</th>
              <th className="px-4 py-3 text-right font-medium">차이 건수</th>
              <th className="px-4 py-3 text-right font-medium">조정</th>
              <th className="px-4 py-3 text-left font-medium">담당</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-[14px] text-muted-foreground">
                  {tab === "completed" ? "실사 이력이 없습니다." : "진행 중인 실사가 없습니다."}
                </td>
              </tr>
            ) : (
              shown.map((r) => {
                const duration = formatDuration(r.startedAt, r.endedAt)
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <Link href={`/app/mes/stock-count/${r.id}`} className="font-mono text-[13px] text-blue-700 hover:underline">
                        {r.countNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{r.warehouse.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={`text-[13px] ${STATUS_BADGE[r.status]}`}>{STOCK_COUNT_STATUS_LABEL[r.status]}</Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-[13px]">{formatKstDateTime(r.startedAt)}</td>
                    <td className="px-4 py-3 font-mono text-[13px]">
                      {formatKstDateTime(r.endedAt)}
                      {duration && <span className="ml-2 text-muted-foreground">({duration})</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatQuantity(r.summary.lineCount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatQuantity(r.summary.countedCount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.summary.diffLineCount > 0 ? <span className="font-medium text-red-600">{formatQuantity(r.summary.diffLineCount)}</span> : "0"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[13px] text-muted-foreground">
                      {r.status === "COMPLETED" && r.summary.diffLineCount > 0
                        ? `${r.summary.adjustedCount}/${r.summary.diffLineCount}`
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-muted-foreground">{r.startedByName ?? "-"}</td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!pending) setOpen(o) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>재고실사 시작</DialogTitle>
            <DialogDescription>
              선택한 창고의 현재 재고(수량 0 초과)가 전산수량으로 기록되고, 지금 시각이 실사 시작 시각이 됩니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[14px]">실사 창고</Label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-[14px]"
                disabled={pending}
              >
                <option value="">창고 선택</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id} disabled={runningWarehouseIds.has(w.id)}>
                    {w.name} ({w.code}){runningWarehouseIds.has(w.id) ? " — 실사 진행 중" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-[14px]">비고 (선택)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 11월 정기 실사" disabled={pending} />
            </div>
            {error && <p className="text-[13px] text-red-600">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>닫기</Button>
            <Button onClick={submit} disabled={pending || !warehouseId}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              실사 시작
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
