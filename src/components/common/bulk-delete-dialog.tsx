"use client"

import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type BulkDeleteCandidate = {
  id: string
  code: string
  name: string
  canDelete: boolean
  reasons: string[]
}

interface BulkDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 예: "품목", "거래처" — 화면 문구에 그대로 노출된다. */
  entityLabel: string
  /** 서버에서 참조 확인 결과를 조회하는 중인지 여부 */
  loading: boolean
  candidates: BulkDeleteCandidate[]
  /** 삭제 실행 중인지 여부 */
  confirming: boolean
  onConfirm: () => void
}

/**
 * 기준정보 선택 일괄삭제 확인 다이얼로그.
 * 품목/거래처/고객사/라우팅 등 여러 메뉴에서 candidates만 바꿔 공용으로 사용한다.
 */
export function BulkDeleteDialog({
  open,
  onOpenChange,
  entityLabel,
  loading,
  candidates,
  confirming,
  onConfirm,
}: BulkDeleteDialogProps) {
  const total = candidates.length
  const deletable = candidates.filter((c) => c.canDelete)
  const blocked = candidates.filter((c) => !c.canDelete)
  const allBlocked = total > 0 && deletable.length === 0

  return (
    <Dialog open={open} onOpenChange={(next) => !confirming && onOpenChange(next)}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>선택 {entityLabel} 삭제</DialogTitle>
          <DialogDescription>
            {loading
              ? "사용 이력을 확인하는 중입니다..."
              : `선택한 ${total}개 ${entityLabel} 중 ${deletable.length}개는 삭제 가능하며, ${blocked.length}개는 삭제할 수 없습니다.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {allBlocked && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>선택한 항목은 모두 사용 이력이 있어 삭제할 수 없습니다.</span>
              </div>
            )}

            {blocked.length > 0 && (
              <div className="space-y-2">
                <p className="text-[13px] font-medium text-muted-foreground">
                  삭제 불가 항목 ({blocked.length}개)
                </p>
                <div className="max-h-[240px] overflow-y-auto rounded-md border divide-y">
                  {blocked.map((item) => (
                    <div key={item.id} className="px-3 py-2 text-[13px]">
                      <div className="font-medium">
                        <span className="font-mono text-muted-foreground">[{item.code}]</span> {item.name}
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        {item.reasons.join(", ")}에서 사용 중
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={confirming}>
            취소
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading || confirming || deletable.length === 0}
            className="gap-1.5"
          >
            {confirming && <Loader2 className="h-4 w-4 animate-spin" />}
            삭제 실행 ({deletable.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
