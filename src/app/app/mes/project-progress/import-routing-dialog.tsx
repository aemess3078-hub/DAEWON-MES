"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  getProjectStageRoutingOptions,
  importProjectStagesFromRouting,
} from "@/lib/actions/project-stage.actions"

type RoutingOption = Awaited<ReturnType<typeof getProjectStageRoutingOptions>>[number]

interface ImportRoutingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectOrderId: string
  hasExistingStages: boolean
  onSuccess: () => void
}

export function ImportRoutingDialog({
  open,
  onOpenChange,
  projectOrderId,
  hasExistingStages,
  onSuccess,
}: ImportRoutingDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [options, setOptions] = useState<RoutingOption[]>([])
  const [routingId, setRoutingId] = useState("")

  useEffect(() => {
    if (!open) return
    setIsLoading(true)
    getProjectStageRoutingOptions(projectOrderId)
      .then((rows) => {
        setOptions(rows)
        const preferred = rows.find((r) => r.isDefault) ?? rows[0]
        setRoutingId(preferred?.id ?? "")
      })
      .catch((e) => alert(e instanceof Error ? e.message : "라우팅 목록을 불러오지 못했습니다."))
      .finally(() => setIsLoading(false))
  }, [open, projectOrderId])

  const selected = useMemo(() => options.find((r) => r.id === routingId) ?? null, [options, routingId])

  const handleClose = () => {
    onOpenChange(false)
  }

  const handleSubmit = async () => {
    if (!routingId) {
      alert("가져올 라우팅을 선택하세요.")
      return
    }
    setIsPending(true)
    try {
      const result = await importProjectStagesFromRouting(projectOrderId, routingId)
      if (!result.ok) {
        alert(result.error ?? "가져오기 중 오류가 발생했습니다.")
        return
      }
      onSuccess()
      handleClose()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[18px]">공정 라우팅에서 가져오기</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {hasExistingStages ? (
            <p className="text-[14px] text-muted-foreground">
              기존 단계가 존재합니다. 라우팅 가져오기는 단계가 없을 때만 가능합니다.
            </p>
          ) : isLoading ? (
            <p className="text-[14px] text-muted-foreground">라우팅 목록을 불러오는 중...</p>
          ) : options.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">
              이 품목에 연결된 사용 가능한(ACTIVE) 라우팅이 없습니다.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label className="text-[14px]">라우팅 선택</Label>
                <Select value={routingId} onValueChange={setRoutingId}>
                  <SelectTrigger className="text-[14px]">
                    <SelectValue placeholder="라우팅을 선택하세요" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((r) => (
                      <SelectItem key={r.id} value={r.id} className="text-[14px]">
                        [{r.code}] {r.name} (v{r.version}){r.isDefault ? " · 기본" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selected && (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-12">순서</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">공정명</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">작업장</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.operations.map((op) => (
                        <tr key={op.id} className="border-b last:border-b-0">
                          <td className="px-3 py-2 text-muted-foreground">{op.seq}</td>
                          <td className="px-3 py-2">{op.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{op.workCenter?.name ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {selected.operations.length === 0 && (
                    <p className="px-3 py-4 text-center text-muted-foreground">등록된 공정이 없습니다.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || isLoading || hasExistingStages || !routingId}
          >
            {isPending ? "가져오는 중..." : "가져오기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
