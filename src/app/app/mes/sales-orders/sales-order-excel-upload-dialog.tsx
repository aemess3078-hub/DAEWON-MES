"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  importSalesOrderExcelRows,
  validateSalesOrderExcelRows,
  type SalesOrderExcelCreated,
  type SalesOrderExcelUploadInput,
} from "@/lib/actions/sales-order-excel.actions"
import {
  SALES_ORDER_EXCEL_MAX_BYTES,
  SALES_ORDER_EXCEL_MAX_ROWS,
  SALES_ORDER_EXCEL_COLUMNS,
  salesOrderIssueRows,
  type SalesOrderDuplicateSuspect,
  type SalesOrderExcelIssue,
  type SalesOrderExcelPlan,
} from "@/lib/sales-order-excel"
import downloadSalesOrderTemplate from "./sales-order-excel-download"

// ─── 엑셀 읽기 ────────────────────────────────────────────────────────────────

type ReadResult = { ok: true; input: SalesOrderExcelUploadInput; dataRows: number } | { ok: false; error: string }

/** 엑셀 첫 시트를 읽는다. 1행은 안내, 2행이 헤더, 3행부터 데이터. 빈 행과 ※ 안내 행은 건너뛴다. */
async function readSalesOrderFile(file: File): Promise<ReadResult> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) return { ok: false, error: ".xlsx 파일만 업로드할 수 있습니다." }
  if (file.size > SALES_ORDER_EXCEL_MAX_BYTES) return { ok: false, error: "파일 크기는 5MB 이하만 허용됩니다." }

  const XLSX = await import("xlsx")
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellFormula: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) return { ok: false, error: "엑셀 파일에 시트가 없습니다." }

  // range: 1 → 2행부터 읽는다(aoa[0] = 헤더, aoa[k] = 시트 (k + 2)행)
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, range: 1, defval: "", blankrows: true, raw: true })
  if (aoa.length === 0) return { ok: false, error: "헤더 행을 찾을 수 없습니다. 표준 양식을 사용하세요." }

  const headers = (aoa[0] as unknown[]).map((h) => String(h ?? "").replace(/\s*\*\s*/g, "").trim())
  const ws = wb.Sheets[sheetName]
  const poCol = headers.indexOf(SALES_ORDER_EXCEL_COLUMNS.customerPoNo)
  const rows: SalesOrderExcelUploadInput["rows"] = []
  for (let k = 1; k < aoa.length; k++) {
    const line = aoa[k] as unknown[]
    const first = String(line[0] ?? "").trim()
    if (line.every((v) => String(v ?? "").trim() === "")) continue
    if (first.startsWith("※")) continue
    const cells: Record<string, unknown> = {}
    headers.forEach((h, j) => {
      if (h) cells[h] = line[j]
    })
    // 거래처 발주번호는 엑셀에 보이는 문자열 그대로 읽는다(숫자 셀이어도 표시 형식 유지 — 앞자리 0·긴 번호 보존)
    if (poCol >= 0) {
      const cell = ws[XLSX.utils.encode_cell({ r: k + 1, c: poCol })]
      if (cell) cells[SALES_ORDER_EXCEL_COLUMNS.customerPoNo] = cell.w ?? (cell.v != null ? String(cell.v) : "")
    }
    rows.push({ rowNum: k + 2, cells })
    if (rows.length > SALES_ORDER_EXCEL_MAX_ROWS) {
      return { ok: false, error: `최대 ${SALES_ORDER_EXCEL_MAX_ROWS.toLocaleString("ko-KR")}행까지 업로드할 수 있습니다.` }
    }
  }
  if (rows.length === 0) return { ok: false, error: "등록할 데이터 행이 없습니다. 안내 행을 제외하고 데이터를 입력하세요." }
  return { ok: true, input: { headers, rows }, dataRows: rows.length }
}

