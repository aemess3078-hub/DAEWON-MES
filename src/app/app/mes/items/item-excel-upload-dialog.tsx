"use client"

import { useState, useRef, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Upload, Download, AlertCircle, CheckCircle2, FileSpreadsheet, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  validateItemExcelRows,
  importValidatedItems,
  type RawExcelRow,
  type ValidatedItemRow,
  type ItemRowError,
} from "@/lib/actions/item-excel.actions"
import downloadItemTemplate from "./item-excel-download"

// ─── 엑셀 파일 파싱 ────────────────────────────────────────────────────────────

async function parseExcelFile(file: File): Promise<RawExcelRow[] | string> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return ".xlsx 파일만 업로드할 수 있습니다."
  }
  if (file.size > 5 * 1024 * 1024) {
    return "파일 크기는 5MB 이하만 허용됩니다."
  }

  const XLSX = await import("xlsx")
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: "array" })

  const sheetName = wb.SheetNames[0]
  if (!sheetName) return "엑셀 파일에 시트가 없습니다."

  const ws = wb.Sheets[sheetName]
  // 2번째 행이 헤더 (1번째는 안내 행)
  const allRows = XLSX.utils.sheet_to_json<RawExcelRow>(ws, { defval: "", range: 1 })

  // 헤더가 없거나 빈 파일
  if (allRows.length === 0) return "데이터 행이 없습니다. 예시 행을 삭제하고 실제 데이터를 입력하세요."

  // 예시 행(안내 문구가 있는 행) 제거 — 품목코드가 "※"로 시작하는 행 제외
  const dataRows = allRows.filter((r) => {
    const code = String(r["품목코드 *"] ?? r["품목코드"] ?? "").trim()
    return code !== "" && !code.startsWith("※")
  })

  if (dataRows.length === 0) return "유효한 데이터 행이 없습니다."

  // 헤더명 정규화 (* 제거)
  return dataRows.map((r) => {
    const normalized: RawExcelRow = {}
    for (const [k, v] of Object.entries(r)) {
      normalized[k.replace(/\s*\*\s*/g, "").trim()] = v
    }
    return normalized
  })
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

interface ItemExcelUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = "select" | "preview" | "done"

