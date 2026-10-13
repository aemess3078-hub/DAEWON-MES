"use client"

import { useState, useEffect, useRef, useTransition } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Upload, X, FileText, ExternalLink } from "lucide-react"
import {
  createWorkStandard,
  updateWorkStandard,
  type WorkStandardRow,
} from "@/lib/actions/work-standards.actions"

const MAX_FILE_SIZE = 20 * 1024 * 1024  // 20 MB
const ALLOWED_TYPE  = "application/pdf"

const DOC_TYPE_OPTIONS = [
  { value: "SOP",         label: "SOP (작업지시서)" },
  { value: "DRAWING",     label: "DRAWING (도면)" },
  { value: "SPEC",        label: "SPEC (규격서)" },
  { value: "CERTIFICATE", label: "CERTIFICATE (인증서)" },
  { value: "OTHER",       label: "OTHER (기타)" },
] as const

interface Props {
  open: boolean
  onClose: () => void
  editRow: WorkStandardRow | null
}

export function WorkStandardsForm({ open, onClose, editRow }: Props) {
  const isEdit = editRow !== null
  const [isPending, startTransition] = useTransition()
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [code,     setCode]     = useState(editRow?.code    ?? "")
  const [name,     setName]     = useState(editRow?.name    ?? "")
  const [docType,  setDocType]  = useState<string>(editRow?.docType ?? "SOP")
  const [fileUrl,  setFileUrl]  = useState(editRow?.fileUrl ?? "")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sheet가 열리거나 editRow가 바뀔 때 폼 초기화
  useEffect(() => {
    if (!open) return
    setCode(editRow?.code    ?? "")
    setName(editRow?.name    ?? "")
    setDocType(editRow?.docType ?? "SOP")
    setFileUrl(editRow?.fileUrl ?? "")
    setSelectedFile(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [open, editRow])

  function handleClose() {
    setError(null)
    onClose()
  }

  // ─── 파일 선택 검증 ────────────────────────────────────────────────
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setError(null)
    if (!f) { setSelectedFile(null); return }

    if (f.type !== ALLOWED_TYPE) {
      setError("PDF 파일(.pdf)만 업로드할 수 있습니다.")
      e.target.value = ""
      return
    }
    if (f.size === 0) {
      setError("빈 파일은 업로드할 수 없습니다.")
      e.target.value = ""
      return
    }
    if (f.size > MAX_FILE_SIZE) {
      setError("파일 크기는 20 MB 이하여야 합니다.")
      e.target.value = ""
      return
    }
    setSelectedFile(f)
  }

  function clearFile() {
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
    setError(null)
  }

  // ─── 제출 ──────────────────────────────────────────────────────────
  async function handleSubmit() {
    setError(null)

    // 필수 입력 검증
    if (!isEdit && !code.trim()) { setError("문서코드를 입력하세요."); return }
    if (!name.trim()) { setError("표준서명을 입력하세요."); return }

    // PDF 파일 업로드 (선택된 경우)
    let resolvedUrl: string | undefined = fileUrl.trim() || undefined
    if (selectedFile) {
      setIsUploading(true)
      try {
        const fd = new FormData()
        fd.append("file", selectedFile)
        const res  = await fetch("/api/upload/work-standard", { method: "POST", body: fd })
        const json = await res.json() as { url?: string; error?: string }
        if (!res.ok || !json.url) {
          throw new Error(json.error ?? "파일 업로드에 실패했습니다.")
        }
        resolvedUrl = json.url
      } catch (e) {
        setError(e instanceof Error ? e.message : "파일 업로드에 실패했습니다.")
        setIsUploading(false)
        return
      }
      setIsUploading(false)
    }

    // Server action
    startTransition(async () => {
      try {
        if (isEdit) {
          await updateWorkStandard(editRow.id, {
            name,
            docType,
            fileUrl: resolvedUrl,
          })
        } else {
          await createWorkStandard({
            code,
            name,
            docType,
            fileUrl: resolvedUrl,
          })
        }
        handleClose()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "오류가 발생했습니다.")
      }
    })
  }

  const busy = isPending || isUploading

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) handleClose() }}>
      <SheetContent className="w-[440px] sm:max-w-[440px] flex flex-col">
        <SheetHeader>
          <SheetTitle>{isEdit ? "표준서 수정" : "표준서 등록"}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-5 py-6 overflow-y-auto">

          {/* 문서코드 (신규 등록만) */}
          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="code" className="text-[14px]">
                문서코드 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="예: WS-001"
                className="text-[14px]"
              />
            </div>
          )}

          {/* 표준서명 */}
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-[14px]">
              표준서명 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="표준서 명칭 입력"
              className="text-[14px]"
            />
          </div>

          {/* 문서유형 */}
          <div className="space-y-1.5">
            <Label htmlFor="docType" className="text-[14px]">
              문서유형 <span className="text-red-500">*</span>
            </Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger id="docType" className="text-[14px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-[14px]">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* PDF 파일 업로드 */}
          <div className="space-y-2">
            <Label className="text-[14px]">PDF 파일 업로드</Label>

            {/* 현재 등록된 파일 링크 (수정 모드 + 새 파일 미선택 상태) */}
            {isEdit && fileUrl && !selectedFile && editRow?.fileHref && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                <FileText className="h-4 w-4 text-red-500 flex-shrink-0" />
                <a
                  href={editRow?.fileHref ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-blue-600 hover:underline truncate flex-1"
                >
                  현재 파일 열기
                </a>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              </div>
            )}

            {/* 파일 선택 영역 */}
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                id="pdf-upload"
                type="file"
                accept="application/pdf,.pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <label
                htmlFor="pdf-upload"
                className={[
                  "inline-flex items-center gap-2 cursor-pointer rounded-md",
                  "border border-dashed px-3 py-2 text-[13px] transition-colors flex-1",
                  selectedFile
                    ? "border-primary/50 bg-primary/5 text-primary"
                    : "border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary",
                ].join(" ")}
              >
                <Upload className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">
                  {selectedFile ? selectedFile.name : "PDF 파일 선택 (최대 20 MB)"}
                </span>
              </label>

              {selectedFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={clearFile}
                  title="파일 선택 취소"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <p className="text-[12px] text-muted-foreground">
              PDF만 허용 · 최대 20 MB · 업로드 파일이 외부 링크보다 우선 적용됩니다.
            </p>
          </div>

          {/* 외부 링크 (보조) */}
          <div className="space-y-1.5">
            <Label htmlFor="fileUrl" className="text-[14px] flex items-center gap-1.5">
              외부 링크
              <span className="text-[12px] font-normal text-muted-foreground">(선택 · PDF 업로드 없을 때 사용)</span>
            </Label>
            <Input
              id="fileUrl"
              value={fileUrl.startsWith("storage://") ? "" : fileUrl}
              onChange={(e) => setFileUrl(e.target.value)}
              placeholder={fileUrl.startsWith("storage://") ? "등록된 PDF 파일이 사용 중입니다" : "https://..."}
              className="text-[14px]"
              disabled={!!selectedFile || fileUrl.startsWith("storage://")}
            />
            {selectedFile && (
              <p className="text-[12px] text-amber-600">
                파일 업로드 시 외부 링크는 무시됩니다.
              </p>
            )}
          </div>

          {/* 에러 메시지 */}
          {error && (
            <p className="text-[13px] text-red-600 bg-red-50 rounded-md px-3 py-2 border border-red-200">
              {error}
            </p>
          )}
        </div>

        <SheetFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={busy} className="flex-1">
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={busy} className="flex-1">
            {isUploading ? "업로드 중..." : isPending ? "저장 중..." : isEdit ? "수정" : "등록"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
