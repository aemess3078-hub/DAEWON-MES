"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  adjustAllStockCountLines,
  adjustStockCountLine,
  cancelStockCount,
  finishStockCount,
  saveStockCountQuantities,
  type StockCountDetail,
  type StockCountLineView,
} from "@/lib/actions/stock-count.actions"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { STOCK_COUNT_STATUS_LABEL, calcCountDiff, parseCountedQty, summarizeCount } from "@/lib/stock-count/stock-count-calc"
import { formatQuantity } from "@/lib/utils"
import { STATUS_BADGE, formatDuration, formatKstDateTime } from "./stock-count-format"

const MANAGER_ROLES = new Set(["OWNER", "ADMIN", "MANAGER"])

type ReasonDialog =
  | { kind: "cancel" }
  | { kind: "adjust-line"; line: StockCountLineView }
  | { kind: "adjust-all" }
  | null

export function StockCountDetailClient({ detail, canUpdate }: { detail: StockCountDetail; canUpdate: boolean }) {
  const router = useRouter()
  const role = useUserRole()
  const canAdjust = canUpdate && MANAGER_ROLES.has(role)
  const inProgress = detail.status === "IN_PROGRESS"
  const completed = detail.status === "COMPLETED"

  // 입력 중인 실사수량(문자열). 서버값으로 초기화.
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(detail.lines.map((l) => [l.id, l.countedQty == null ? "" : String(l.countedQty)])),
  )
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null)
  const [dialog, setDialog] = useState<ReasonDialog>(null)
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()

  const dirtyLines = useMemo(
    () => detail.lines.filter((l) => (draft[l.id] ?? "") !== (l.countedQty == null ? "" : String(l.countedQty))),
    [detail.lines, draft],
  )
  const liveSummary = useMemo(
    () =>
      summarizeCount(
        detail.lines.map((l) => {
          const parsed = inProgress ? parseCountedQty(draft[l.id]) : l.countedQty
          return { systemQty: l.systemQty, countedQty: parsed === undefined ? null : parsed, adjustedAt: l.adjustedAt }
        }),
      ),
    [detail.lines, draft, inProgress],
  )
  const summary = inProgress ? liveSummary : detail.summary
  const duration = formatDuration(detail.startedAt, detail.endedAt)

  function run(fn: () => Promise<{ success: boolean; error?: string } & Record<string, unknown>>, okText: string) {
    setMessage(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.success) {
        setMessage({ type: "error", text: res.error ?? "처리 중 오류가 발생했습니다." })
        return
      }
      setMessage({ type: "ok", text: okText })
      router.refresh()
    })
  }

  function save() {
    run(
      () =>
        saveStockCountQuantities({
          stockCountId: detail.id,
          counts: dirtyLines.map((l) => ({ lineId: l.id, countedQty: draft[l.id] ?? "" })),
        }) as Promise<{ success: boolean; error?: string }>,
      "실사수량을 저장했습니다.",
    )
  }

  function finish() {
    if (dirtyLines.length > 0) {
      setMessage({ type: "error", text: "저장하지 않은 실사수량이 있습니다. 먼저 저장해 주세요." })
      return
    }
    const uncounted = detail.summary.uncountedCount
    const text = uncounted > 0
      ? `실사수량을 입력하지 않은 ${uncounted}건이 있습니다. 미입력 줄은 조정 대상에서 제외됩니다.\n실사를 종료하시겠습니까? 종료 시각이 기록됩니다.`
      : "실사를 종료하시겠습니까? 종료 시각이 기록됩니다."
    if (!confirm(text)) return
    run(() => finishStockCount(detail.id) as Promise<{ success: boolean; error?: string }>, "실사를 종료했습니다. 차이가 있는 줄은 조정할 수 있습니다.")
  }

  function submitDialog() {
    if (!dialog) return
    const r = reason.trim()
    if (!r) {
      setMessage({ type: "error", text: dialog.kind === "cancel" ? "취소 사유를 입력해 주세요." : "재고조정 사유를 입력해 주세요." })
      return
    }
    const current = dialog
    setDialog(null)
    setReason("")
    if (current.kind === "cancel") run(() => cancelStockCount({ stockCountId: detail.id, reason: r }), "실사를 취소했습니다.")
    else if (current.kind === "adjust-line") run(() => adjustStockCountLine({ lineId: current.line.id, reason: r }), `${current.line.itemCode} 재고를 조정했습니다.`)
    else {
      setMessage(null)
      startTransition(async () => {
        const res = await adjustAllStockCountLines({ stockCountId: detail.id, reason: r })
        if (!res.success) {
          setMessage({ type: "error", text: res.error })
          return
        }
        const failed = res.data?.failed ?? []
        setMessage(
          failed.length
            ? { type: "error", text: `${res.data?.adjusted ?? 0}건 조정, ${failed.length}건 실패: ${failed.slice(0, 3).join(" / ")}` }
            : { type: "ok", text: `${res.data?.adjusted ?? 0}건을 조정했습니다.` },
        )
        router.refresh()
      })
    }
  }

  return (
    <div className="space-y-5">
      {/* 요약 */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-4">
          <Info label="창고" value={detail.warehouse.name} />
          <Info label="상태" value={<Badge variant="outline" className={`text-[13px] ${STATUS_BADGE[detail.status]}`}>{STOCK_COUNT_STATUS_LABEL[detail.status]}</Badge>} />
          <Info label="실사 시작" value={<span className="font-mono">{formatKstDateTime(detail.startedAt)}</span>} sub={detail.startedByName ?? undefined} />
          <Info
            label="실사 종료"
            value={<span className="font-mono">{formatKstDateTime(detail.endedAt)}</span>}
            sub={[detail.endedByName, duration && `소요 ${duration}`].filter(Boolean).join(" · ") || undefined}
          />
        </div>
        {detail.note && <p className="mt-4 text-[14px] text-muted-foreground">비고: {detail.note}</p>}
        {detail.cancelReason && <p className="mt-2 text-[14px] text-red-600">취소 사유: {detail.cancelReason}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="대상 줄" value={formatQuantity(summary.lineCount)} />
        <Stat label="실사 입력" value={`${formatQuantity(summary.countedCount)} / ${formatQuantity(summary.lineCount)}`} />
        <Stat label="차이 줄" value={formatQuantity(summary.diffLineCount)} tone={summary.diffLineCount > 0 ? "warn" : undefined} />
        <Stat label="초과 / 부족 수량" value={`+${formatQuantity(summary.plusQty)} / ${formatQuantity(summary.minusQty)}`} />
        <Stat label="조정 완료" value={`${formatQuantity(summary.adjustedCount)} / ${formatQuantity(summary.diffLineCount)}`} />
      </div>

      {inProgress && (
        <p className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-[14px] text-blue-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          실사 중에도 입출고는 계속할 수 있습니다. 조정할 때 시작 이후 변동분은 보존해서 반영합니다.
        </p>
      )}

      {message && (
        <p className={`rounded-md border px-4 py-2.5 text-[14px] ${message.type === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.type === "ok" && <CheckCircle2 className="mr-1.5 inline h-4 w-4" />}
          {message.text}
        </p>
      )}

      {/* 액션 */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {inProgress && canUpdate && (
          <>
            <Button variant="outline" onClick={() => { setReason(""); setDialog({ kind: "cancel" }) }} disabled={pending}>실사 취소</Button>
            <Button variant="outline" onClick={save} disabled={pending || dirtyLines.length === 0}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              수량 저장{dirtyLines.length > 0 ? ` (${dirtyLines.length})` : ""}
            </Button>
            <Button onClick={finish} disabled={pending}>실사 종료</Button>
          </>
        )}
        {completed && canAdjust && summary.pendingAdjustCount > 0 && (
          <Button onClick={() => { setReason("재고실사 결과 반영"); setDialog({ kind: "adjust-all" }) }} disabled={pending}>
            차이 {summary.pendingAdjustCount}건 일괄 조정
          </Button>
        )}
        {completed && !canAdjust && summary.pendingAdjustCount > 0 && (
          <span className="text-[13px] text-muted-foreground">재고 조정은 MANAGER 이상 권한이 필요합니다.</span>
        )}
      </div>

      {/* 실사 줄 */}
      <div className="rounded-lg border border-border bg-card overflow-x-auto">
        <table className="w-full min-w-[960px] text-[14px]">
          <thead>
            <tr className="border-b bg-slate-50 text-[13px] text-muted-foreground">
              <th className="px-4 py-3 text-left font-medium">품목코드</th>
              <th className="px-4 py-3 text-left font-medium">품목명</th>
              <th className="px-4 py-3 text-left font-medium">LOT</th>
              <th className="px-4 py-3 text-right font-medium">전산수량 (시작 시점)</th>
              <th className="px-4 py-3 text-right font-medium">실사수량</th>
              <th className="px-4 py-3 text-right font-medium">차이</th>
              <th className="px-4 py-3 text-left font-medium">조정</th>
            </tr>
          </thead>
          <tbody>
            {detail.lines.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">이 창고에 실사 대상 재고가 없습니다.</td></tr>
            ) : (
              detail.lines.map((l) => {
                const parsed = inProgress ? parseCountedQty(draft[l.id]) : l.countedQty
                const diff = parsed == null ? null : calcCountDiff(l.systemQty, parsed)
                return (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-[13px]">{l.itemCode}</td>
                    <td className="px-4 py-2.5">{l.itemName}</td>
                    <td className="px-4 py-2.5 font-mono text-[13px] text-blue-700">{l.lotNo ?? "-"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatQuantity(l.systemQty)} <span className="text-[12px] text-muted-foreground">{l.uom}</span></td>
                    <td className="px-4 py-2.5 text-right">
                      {inProgress && canUpdate ? (
                        <input
                          inputMode="decimal"
                          value={draft[l.id] ?? ""}
                          onChange={(e) => setDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                          className={`w-28 rounded-md border px-2 py-1.5 text-right text-[14px] tabular-nums ${parsed === undefined ? "border-red-400" : "border-border"}`}
                          placeholder="입력"
                          disabled={pending}
                        />
                      ) : (
                        <span className="tabular-nums">{l.countedQty == null ? <span className="text-muted-foreground">미입력</span> : formatQuantity(l.countedQty)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {diff == null ? <span className="text-muted-foreground">-</span> : diff === 0 ? "0" : (
                        <span className={diff > 0 ? "font-medium text-emerald-700" : "font-medium text-red-600"}>{diff > 0 ? "+" : ""}{formatQuantity(diff)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {l.adjustedAt ? (
                        <div className="text-[13px]">
                          <span className="font-medium text-green-700">조정 완료</span>
                          <div className="text-muted-foreground">{l.adjustTxNo} · {formatKstDateTime(l.adjustedAt)}</div>
                          {l.adjustReason && <div className="text-muted-foreground">사유: {l.adjustReason}</div>}
                        </div>
                      ) : completed && diff != null && diff !== 0 ? (
                        <div className="flex items-center gap-2">
                          {canAdjust ? (
                            <Button size="sm" variant="outline" className="h-8 text-[13px]" disabled={pending} onClick={() => { setReason("재고실사 결과 반영"); setDialog({ kind: "adjust-line", line: l }) }}>조정</Button>
                          ) : (
                            <span className="text-[13px] text-muted-foreground">대기</span>
                          )}
                          {l.drifted && <span className="text-[12px] text-amber-700" title={`현재고 ${formatQuantity(l.currentQty)}`}>실사 중 입출고 있음</span>}
                        </div>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">-</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={dialog != null} onOpenChange={(o) => { if (!o && !pending) setDialog(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog?.kind === "cancel" ? "실사 취소" : dialog?.kind === "adjust-line" ? "재고 조정" : "차이 일괄 조정"}</DialogTitle>
            <DialogDescription>
              {dialog?.kind === "cancel"
                ? "진행 중인 실사를 취소합니다. 재고는 변경되지 않습니다."
                : dialog?.kind === "adjust-line"
                  ? `${dialog.line.itemCode} 의 재고를 실사 결과에 맞춰 조정합니다. 재고조정 이력과 감사로그에 사유가 기록됩니다.`
                  : "차이가 있고 아직 조정하지 않은 모든 줄을 실사 결과에 맞춰 조정합니다. 재고조정 이력과 감사로그에 사유가 기록됩니다."}
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dialog?.kind === "cancel" ? "취소 사유" : "재고조정 사유"} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>닫기</Button>
            <Button onClick={submitDialog} variant={dialog?.kind === "cancel" ? "destructive" : "default"}>
              {dialog?.kind === "cancel" ? "취소 확정" : "조정 확정"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Info({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <div className="mt-1 text-[15px] font-medium text-foreground">{value}</div>
      {sub && <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums ${tone === "warn" ? "text-red-600" : "text-foreground"}`}>{value}</p>
    </div>
  )
}
