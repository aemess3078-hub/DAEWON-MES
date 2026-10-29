"use client"

import * as React from "react"
import { AlertCircle, CheckCircle2, FileSpreadsheet, Info, Loader2, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  commitInstrumentImport,
  previewInstrumentImport,
  type ImportCommitResult,
  type ImportPreview,
  type ImportSheetsInput,
} from "@/lib/actions/instrument-calibration.actions"

type Step = "select" | "preview" | "done"

const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_COLUMNS = 40

/** 모든 시트를 "표시 문자열" 행렬로 읽는다(Serial No/성적서번호의 선행 0 보존). */
async function readWorkbook(file: File): Promise<ImportSheetsInput | string> {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith(".xlsx") && !lower.endsWith(".xlsm")) return ".xlsx 또는 .xlsm 파일만 올릴 수 있습니다."
  if (file.size > MAX_FILE_BYTES) return "파일 크기는 8MB 이하만 허용됩니다."

  const XLSX = await import("xlsx")
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" })
  if (workbook.SheetNames.length === 0) return "엑셀 파일에 시트가 없습니다."

  return workbook.SheetNames.map((name) => {
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, raw: false, defval: "" })
    const rows = matrix.slice(0, 2000).map((row) => {
      const cells = row.slice(0, MAX_COLUMNS).map((cell) => (cell == null ? "" : String(cell).slice(0, 500)))
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop()
      return cells
    })
    return { name: name.slice(0, 100), rows }
  })
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-yellow-700" : tone === "good" ? "text-green-700" : ""
  return (
    <div className="rounded-lg border px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`text-[22px] font-semibold ${color}`}>{value.toLocaleString("ko-KR")}</p>
    </div>
  )
}

const ACTION_LABEL = { NEW: "신규", EXISTING: "기존(건너뜀)", DUPLICATE: "중복(건너뜀)", SKIPPED: "제외" } as const

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (result: ImportCommitResult) => void
}

