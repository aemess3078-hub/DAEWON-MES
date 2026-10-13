"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getErrorMessage } from "@/lib/utils"

export default function MesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const message = getErrorMessage(error)
  const isForbidden = message === "권한이 없습니다."

  useEffect(() => {
    console.error("[MES Error]", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
      <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-destructive" />
      </div>

      <div className="space-y-2">
        <h2 className="text-[20px] font-semibold text-foreground">
          {isForbidden ? "권한이 없습니다" : "페이지를 불러오는 중 오류가 발생했습니다"}
        </h2>
        <p className="text-[14px] text-muted-foreground max-w-md">
          {isForbidden
            ? "현재 계정으로는 이 화면에 접근할 수 없습니다."
            : "서버에서 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요."}
        </p>
        {error.digest && (
          <p className="text-[12px] text-muted-foreground/50 font-mono">
            오류 코드: {error.digest}
          </p>
        )}
      </div>

      <Button onClick={reset} variant="outline" className="gap-2">
        <RefreshCw className="w-4 h-4" />
        다시 시도
      </Button>
    </div>
  )
}
