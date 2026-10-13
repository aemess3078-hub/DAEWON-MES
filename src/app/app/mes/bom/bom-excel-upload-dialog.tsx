"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  importValidatedBoms,
  validateBomExcelRows,
  type BomRowError,
  type RawBomExcelRow,
  type ValidatedBomGroup,
} from "@/lib/actions/bom-excel.actions"
import { downloadBomTemplate } from "./bom-excel-download"

async function parseExcelFile(file: File): Promise<RawBomExcelRow[] | string> {
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
  const allRows = XLSX.utils.sheet_to_json<RawBomExcelRow>(ws, { defval: "", range: 1 })
  if (allRows.length === 0) return "데이터 행이 없습니다. 양식에 실제 데이터를 입력하세요."

  const dataRows = allRows.filter((row) => {
    const code = String(row["완제품코드 *"] ?? row["완제품코드"] ?? "").trim()
    return code !== "" && !code.startsWith("예:")
  })
  if (dataRows.length === 0) return "유효한 데이터 행이 없습니다."

  return dataRows.map((row) => {
    const normalized: RawBomExcelRow = {}
    for (const [key, value] of Object.entries(row)) {
      normalized[key.replace(/\s*\*\s*/g, "").trim()] = value
    }
    return normalized
  })
}

interface BomExcelUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = "select" | "preview" | "done"

const statusLabels: Record<string, string> = {
  ACTIVE: "활성",
  INACTIVE: "비활성",
  DRAFT: "초안",
}

