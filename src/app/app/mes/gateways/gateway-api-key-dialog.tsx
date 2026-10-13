"use client"

import { useState } from "react"
import { Copy, Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface GatewayApiKeyDialogProps {
  open: boolean
  onClose: () => void
  apiKey: string
}

export function GatewayApiKeyDialog({
  open,
  onClose,
  apiKey,
}: GatewayApiKeyDialogProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>게이트웨이 등록 완료</DialogTitle>
          <DialogDescription>
            API Key는 지금만 확인할 수 있습니다. 반드시 복사하여 보관하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
            <p className="text-[13px] text-amber-700 font-medium mb-1">보안 주의</p>
            <p className="text-[13px] text-amber-600">
              이 API Key는 이후 다시 조회할 수 없습니다.
              Edge Gateway 설정 파일에 즉시 저장하세요.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
            <code className="flex-1 text-[13px] font-mono break-all text-foreground">
              {apiKey}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>확인</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