async function downloadIssues(issues: SalesOrderExcelIssue[], duplicates: SalesOrderDuplicateSuspect[]) {
  const XLSX = await import("xlsx")
  const ws = XLSX.utils.aoa_to_sheet([["행", "수주그룹ID", "구분", "열", "사유"], ...salesOrderIssueRows(issues, duplicates)])
  ws["!cols"] = [{ wch: 8 }, { wch: 16 }, { wch: 12 }, { wch: 18 }, { wch: 80 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "오류내역")
  XLSX.writeFile(wb, "수주_업로드_오류내역.xlsx")
}

const won = (n: number | null | undefined) => (n == null ? "-" : Math.round(n).toLocaleString("ko-KR"))

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

type Step = "select" | "preview" | "done"

interface SalesOrderExcelUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  siteId: string
}

export function SalesOrderExcelUploadDialog({ open, onOpenChange, siteId }: SalesOrderExcelUploadDialogProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>("select")
  const [fileName, setFileName] = useState("")
  const [error, setError] = useState("")
  const [input, setInput] = useState<SalesOrderExcelUploadInput | null>(null)
  const [plan, setPlan] = useState<SalesOrderExcelPlan | null>(null)
  const [created, setCreated] = useState<SalesOrderExcelCreated[]>([])
  /** 중복 의심을 확인하고 그대로 등록하기로 한 수주그룹ID */
  const [confirmed, setConfirmed] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()

  function reset() {
    setStep("select")
    setFileName("")
    setError("")
    setInput(null)
    setPlan(null)
    setCreated([])
    setConfirmed([])
    if (fileRef.current) fileRef.current.value = ""
  }

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setError("")
    setPlan(null)
    setConfirmed([])
    const read = await readSalesOrderFile(file)
    if (!read.ok) {
      setError(read.error)
      return
    }
    setInput(read.input)
    startTransition(async () => {
      const res = await validateSalesOrderExcelRows(read.input)
      if (!res.success) {
        setError(res.error)
        return
      }
      setPlan(res.plan)
      setStep("preview")
    })
  }

  function toggleConfirm(groupId: string, on: boolean) {
    setConfirmed((prev) => (on ? Array.from(new Set([...prev, groupId])) : prev.filter((g) => g !== groupId)))
  }

  function handleImport() {
    if (!input || !canImportNow) return
    startTransition(async () => {
      const res = await importSalesOrderExcelRows(input, siteId, confirmed)
      if (res.success) {
        setCreated(res.created)
        setStep("done")
        router.refresh()
        return
      }
      setError(res.error)
      if (res.plan) setPlan(res.plan)
    })
  }

  // 오류가 없고, 중복 의심이 모두 확인된 경우에만 등록할 수 있다(서버가 다시 검증한다)
  const canImportNow =
    !!plan && plan.issues.length === 0 && plan.groups.length > 0 && plan.duplicates.every((d) => confirmed.includes(d.groupId))
  const allGroupsDuplicate = !!plan && plan.groups.length > 0 && plan.duplicates.length === plan.groups.length && plan.duplicates.every((d) => d.existing)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isPending) handleClose() }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">수주 엑셀 업로드</DialogTitle>
          <DialogDescription className="text-[14px]">
            등록 전에는 데이터가 저장되지 않습니다. 미리보기에서 확인한 뒤 등록하세요.
          </DialogDescription>
        </DialogHeader>

        {/* ── 1단계: 파일 선택 ── */}
        {step === "select" && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed bg-muted/20 p-4">
              <div className="flex items-center gap-3 text-[14px] text-muted-foreground">
                <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
                <div>
                  <p className="font-medium text-foreground">표준 양식을 먼저 다운로드하세요</p>
                  <p className="text-[13px]">양식에 수주 정보를 입력한 뒤 업로드합니다.</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={downloadSalesOrderTemplate} className="shrink-0 gap-2">
                <Download className="h-4 w-4" />
                엑셀 양식 다운로드
              </Button>
            </div>

            <div>
              <p className="mb-2 text-[14px] font-medium">업로드 파일 선택</p>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 transition-colors hover:bg-muted/10">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span className="text-[14px] text-muted-foreground">{fileName || ".xlsx 파일을 선택하세요 (최대 5MB, 1,000행)"}</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={isPending}
                />
              </label>
              {error && (
                <p className="mt-2 flex items-center gap-1.5 text-[13px] text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </p>
              )}
              {isPending && <p className="mt-2 text-[13px] text-muted-foreground">검증 중입니다…</p>}
            </div>
          </div>
        )}

        {/* ── 2단계: 미리보기 ── */}
        {step === "preview" && plan && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <SummaryCard label="엑셀 전체 행" value={plan.summary.totalRows} />
              <SummaryCard label="등록 예정 수주" value={plan.summary.orderCount} />
              <SummaryCard label="등록 예정 품목" value={plan.summary.itemCount} />
              <SummaryCard label="정상 행" value={plan.summary.validRows} tone="ok" />
              <SummaryCard label="오류 행" value={plan.summary.errorRows} tone={plan.summary.errorRows > 0 ? "error" : undefined} />
              <SummaryCard label="중복 의심 수주" value={plan.summary.duplicateGroupCount} tone={plan.summary.duplicateGroupCount > 0 ? "warn" : undefined} />
            </div>

            {allGroupsDuplicate && (
              <p className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-50 px-3 py-2 text-[14px] text-amber-900" data-testid="so-xlsx-same-file">
                <AlertCircle className="h-4 w-4 shrink-0" />
                이 파일의 수주가 모두 기존 수주와 같은 발주번호·내용으로 보입니다. 같은 파일을 다시 올린 것이 아닌지 확인하세요.
              </p>
            )}

            {plan.issues.length > 0 ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[14px] font-medium text-destructive">
                    <AlertCircle className="h-4 w-4" />
                    오류 {plan.issues.length}건 — 수정 전까지 등록할 수 없습니다
                  </p>
                  <Button variant="outline" size="sm" onClick={() => downloadIssues(plan.issues, plan.duplicates)}>
                    오류 내역 다운로드
                  </Button>
                </div>
                <ScrollArea className="h-32">
                  <ul className="space-y-1 pr-3 text-[13px]">
                    {plan.issues.map((i, idx) => (
                      <li key={`${i.rowNum}-${idx}`} className="leading-snug">
                        <span className="font-medium">{i.rowNum}행</span>
                        <span className="mx-1 text-muted-foreground">[오류]</span>
                        {i.message}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 rounded-lg border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-[14px] text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
                {plan.duplicates.length > 0 ? "오류는 없습니다. 아래 중복 의심 수주를 확인해 주세요." : "모든 행이 정상입니다. 아래 내용을 확인한 뒤 등록하세요."}
              </p>
            )}

            {plan.duplicates.length > 0 && (
              <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-50/60 p-3" data-testid="so-xlsx-duplicates">
                <p className="text-[14px] font-medium text-amber-900">
                  중복 의심 {plan.duplicates.length}건 — 기존 수주를 확인하고, 그대로 등록할 수주만 체크하세요
                </p>
                <ul className="space-y-2">
                  {plan.duplicates.map((d) => (
                    <li key={d.groupId} className="rounded-md border bg-background p-3 text-[13px]">
                      <p className="font-medium">
                        {d.rowNum}행 · 수주그룹 {d.groupId}
                      </p>
                      <p className="mt-0.5 leading-snug text-muted-foreground">{d.message}</p>
                      {d.existing && (
                        <p className="mt-1 leading-snug">
                          <span className="font-mono font-medium">{d.existing.orderNo}</span>
                          <span className="mx-1 text-muted-foreground">·</span>
                          발주번호 {d.existing.customerPoNo ?? "없음"}
                          <span className="mx-1 text-muted-foreground">·</span>
                          수주일 {d.existing.orderDate} / 납기 {d.existing.deliveryDate}
                          {d.existing.itemSummary ? ` · ${d.existing.itemSummary}` : ""}
                        </p>
                      )}
                      <label className="mt-2 flex cursor-pointer items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={confirmed.includes(d.groupId)}
                          onChange={(e) => toggleConfirm(d.groupId, e.target.checked)}
                          data-testid={`so-xlsx-confirm-${d.groupId}`}
                        />
                        기존 수주를 확인했으며 중복이 아니므로 그대로 등록합니다
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-2 text-[14px] font-medium">등록 예정 내용</p>
              <ScrollArea className="h-64 rounded-md border">
                <table className="w-full min-w-[720px] text-[13px]">
                  <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 text-left font-medium">행</th>
                      <th className="px-2 py-2 text-left font-medium">수주그룹ID</th>
                      <th className="px-2 py-2 text-left font-medium">거래처</th>
                      <th className="px-2 py-2 text-left font-medium">수주일 / 납기일</th>
                      <th className="px-2 py-2 text-left font-medium">품목</th>
                      <th className="px-2 py-2 text-right font-medium">수량</th>
                      <th className="px-2 py-2 text-right font-medium">단가</th>
                      <th className="px-2 py-2 text-right font-medium">금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.groups.flatMap((g) =>
                      g.lines.map((l, idx) => (
                        <tr key={`${g.groupId}-${l.rowNum}`} className="border-t">
                          <td className="px-2 py-1.5 text-muted-foreground">{l.rowNum}</td>
                          <td className="px-2 py-1.5">{idx === 0 ? g.groupId : ""}</td>
                          <td className="px-2 py-1.5">{idx === 0 ? `${g.customerName || g.customerCode}` : ""}</td>
                          <td className="px-2 py-1.5">{idx === 0 ? `${g.orderDate ?? "-"} / ${g.deliveryDate ?? "-"}` : ""}</td>
                          <td className="px-2 py-1.5">{l.itemCode} {l.itemName}</td>
                          <td className="px-2 py-1.5 text-right">{l.qty.toLocaleString("ko-KR")}</td>
                          <td className="px-2 py-1.5 text-right">
                            {won(l.unitPrice)}
                            {l.unitPriceSource === "CALCULATED" && <span className="ml-1 text-muted-foreground">(계산)</span>}
                          </td>
                          <td className="px-2 py-1.5 text-right">{won(l.lineAmount)}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </ScrollArea>
              {plan.groups.some((g) => g.totalAmount != null) && (
                <p className="mt-2 text-[13px] text-muted-foreground">
                  수주 총금액:{" "}
                  {plan.groups
                    .filter((g) => g.totalAmount != null)
                    .map((g) => `${g.groupId} ${won(g.totalAmount)}원`)
                    .join(" / ")}
                </p>
              )}
            </div>

            {error && (
              <p className="flex items-center gap-1.5 text-[13px] text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </p>
            )}
          </div>
        )}

        {/* ── 3단계: 등록 결과 ── */}
        {step === "done" && (
          <div className="space-y-4 py-2">
            <p className="flex items-center gap-2 text-[15px] font-medium text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              수주 {created.length}건, 품목 {created.reduce((s, c) => s + c.itemCount, 0)}개가 등록되었습니다.
            </p>
            <ScrollArea className="h-56 rounded-md border">
              <table className="w-full text-[14px]">
                <thead className="sticky top-0 bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">수주번호</th>
                    <th className="px-3 py-2 text-left font-medium">엑셀 수주그룹ID</th>
                    <th className="px-3 py-2 text-right font-medium">품목 수</th>
                  </tr>
                </thead>
                <tbody>
                  {created.map((c) => (
                    <tr key={c.orderNo} className="border-t">
                      <td className="px-3 py-2 font-medium">{c.orderNo}</td>
                      <td className="px-3 py-2">{c.orderGroupId}</td>
                      <td className="px-3 py-2 text-right">{c.itemCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            <p className="text-[13px] text-muted-foreground">등록된 수주는 확정 상태로 저장되었습니다. 같은 파일을 다시 올리면 중복 의심으로 표시되어 확인 후에만 등록할 수 있습니다.</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "select" && (
            <Button variant="outline" onClick={handleClose}>닫기</Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={() => { setStep("select"); setPlan(null); setError(""); setFileName(""); if (fileRef.current) fileRef.current.value = "" }} disabled={isPending}>
                다른 파일 선택
              </Button>
              <Button onClick={handleImport} disabled={isPending || !canImportNow} data-testid="so-xlsx-import">
                {isPending ? "등록 중…" : `${plan?.summary.orderCount ?? 0}건 등록`}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button onClick={handleClose}>확인</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "ok" | "error" | "warn" }) {
  const color = tone === "error" ? "text-destructive" : tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : "text-foreground"
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`mt-1 text-[18px] font-semibold ${color}`}>{value.toLocaleString("ko-KR")}</p>
    </div>
  )
}
