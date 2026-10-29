"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { BarcodePrintDialog } from "@/components/common/barcode/barcode-print-dialog"
import { getLotLabelSource, type LotLabelSourceResult } from "@/lib/actions/lot-label-reprint.actions"
import { checkLotLabelPrintable } from "@/lib/actions/lot-label.actions"
import { buildReprintContext, buildReprintLabelItem, describeReceipt } from "@/lib/label/lot-label-reprint"
import { toUserErrorMessage } from "@/lib/errors/user-error"

/** 입고 건을 고르지 않고 LOT 식별 정보(QR·LOT 번호·품목)만 출력하는 선택값. */
const NO_RECEIPT = "__NO_RECEIPT__"

type LoadedSource = Extract<LotLabelSourceResult, { ok: true }>
type Phase = "loading" | "error" | "select" | "preview"

interface LotLabelReprintDialogProps {
  lot: { id: string; lotNo: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * LOT/Serial 관리의 [라벨 출력] — 이미 등록된 LOT 의 라벨을 입고 처리 없이 다시 출력한다.
 *
 * 흐름: LOT 와 입고 이력을 서버에서 읽어(getLotLabelSource, 읽기 전용) → 입고 이력이 정확히 1건이면 바로 기존 라벨 미리보기(BarcodePrintDialog),
 *       0건 또는 여러 건이면 라벨 근거를 먼저 고르게 한다. 최초/재출력 판정·사유·감사 기록·인쇄 페이지는 기존 BarcodePrintDialog 가
 *       checkLotLabelPrintable / recordLotLabelPrint 로 한다(이 컴포넌트는 재고·입고·수불·LOT 상태를 바꾸지 않는다).
 */
export function LotLabelReprintDialog({ lot, open, onOpenChange }: LotLabelReprintDialogProps) {
  const [phase, setPhase] = useState<Phase>("loading")
  const [error, setError] = useState("")
  const [source, setSource] = useState<LoadedSource | null>(null)
  const [reprint, setReprint] = useState(false)
  const [selectedKey, setSelectedKey] = useState("")

  const lotId = lot?.id ?? null
  const lotNo = lot?.lotNo ?? null

  useEffect(() => {
    if (!open || !lotId || !lotNo) return
    let cancelled = false
    setPhase("loading")
    setError("")
    setSource(null)
    setSelectedKey("")
    Promise.all([getLotLabelSource({ lotId }), checkLotLabelPrintable({ lotNos: [lotNo] })])
      .then(([loaded, check]) => {
        if (cancelled) return
        if (!loaded.ok) {
          setError(loaded.message)
          setPhase("error")
          return
        }
        if (!check.ok) {
          setError(check.message)
          setPhase("error")
          return
        }
        setSource(loaded)
        setReprint(check.reprintLotNos.length > 0)
        if (loaded.receipts.length === 1) {
          setSelectedKey(loaded.receipts[0].key)
          setPhase("preview")
        } else {
          setPhase("select")
        }
      })
      .catch((e) => {
        if (cancelled) return
        console.error("LOT 라벨 정보 조회 실패:", e)
        setError(toUserErrorMessage(e, { fallback: "LOT 라벨 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }))
        setPhase("error")
      })
    return () => {
      cancelled = true
    }
  }, [open, lotId, lotNo])

  const receipt = useMemo(() => source?.receipts.find((r) => r.key === selectedKey) ?? null, [source, selectedKey])
  const labelLot = useMemo(
    () => (source ? { lotNo: source.lot.lotNo, itemCode: source.lot.itemCode, itemName: source.lot.itemName, itemType: source.lot.itemType, uom: source.lot.uom, spec: source.lot.spec } : null),
    [source],
  )
  const labelItem = labelLot ? buildReprintLabelItem(labelLot, receipt) : null
  const receiptCount = source?.receipts.length ?? 0
  const canPreview = receiptCount === 0 || selectedKey !== ""

  return (
    <>
      <Dialog open={open && phase !== "preview"} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-[18px]">라벨 출력{lotNo ? ` — ${lotNo}` : ""}</DialogTitle>
          </DialogHeader>

          {phase === "loading" && <p className="py-4 text-[14px] text-muted-foreground">LOT 정보를 불러오는 중입니다…</p>}

          {phase === "error" && (
            <p className="rounded-md bg-amber-50 p-3 text-[14px] text-amber-900" role="alert" data-testid="lot-label-error">
              {error}
            </p>
          )}

          {phase === "select" && source && (
            <div className="space-y-3" data-testid="lot-label-select">
              <p className="text-[14px]">
                [{source.lot.itemCode}] {source.lot.itemName}
              </p>
              {reprint && (
                <p className="rounded-md bg-blue-50 p-3 text-[14px] text-blue-900">
                  이미 라벨 출력 요청 이력이 있는 LOT 입니다. 다음 단계에서 재출력 사유를 입력해야 합니다.
                </p>
              )}
              {receiptCount === 0 ? (
                <p className="rounded-md bg-amber-50 p-3 text-[14px] text-amber-900" data-testid="lot-label-no-receipt">
                  이 LOT 에는 입고 이력이 없어 수량·일자를 표시할 수 없습니다. LOT 번호·QR·품목 정보만 라벨에 표시합니다.
                </p>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="text-[14px] font-medium">라벨에 표시할 입고 건을 선택해 주세요 (입고 이력 {receiptCount}건)</legend>
                  {source.receipts.map((r) => (
                    <label key={r.key} className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-[14px] has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                      <input type="radio" name="lot-label-receipt" value={r.key} checked={selectedKey === r.key} onChange={() => setSelectedKey(r.key)} data-testid="lot-label-receipt-option" />
                      <span>{describeReceipt(r, source.lot.uom)}</span>
                    </label>
                  ))}
                  <label className="flex cursor-pointer items-center gap-2 rounded-md border p-3 text-[14px] has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50">
                    <input type="radio" name="lot-label-receipt" value={NO_RECEIPT} checked={selectedKey === NO_RECEIPT} onChange={() => setSelectedKey(NO_RECEIPT)} data-testid="lot-label-receipt-none" />
                    <span>수량·일자 없이 LOT 식별 정보만 표시</span>
                  </label>
                </fieldset>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              닫기
            </Button>
            {phase === "select" && (
              <Button onClick={() => setPhase("preview")} disabled={!canPreview} data-testid="lot-label-open-preview">
                라벨 미리보기
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {phase === "preview" && source && labelItem && (
        <BarcodePrintDialog
          open={open}
          onOpenChange={onOpenChange}
          title={`LOT 라벨 — ${source.lot.lotNo}`}
          reprint={reprint}
          context={buildReprintContext(source.lot, receipt)}
          items={[labelItem]}
        />
      )}
    </>
  )
}