export function BomExcelUploadDialog({ open, onOpenChange }: BomExcelUploadDialogProps) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>("select")
  const [fileName, setFileName] = useState("")
  const [parseError, setParseError] = useState("")
  const [errors, setErrors] = useState<BomRowError[]>([])
  const [validGroups, setValidGroups] = useState<ValidatedBomGroup[]>([])
  const [totalRows, setTotalRows] = useState(0)
  const [importMsg, setImportMsg] = useState("")
  const [isPending, startTransition] = useTransition()

  function reset() {
    setStep("select")
    setFileName("")
    setParseError("")
    setErrors([])
    setValidGroups([])
    setTotalRows(0)
    setImportMsg("")
    if (fileRef.current) fileRef.current.value = ""
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError("")
    setImportMsg("")

    const parsed = await parseExcelFile(file)
    if (typeof parsed === "string") {
      setParseError(parsed)
      return
    }

    startTransition(async () => {
      const result = await validateBomExcelRows(parsed)
      setValidGroups(result.validGroups)
      setErrors(result.errors)
      setTotalRows(result.totalRows)
      setStep("preview")
    })
  }

  function handleImport() {
    startTransition(async () => {
      const result = await importValidatedBoms(validGroups)
      if (result.success) {
        setImportMsg(`BOM ${result.importedBomCount}개 (자재 ${result.importedItemCount}행)를 등록했습니다.`)
        setStep("done")
        router.refresh()
      } else {
        setImportMsg(result.error)
      }
    })
  }

  function handleClose() {
    reset()
    onOpenChange(false)
  }

  const hasErrors = errors.length > 0
  const canImport = !hasErrors && validGroups.length > 0
  const errorRowCount = new Set(errors.map((e) => e.rowNum)).size
  const totalItemCount = validGroups.reduce((sum, g) => sum + g.items.length, 0)

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>BOM 엑셀 업로드</DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed bg-muted/20 p-4">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-8 w-8 shrink-0 text-emerald-600" />
                <div>
                  <p className="text-[14px] font-medium">업로드 양식으로 BOM을 일괄 등록합니다.</p>
                  <p className="text-[13px] text-muted-foreground">같은 완제품코드 + 버전의 행들이 하나의 BOM을 구성합니다.</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={downloadBomTemplate} className="shrink-0 gap-2">
                <Download className="h-4 w-4" />
                양식 다운로드
              </Button>
            </div>

            <div>
              <p className="mb-2 text-[14px] font-medium">업로드 파일 선택</p>
              <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed p-4 transition-colors hover:bg-muted/10">
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
              {isPending && <p className="mt-2 text-[13px] text-muted-foreground">검증 중입니다...</p>}
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-[13px] text-muted-foreground">전체 행</p>
                <p className="text-[22px] font-bold">{totalRows}</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                <p className="text-[13px] text-emerald-700">정상 BOM</p>
                <p className="text-[22px] font-bold text-emerald-700">{validGroups.length}</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                <p className="text-[13px] text-emerald-700">정상 자재 행</p>
                <p className="text-[22px] font-bold text-emerald-700">{totalItemCount}</p>
              </div>
              <div className={`rounded-lg border p-3 text-center ${hasErrors ? "border-destructive/40 bg-red-50" : ""}`}>
                <p className={`text-[13px] ${hasErrors ? "text-destructive" : "text-muted-foreground"}`}>오류 행</p>
                <p className={`text-[22px] font-bold ${hasErrors ? "text-destructive" : ""}`}>{errorRowCount}</p>
              </div>
            </div>

            {hasErrors && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[14px] font-medium text-destructive">
                  <AlertCircle className="h-4 w-4" />
                  오류 목록 ({errors.length}건)
                </p>
                <ScrollArea className="h-[180px] rounded-lg border border-destructive/30 bg-red-50/50">
                  <div className="space-y-1.5 p-3">
                    {errors.map((error, index) => (
                      <div key={`${error.rowNum}-${error.column}-${index}`} className="flex items-start gap-2 text-[13px]">
                        <Badge variant="outline" className="shrink-0 border-destructive/40 bg-white text-[11px] text-destructive">
                          {error.rowNum === 0 ? "파일" : `${error.rowNum}행`}
                        </Badge>
                        <span className="font-medium text-muted-foreground">{error.column}:</span>
                        <span className="text-destructive">{error.message}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  오류를 수정한 뒤 파일을 다시 선택하세요. 오류가 1건이라도 있으면 DB에 저장하지 않습니다.
                </p>
              </div>
            )}

            {validGroups.length > 0 && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[14px] font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  등록 예정 BOM (최대 5건 미리보기)
                </p>
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">완제품코드</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">BOM명</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">버전</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">자재 수</th>
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">사용</th>
                      </tr>
                    </thead>
                    <tbody>
                      {validGroups.slice(0, 5).map((group) => (
                        <tr key={group.key} className="border-b last:border-0">
                          <td className="px-3 py-2 font-mono">{group.parentCode}</td>
                          <td className="px-3 py-2">{group.bomName}</td>
                          <td className="px-3 py-2">{group.version}</td>
                          <td className="px-3 py-2">{group.items.length}개</td>
                          <td className="px-3 py-2">{statusLabels[group.status] ?? group.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {validGroups.length > 5 && (
                    <p className="bg-muted/10 px-3 py-2 text-[13px] text-muted-foreground">
                      외 {validGroups.length - 5}개 BOM 더 있음
                    </p>
                  )}
                </div>
              </div>
            )}

            {importMsg && (
              <p className="flex items-center gap-1.5 text-[13px] text-destructive">
                <AlertCircle className="h-4 w-4" />
                {importMsg}
              </p>
            )}
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <p className="text-[16px] font-medium">{importMsg}</p>
            <p className="text-[13px] text-muted-foreground">BOM 목록을 새로고침했습니다.</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "select" && <Button variant="outline" onClick={handleClose}>취소</Button>}
          {step === "preview" && (
            <>
              <Button variant="outline" onClick={reset} className="gap-1.5">
                <X className="h-4 w-4" />
                다시 선택
              </Button>
              <Button onClick={handleImport} disabled={!canImport || isPending} className="gap-1.5">
                <Upload className="h-4 w-4" />
                {isPending ? "등록 중..." : `BOM ${validGroups.length}개 등록`}
              </Button>
            </>
          )}
          {step === "done" && <Button onClick={handleClose}>닫기</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
