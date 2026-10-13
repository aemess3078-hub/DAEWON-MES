"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Download, Paperclip, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  getAttachments,
  getAttachmentDownloadUrl,
  deleteAttachment,
  getAttachmentPermissionFlags,
  type AttachmentRow,
  type AttachmentEntityType,
} from "@/lib/actions/attachment.actions"
import { ALLOWED_ATTACHMENT_EXTENSIONS, MAX_ATTACHMENT_FILE_SIZE_BYTES, formatFileSize } from "@/lib/actions/attachment.helpers"
import type { ResourcePermissionFlags } from "@/lib/auth/role-permissions"

const ACCEPT = ALLOWED_ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(",")

interface AttachmentSectionProps {
  entityType: AttachmentEntityType
  entityId: string
}

export function AttachmentSection({ entityType, entityId }: AttachmentSectionProps) {
  const [permissions, setPermissions] = useState<ResourcePermissionFlags | null>(null)
  const [rows, setRows] = useState<AttachmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [description, setDescription] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const flags = await getAttachmentPermissionFlags(entityType)
      setPermissions(flags)
      if (!flags.canRead) {
        setRows([])
        return
      }
      const data = await getAttachments({ entityType, entityId })
      setRows(data)
    } finally {
      setLoading(false)
    }
  }, [entityType, entityId])

  useEffect(() => {
    refresh()
  }, [refresh])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setError(null)
    setPendingFile(f)
  }

  async function handleUpload() {
    if (!pendingFile || !permissions?.canCreate) return
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append("file", pendingFile)
      fd.append("entityType", entityType)
      fd.append("entityId", entityId)
      if (description.trim()) fd.append("description", description.trim())

      const res = await fetch("/api/upload/attachment", { method: "POST", body: fd })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        throw new Error(json.error ?? "파일 업로드에 실패했습니다.")
      }
      setPendingFile(null)
      setDescription("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "파일 업로드 중 오류가 발생했습니다.")
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload(row: AttachmentRow) {
    try {
      const { url } = await getAttachmentDownloadUrl(row.id)
      window.open(url, "_blank", "noopener,noreferrer")
    } catch (e) {
      alert(e instanceof Error ? e.message : "다운로드 링크 생성에 실패했습니다.")
    }
  }

  async function handleDelete(row: AttachmentRow) {
    if (!permissions?.canDelete) return
    if (!confirm(`'${row.fileName}' 파일을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return
    const res = await deleteAttachment(row.id)
    if (!res.ok) {
      alert(res.error ?? "삭제 중 오류가 발생했습니다.")
      return
    }
    await refresh()
  }

  if (!loading && permissions && !permissions.canRead) return null

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <p className="text-[13px] font-semibold text-muted-foreground flex items-center gap-1.5">
        <Paperclip className="h-3.5 w-3.5" />
        첨부파일 {rows.length > 0 && <span className="text-muted-foreground font-normal">({rows.length}건)</span>}
      </p>

      {loading ? (
        <p className="text-[13px] text-muted-foreground">불러오는 중...</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">등록된 첨부파일이 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 text-[13px] border-b last:border-0 pb-1.5 last:pb-0">
              <div className="min-w-0">
                <p className="truncate font-medium">{r.fileName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {formatFileSize(r.fileSize)} · {r.uploadedByName} · {r.createdAt.slice(0, 10)}
                  {r.description && <span> · {r.description}</span>}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(r)} title="다운로드">
                  <Download className="h-3.5 w-3.5" />
                </Button>
                {permissions?.canDelete && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => handleDelete(r)} title="삭제">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {permissions?.canCreate && (
        <div className="space-y-2 pt-1">
          <input ref={fileInputRef} type="file" accept={ACCEPT} onChange={handleFileChange} className="hidden" id={`attachment-upload-${entityType}-${entityId}`} />
          <label
            htmlFor={`attachment-upload-${entityType}-${entityId}`}
            className={[
              "inline-flex items-center gap-2 cursor-pointer rounded-md border border-dashed px-3 py-1.5 text-[12px] transition-colors",
              pendingFile ? "border-primary/50 bg-primary/5 text-primary" : "border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary",
            ].join(" ")}
          >
            <Upload className="h-3.5 w-3.5" />
            {pendingFile ? pendingFile.name : "파일 선택"}
          </label>
          {pendingFile && (
            <>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="비고 (선택)"
                rows={2}
                className="text-[13px]"
              />
              <Button size="sm" onClick={handleUpload} disabled={uploading}>
                {uploading ? "업로드 중..." : "업로드"}
              </Button>
            </>
          )}
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <p className="text-[11px] text-muted-foreground">
            허용 형식: {ALLOWED_ATTACHMENT_EXTENSIONS.join(", ")} (최대 {formatFileSize(MAX_ATTACHMENT_FILE_SIZE_BYTES)})
          </p>
        </div>
      )}
    </div>
  )
}
