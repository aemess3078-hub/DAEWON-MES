"use client"

import { useState } from "react"
import { Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BarcodePrintDialog } from "@/components/common/barcode/barcode-print-dialog"
import { getWipLabelTarget, type WipLabelTarget } from "@/lib/actions/wip-label.actions"
import { toUserErrorMessage } from "@/lib/errors/user-error"

interface WipLabelButtonProps {
  workOrderId: string
  orderNo: string
}

/**
 * 공정·재공(WIP) 라벨 인쇄 버튼 (자재출고 화면, 출고가 완료된 작업지시 행).
 *
 *  - 라벨 데이터(WIP 식별값/품목/제조번호/작업지시번호)는 버튼을 누른 시점에 서버(getWipLabelTarget)가 DB 에서 조회한다.
 *    자재출고가 만든 실제 WipUnit(= 기존 WipUnit.id)만 대상이며 이 화면에서 WIP 을 만들거나 채번하지 않는다.
 *  - 출력은 사용자가 라벨 창의 [인쇄]를 눌러야 시작된다. 최초/재요청 판정·사유·동시성 방지는 BarcodePrintDialog 가
 *    서버(checkWipLabelPrintable / recordWipLabelPrint)로 처리한다. 기록되는 이력은 "인쇄 요청"이며 출력 완료가 아니다.
 *  - 자재출고 처리 로직과 무관하다(읽기 전용 조회 + 라벨 창).
 */
export function WipLabelButton({ workOrderId, orderNo }: WipLabelButtonProps) {
  const [loading, setLoading] = useState(false)
  const [target, setTarget] = useState<WipLabelTarget | null>(null)
  const [open, setOpen] = useState(false)

  async function handleClick() {
    if (loading) return
    setLoading(true)
    try {
      const result = await getWipLabelTarget({ workOrderId })
      if (!result.ok) {
        alert(result.message)
        return
      }
      setTarget(result.target)
      setOpen(true)
    } catch (error) {
      console.error("WIP 라벨 대상 조회 실패:", error)
      alert(toUserErrorMessage(error, { fallback: "WIP 라벨 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[13px]" onClick={() => void handleClick()} disabled={loading}>
        <Tag className="h-3.5 w-3.5" />
        {loading ? "조회 중..." : "WIP 라벨"}
      </Button>
      {target && (
        <BarcodePrintDialog
          open={open}
          onOpenChange={setOpen}
          title={`WIP 라벨 — ${orderNo}`}
          context={`WIP 라벨 ${orderNo}`}
          items={[
            {
              labelType: "WIP",
              wipId: target.wipUnitId,
              itemCode: target.itemCode,
              itemName: target.itemName,
              manufacturingNo: target.manufacturingNo,
              workOrderNo: target.workOrderNo,
              dateLabel: "발행일",
            },
          ]}
        />
      )}
    </>
  )
}