export function ItemExcelUploadDialog({ open, onOpenChange }: ItemExcelUploadDialogProps) {
  const router   = useRouter()
  const fileRef  = useRef<HTMLInputElement>(null)

  const [step,       setStep]       = useState<Step>("select")
  const [fileName,   setFileName]   = useState("")
  const [parseError, setParseError] = useState("")
  const [errors,     setErrors]     = useState<ItemRowError[]>([])
  const [validRows,  setValidRows]  = useState<ValidatedItemRow[]>([])
  const [totalRows,  setTotalRows]  = useState(0)
  const [importMsg,  setImportMsg]  = useState("")
  const [isPending,  startTransition] = useTransition()

  function reset() {
    setStep("select")
    setFileName("")
    setParseError("")
    setErrors([])
    setValidRows([])
    setTotalRows(0)
    setImportMsg("")
    if (fileRef.current) fileRef.current.value = ""
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError("")

    const result = await parseExcelFile(file)
    if (typeof result === "string") {
      setParseError(result)
      return
    }

    startTransition(async () => {
      const res = await validateItemExcelRows(result)
      setValidRows(res.validRows)
      setErrors(res.errors)
      setTotalRows(res.totalRows)
      setStep("preview")
    })
  }

  async function handleImport() {
    startTransition(async () => {
      const res = await importValidatedItems(validRows)
      if (res.success) {
        setImportMsg(`${res.importedCount}개 품목이 등록되었습니다.`)
        setStep("done")
        router.refresh()
      } else {
        setImportMsg(res.error)
      }
    })
  }

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  const hasErrors   = errors.length > 0
  const canImport   = !hasErrors && validRows.length > 0

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">품목 엑셀 업로드</DialogTitle>
        </DialogHeader>

        {/* ── 단계: 파일 선택 ── */}
        {step === "select" && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg border border-dashed p-4 bg-muted/20">
              <div className="flex items-center gap-3 text-[14px] text-muted-foreground">
                <FileSpreadsheet className="h-8 w-8 text-emerald-600" />
                <div>
                  <p className="font-medium text-foreground">엑셀 양식을 먼저 다운로드하세요</p>
                  <p className="text-[13px]">양식에 데이터를 입력한 후 업로드합니다.</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={downloadItemTemplate} className="gap-2 shrink-0">
                <Download className="h-4 w-4" />
                양식 다운로드
              </Button>
            </div>

            <div>
              <p className="text-[14px] font-medium mb-2">업로드 파일 선택</p>
              <label className="flex items-center gap-3 rounded-lg border border-dashed p-4 cursor-pointer hover:bg-muted/10 transition-colors">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span className="text-[14px] text-muted-foreground">
                  {fileName || ".xlsx 파일을 선택하세요"}
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={isPending}
                />
              </label>
              {parseError && (
                <p className="mt-2 flex items-center gap-1.5 text-[13px] text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {parseError}
                </p>
              )}
              {isPending && (
                <p className="mt-2 text-[13px] text-muted-foreground">검증 중…</p>
              )}
            </div>
          </div>
        )}

        {/* ── 단계: 검증 결과 Preview ── */}
        {step === "preview" && (
          <div className="space-y-4 py-2">
            {/* 요약 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-[13px] text-muted-foreground">전체 행</p>
                <p className="text-[22px] font-bold">{totalRows}</p>
              </div>
              <div className="rounded-lg border p-3 text-center border-emerald-200 bg-emerald-50">
                <p className="text-[13px] text-emerald-700">정상 행</p>
                <p className="text-[22px] font-bold text-emerald-700">{validRows.length}</p>
              </div>
              <div className={`rounded-lg border p-3 text-center ${hasErrors ? "border-destructive/40 bg-red-50" : "border-slate-200"}`}>
                <p className={`text-[13px] ${hasErrors ? "text-destructive" : "text-muted-foreground"}`}>오류 행</p>
                <p className={`text-[22px] font-bold ${hasErrors ? "text-destructive" : ""}`}>{errors.length > 0 ? Array.from(new Set(errors.map((e) => e.rowNum))).length : 0}</p>
              </div>
            </div>

            {/* 오류 목록 */}
            {hasErrors && (
              <div>
                <p className="text-[14px] font-medium text-destructive mb-2 flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4" />
                  오류 목록 ({errors.length}건)
                </p>
                <ScrollArea className="h-[180px] rounded-lg border border-destructive/30 bg-red-50/50">
                  <div className="p-3 space-y-1.5">
                    {errors.map((e, i) => (
                      <div key={i} className="flex items-start gap-2 text-[13px]">
                        <Badge variant="outline" className="shrink-0 text-[11px] bg-white border-destructive/40 text-destructive">
                          {e.rowNum === 0 ? "파일" : `${e.rowNum}행`}
                        </Badge>
                        <span className="font-medium text-muted-foreground">{e.column}:</span>
                        <span className="text-destructive">{e.message}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  오류를 수정한 후 파일을 다시 업로드하세요. 오류가 있으면 전체 등록이 불가합니다.
                </p>
              </div>
            )}

            {/* 정상 데이터 목록 미리보기 */}
            {validRows.length > 0 && (
              <div>
                <p className="text-[14px] font-medium mb-2 flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  등록 예정 품목 (최대 10건 미리보기)
                </p>
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">행</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">품목코드</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">품목명</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">단위</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">LOT</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validRows.slice(0, 10).map((r) => (
                        <tr key={r.rowNum} className="border-b last:border-0">
                          <td className="px-3 py-2 text-muted-foreground">{r.rowNum}</td>
                          <td className="px-3 py-2 font-mono">{r.code}</td>
                          <td className="px-3 py-2">{r.name}</td>
                          <td className="px-3 py-2">{r.uom}</td>
                          <td className="px-3 py-2">{r.isLotTracked ? "Y" : "N"}</td>
                          <td className="px-3 py-2">{r.status === "ACTIVE" ? "활성" : "비활성"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {validRows.length > 10 && (
                    <p className="px-3 py-2 text-[12px] text-muted-foreground bg-muted/10">
                      외 {validRows.length - 10}건 더 있음
                    </p>
                  )}
                </div>
              </div>
            )}

            {importMsg && (
              <p className="text-[13px] text-destructive flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4" />
                {importMsg}
              </p>
            )}
          </div>
        )}

        {/* ── 단계: 등록 완료 ── */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <p className="text-[16px] font-medium">{importMsg}</p>
            <p className="text-[13px] text-muted-foreground">품목 목록이 갱신되었습니다.</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "select" && (
            <Button variant="outline" onClick={handleClose}>
              취소
            </Button>
          )}

          {step === "preview" && (
            <>
              <Button variant="outline" onClick={reset} className="gap-1.5">
                <X className="h-4 w-4" />
                다시 선택
              </Button>
              <Button
                onClick={handleImport}
                disabled={!canImport || isPending}
                className="gap-1.5"
              >
                <Upload className="h-4 w-4" />
                {isPending ? "등록 중…" : `${validRows.length}개 품목 등록`}
              </Button>
            </>
          )}

          {step === "done" && (
            <Button onClick={handleClose}>
              닫기
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