export function ImportDialog({ open, onOpenChange, onImported }: Props) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [step, setStep] = React.useState<Step>("select")
  const [fileName, setFileName] = React.useState("")
  const [sheets, setSheets] = React.useState<ImportSheetsInput | null>(null)
  const [preview, setPreview] = React.useState<ImportPreview | null>(null)
  const [result, setResult] = React.useState<ImportCommitResult | null>(null)
  const [error, setError] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [view, setView] = React.useState<"issues" | "instruments" | "calibrations">("issues")

  function reset() {
    setStep("select")
    setFileName("")
    setSheets(null)
    setPreview(null)
    setResult(null)
    setError("")
    setBusy(false)
    setView("issues")
    if (fileRef.current) fileRef.current.value = ""
  }

  React.useEffect(() => {
    if (!open) reset()
  }, [open])

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError("")
    setFileName(file.name)
    setBusy(true)
    try {
      const parsed = await readWorkbook(file)
      if (typeof parsed === "string") {
        setError(parsed)
        return
      }
      const response = await previewInstrumentImport(parsed)
      if (!response.ok) {
        setError(response.error)
        return
      }
      setSheets(parsed)
      setPreview(response.data)
      setView(response.data.issues.length > 0 ? "issues" : "instruments")
      setStep("preview")
    } catch {
      setError("엑셀 파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.")
    } finally {
      setBusy(false)
    }
  }

  async function handleCommit() {
    if (!sheets) return
    setBusy(true)
    setError("")
    const response = await commitInstrumentImport(sheets)
    setBusy(false)
    if (!response.ok) {
      setError(response.error)
      return
    }
    setResult(response.data)
    setStep("done")
    onImported(response.data)
  }

  const summary = preview?.summary
  const canCommit = Boolean(summary && (summary.instrumentsNew > 0 || summary.calibrationsNew > 0))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-[20px]">계측기 엑셀 이관</DialogTitle>
          <DialogDescription className="text-[14px]">
            &apos;계측기 검교정 계획서&apos; 시트를 계측기 기준정보로 사용하고, 종류별·날짜별 시트는 과거 교정이력으로만 보존합니다.
            이미 등록된 관리번호는 덮어쓰지 않으며, 같은 파일을 다시 올려도 중복 생성되지 않습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 pb-2">
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="break-words">{error}</p>
            </div>
          )}

          {step === "select" && (
            <div className="space-y-3">
              <label
                htmlFor="calibration-import-file"
                className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center hover:bg-muted/30"
              >
                {busy ? <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
                <span className="text-[15px] font-medium">{busy ? "파일을 확인하는 중..." : "엑셀 파일(.xlsx)을 선택하세요"}</span>
                <span className="text-[13px] text-muted-foreground">예: 2025 계측기 검교정 LIST 최종본(최신).xlsx · 저장 전에 미리보기로 확인합니다.</span>
                {fileName && <span className="text-[13px] text-muted-foreground">{fileName}</span>}
              </label>
              <input
                id="calibration-import-file"
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm"
                onChange={handleFile}
                disabled={busy}
                className="sr-only"
              />
              <ul className="space-y-1 text-[13px] text-muted-foreground">
                <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" />교정실시일·적합여부가 엑셀에 없으면 만들어 넣지 않습니다. 교정기관·성적서번호·차기교정일만 &apos;이관 이력&apos;으로 보존합니다.</li>
                <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" />사용불가·폐기·보류 계측기는 사용가능으로 이관하지 않습니다.</li>
                <li className="flex gap-2"><Info className="mt-0.5 h-4 w-4 shrink-0" />Serial No와 성적서번호는 문자열로 읽습니다(엑셀에서 숫자 셀로 저장된 값은 선행 0을 복원할 수 없습니다).</li>
              </ul>
            </div>
          )}

          {step === "preview" && summary && preview && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-[14px] text-muted-foreground">
                <FileSpreadsheet className="h-4 w-4" />
                <span>
                  {fileName} · 시트 {summary.sheetsRead}개 읽음 · 기준 시트 &apos;{summary.masterSheet ?? "없음"}&apos;
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="신규 계측기" value={summary.instrumentsNew} tone="good" />
                <Stat label="기존(덮어쓰지 않음)" value={summary.instrumentsExisting} />
                <Stat label="신규 교정이력" value={summary.calibrationsNew} tone="good" />
                <Stat label="중복 이력(제외)" value={summary.calibrationsDuplicate} />
                <Stat label="오류" value={summary.instrumentErrors} tone={summary.instrumentErrors > 0 ? "bad" : undefined} />
                <Stat label="경고" value={summary.warnings} tone={summary.warnings > 0 ? "warn" : undefined} />
              </div>

              <div className="flex gap-1" role="tablist">
                {(
                  [
                    ["issues", `오류·경고 (${preview.issues.length})`],
                    ["instruments", `계측기 (${preview.instruments.length})`],
                    ["calibrations", `교정이력 (${preview.calibrations.length})`],
                  ] as const
                ).map(([key, label]) => (
                  <Button key={key} type="button" role="tab" aria-selected={view === key} size="sm" variant={view === key ? "default" : "outline"} className="text-[14px]" onClick={() => setView(key)}>
                    {label}
                  </Button>
                ))}
              </div>

              <ScrollArea className="h-[320px] rounded-md border">
                {view === "issues" && (
                  preview.issues.length === 0 ? (
                    <p className="flex items-center gap-2 p-4 text-[14px] text-green-700"><CheckCircle2 className="h-4 w-4" />오류와 경고가 없습니다.</p>
                  ) : (
                    <table className="w-full text-[13px]">
                      <thead className="sticky top-0 bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">구분</th>
                          <th className="px-3 py-2 text-left font-medium">시트</th>
                          <th className="px-3 py-2 text-left font-medium">행</th>
                          <th className="px-3 py-2 text-left font-medium">관리번호</th>
                          <th className="px-3 py-2 text-left font-medium">내용</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.issues.map((issue, index) => (
                          <tr key={index} className="border-t align-top">
                            <td className={`whitespace-nowrap px-3 py-1.5 font-medium ${issue.level === "error" ? "text-red-600" : issue.level === "warning" ? "text-yellow-700" : "text-muted-foreground"}`}>
                              {issue.level === "error" ? "오류" : issue.level === "warning" ? "경고" : "안내"}
                            </td>
                            <td className="px-3 py-1.5">{issue.sheet}</td>
                            <td className="whitespace-nowrap px-3 py-1.5">{issue.rowRef}</td>
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono">{issue.managementNo}</td>
                            <td className="px-3 py-1.5">{issue.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}
                {view === "instruments" && (
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-muted text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">행</th>
                        <th className="px-3 py-2 text-left font-medium">관리번호</th>
                        <th className="px-3 py-2 text-left font-medium">계측기명</th>
                        <th className="px-3 py-2 text-left font-medium">이관 사용상태</th>
                        <th className="px-3 py-2 text-left font-medium">처리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.instruments.map((item) => (
                        <tr key={item.managementNo} className="border-t">
                          <td className="px-3 py-1.5">{item.rowRef}</td>
                          <td className="px-3 py-1.5 font-mono">{item.managementNo}</td>
                          <td className="px-3 py-1.5">{item.name}</td>
                          <td className="px-3 py-1.5">{item.usageStatusLabel}</td>
                          <td className="px-3 py-1.5">
                            {ACTION_LABEL[item.action]}
                            {item.differences.length > 0 && <span className="ml-1 text-muted-foreground">· 엑셀과 다른 항목: {item.differences.join(", ")}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {view === "calibrations" && (
                  <table className="w-full text-[13px]">
                    <thead className="sticky top-0 bg-muted text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">시트</th>
                        <th className="px-3 py-2 text-left font-medium">관리번호</th>
                        <th className="px-3 py-2 text-left font-medium">교정기관</th>
                        <th className="px-3 py-2 text-left font-medium">성적서번호</th>
                        <th className="px-3 py-2 text-left font-medium">차기교정일</th>
                        <th className="px-3 py-2 text-left font-medium">처리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.calibrations.map((item, index) => (
                        <tr key={index} className="border-t">
                          <td className="px-3 py-1.5">{item.sheet}</td>
                          <td className="px-3 py-1.5 font-mono">{item.managementNo}</td>
                          <td className="px-3 py-1.5">{item.agency || "-"}</td>
                          <td className="px-3 py-1.5 font-mono">{item.certificateNo || "-"}</td>
                          <td className="whitespace-nowrap px-3 py-1.5">{item.nextCalibrationDate ?? "-"}</td>
                          <td className="px-3 py-1.5">
                            {ACTION_LABEL[item.action]}
                            {item.reason && <span className="ml-1 text-muted-foreground">· {item.reason}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </ScrollArea>

              {summary.instrumentErrors > 0 && (
                <p className="text-[13px] text-red-700">오류가 있는 행은 이관에서 제외됩니다. 나머지 정상 행만 저장됩니다.</p>
              )}
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-5 text-green-900">
              <p className="flex items-center gap-2 text-[16px] font-semibold"><CheckCircle2 className="h-5 w-5" />이관을 완료했습니다.</p>
              <ul className="space-y-1 text-[14px]">
                <li>신규 계측기 {result.instrumentsCreated.toLocaleString("ko-KR")}대 등록 (기존 {result.instrumentsSkippedExisting.toLocaleString("ko-KR")}대는 변경하지 않음)</li>
                <li>교정이력 {result.calibrationsCreated.toLocaleString("ko-KR")}건 등록 (중복·제외 {result.calibrationsSkipped.toLocaleString("ko-KR")}건)</li>
                {result.errorCount > 0 && <li>오류로 제외된 행 {result.errorCount.toLocaleString("ko-KR")}건</li>}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t px-6 py-4 sm:gap-0">
          {step === "preview" && (
            <>
              <Button type="button" variant="outline" onClick={reset} disabled={busy}>다른 파일 선택</Button>
              <Button type="button" onClick={handleCommit} disabled={busy || !canCommit}>
                {busy ? "이관 중..." : "이관 실행"}
              </Button>
            </>
          )}
          {step !== "preview" && (
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {step === "done" ? "닫기" : "취소"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
