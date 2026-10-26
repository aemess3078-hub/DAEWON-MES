"use client"

import { useEffect, useMemo, useState } from "react"
import { Printer } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { BarcodeLabel } from "./barcode-label"
import { checkLotLabelPrintable, checkTestLotNosUnused, recordLotLabelPrint } from "@/lib/actions/lot-label.actions"
import { formatLabelDate, getLabelBlock, makeTestLotNos, TEST_LABEL_MARK, type LabelData } from "@/lib/label/label-spec"
import type { TestLabelCandidate } from "@/lib/label/label-items"
import { labelPrintUrl, saveLabelJob, LABEL_JOB_PREFIX } from "@/lib/label/label-print-job"
import { toUserErrorMessage } from "@/lib/errors/user-error"

interface BarcodePrintItem {
  itemCode: string
  itemName: string
  lotId?: string
  /** LOT 번호 — 지정하면 LOT QR 라벨(DAEWON|LOT|1|<lotNo>)로 출력되고, 출력 시 서버 영속화 확인 + 감사 기록이 남는다. */
  lotNo?: string | null
  quantity?: number
  uom?: string
  /** 입고일/생산일 문구 선택 */
  dateLabel?: string
}

interface BarcodePrintDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: BarcodePrintItem[]
  title?: string
  /**
   * 실제 "인쇄" 버튼을 눌렀을 때 라벨 인쇄 페이지를 열기 직전에 호출된다(다이얼로그를 여는 시점이 아님).
   * 실패하면 인쇄하지 않고 message를 사용자에게 보여준다.
   * 지정하지 않으면 바로 인쇄한다(예약이 필요 없는 비LOT/수동 LOT 라벨 등).
   */
  onBeforePrint?: () => Promise<{ success: true } | { success: false; message: string }>
  /** 재출력 모드: 사유 입력을 요구하고 라벨에 "재출력"을 표시한다. LOT 번호/QR 은 바뀌지 않는다. */
  reprint?: boolean
  /**
   * 지정하면 미리보기만 가능하고 실제 인쇄는 막는다(예: LOT 가 아직 DB 에 영속화되지 않은 입고 확정 전).
   * 서버(checkLotLabelPrintable/recordLotLabelPrint)도 Lot 행이 없으면 출력을 거부한다 — 이 값은 UI 안내용 1차 게이트다.
   */
  printBlockedReason?: string
  /**
   * true 이면 LOT 번호가 없는 항목을 품목 바코드(CODE128) 라벨로 출력한다(출하/자재출고처럼 LOT QR 대상이 아닌 기존 화면용).
   * 기본값(false)에서는 LOT 번호가 없는 항목에 임의 QR/CODE128 을 만들지 않고 "출력 불가" 사유를 안내한다.
   */
  legacyItemBarcode?: boolean
  /**
   * RECEIPT(기본): 입고/생산 LOT 라벨 — 이미 출력된 LOT 는 재출력 사유를 요구한다.
   * ISSUE: 자재출고 LOT 별 수량 라벨 — 입고 라벨과 별개의 출력이므로 재출력 사유를 요구하지 않고 "출고 라벨" 로 기록한다.
   */
  purpose?: "RECEIPT" | "ISSUE"
  /** 감사 기록에 남길 출력 맥락(예: 출고 작업지시번호). */
  context?: string
  /** 라벨이 되지 못한 항목의 사유(품목 마스터가 LOT 관리가 아님, LOT 미선택 등). 사용자에게 그대로 안내한다. */
  notices?: string[]
  /**
   * 시험용 라벨 후보(현장 출력·QR 스캔 테스트용). 지정하면 [시험용 라벨] 전환 버튼이 나타난다.
   * 시험용 라벨은 임시 LOT 번호(TEST-YYYYMMDD-001)와 "시험용" 표시를 쓰고 LOT 저장·재고·입출고·감사 기록과 무관하다.
   * 실제 LOT 라벨의 영속화 확인/재출력 사유/onBeforePrint 는 시험용 모드에서만 건너뛰며, 실제 라벨 흐름은 바뀌지 않는다.
   */
  testCandidates?: TestLabelCandidate[]
}

/**
 * LOT QR 라벨 출력 다이얼로그 (브라우저 인쇄 — 프린터 제조사 SDK 비종속)
 *
 * 인쇄는 이 화면을 인쇄하지 않는다. 라벨 데이터를 라벨 전용 페이지(/label-print)로 넘겨 새 탭에서 그 페이지만 인쇄한다
 * (MES 메뉴·발주번호·팝업 제목·버튼이 라벨과 함께 출력되던 문제 방지).
 * 브라우저는 실제 용지 출력 성공 여부를 알 수 없다 — 감사 기록은 "출력 요청" 시점이다.
 */
export function BarcodePrintDialog({
  open,
  onOpenChange,
  items,
  title = "라벨 출력",
  onBeforePrint,
  reprint = false,
  printBlockedReason,
  legacyItemBarcode = false,
  purpose = "RECEIPT",
  context,
  notices = [],
  testCandidates,
}: BarcodePrintDialogProps) {
  const [isPrinting, setIsPrinting] = useState(false)
  const [reason, setReason] = useState("")
  const [reprintRequired, setReprintRequired] = useState(false)
  const today = formatLabelDate()
  const [testMode, setTestMode] = useState(false)
  const [testLotNos, setTestLotNos] = useState<string[]>([])
  const candidateCount = testCandidates?.length ?? 0

  // 후보가 바뀌거나 다이얼로그가 닫히면 시험용 모드를 해제한다(실제 라벨이 기본).
  useEffect(() => {
    if (!open) setTestMode(false)
  }, [open])
  useEffect(() => {
    setTestMode(false)
    setTestLotNos([])
  }, [candidateCount])

  function enterTestMode() {
    setTestLotNos(makeTestLotNos(candidateCount))
    setTestMode(true)
  }

  const realLabels = useMemo<LabelData[]>(
    () =>
      items.map((item) => {
        const lotNo = item.lotNo?.trim() || null
        const kind = !lotNo && legacyItemBarcode ? "ITEM_BARCODE" : "LOT_QR"
        return {
          kind,
          itemCode: item.itemCode,
          itemName: item.itemName,
          lotNo,
          lotId: item.lotId ?? null,
          quantity: item.quantity ?? null,
          uom: item.uom ?? null,
          date: today,
          dateLabel: item.dateLabel ?? "일자",
        }
      }),
    [items, legacyItemBarcode, today],
  )
  const testLabels = useMemo<LabelData[]>(
    () =>
      (testCandidates ?? []).map((c, i) => ({
        kind: "LOT_QR" as const,
        test: true,
        itemCode: c.itemCode,
        itemName: c.itemName,
        lotNo: (testLotNos[i] ?? "").trim(),
        quantity: c.quantity,
        uom: c.uom,
        date: today,
        dateLabel: c.dateLabel,
      })),
    [testCandidates, testLotNos, today],
  )
  const labels = testMode ? testLabels : realLabels
  const blockedReasons = useMemo(
    () =>
      labels.flatMap((label) => {
        const block = getLabelBlock(label)
        return block.printable ? [] : [block.reason]
      }),
    [labels],
  )
  const needsReason = !testMode && (reprint || reprintRequired)
  const duplicateTestLot = testMode && new Set(testLabels.map((l) => l.lotNo)).size !== testLabels.length

  // 실제 "인쇄" 버튼을 누른 시점에만 번호를 소모하고 감사 기록을 남긴다(미리보기만 열고 닫으면 아무것도 소모하지 않는다).
  async function handlePrintClick() {
    if (isPrinting || (!testMode && printBlockedReason) || blockedReasons.length > 0 || labels.length === 0) return
    if (duplicateTestLot) {
      alert("시험용 LOT 번호가 중복되었습니다. 라벨마다 다른 번호를 사용해 주세요.")
      return
    }
    if (!testMode && reprint && !reason.trim()) {
      alert("재출력 사유를 입력해 주세요.")
      return
    }

    // 모바일 Chrome 은 await 뒤에 열린 창을 팝업으로 차단할 수 있어, 클릭 직후 동기적으로 빈 탭을 먼저 연다.
    const printWindow = window.open("", "_blank")
    if (!printWindow) {
      alert("팝업이 차단되어 라벨 인쇄 창을 열 수 없습니다. 브라우저의 팝업 허용 후 다시 시도해 주세요.")
      return
    }
    try {
      printWindow.document.title = "라벨 준비 중"
      printWindow.document.body.textContent = "라벨을 준비하는 중입니다…"
    } catch {
      /* 문서 접근이 막혀도 이후 이동은 가능 */
    }

    setIsPrinting(true)
    let jobId: string | null = null
    try {
      const lotNos = labels.filter((l) => l.kind === "LOT_QR" && l.lotNo).map((l) => l.lotNo as string)
      let effectiveReprint = reprint

      // 시험용 라벨: 실제 LOT·재고·감사와 무관. 임시 번호가 실제 LOT 와 겹치지 않는지만 읽기 전용으로 확인하고 바로 인쇄 페이지로 간다.
      if (testMode) {
        const unused = await checkTestLotNosUnused({ lotNos })
        if (!unused.ok) {
          alert(unused.message)
          printWindow.close()
          return
        }
        jobId = saveLabelJob(window.localStorage, labels, false)
        if (!jobId) {
          alert("브라우저 저장소를 사용할 수 없어 라벨 인쇄 페이지를 열 수 없습니다. 사생활 보호 모드를 해제해 주세요.")
          printWindow.close()
          return
        }
        printWindow.location.href = labelPrintUrl(jobId)
        return
      }

      // 1) 읽기 전용 사전 확인 — 출력할 수 없는 상태에서 번호 소모/감사 기록이 생기지 않게 먼저 거른다.
      if (lotNos.length > 0) {
        const check = await checkLotLabelPrintable({ lotNos, purpose })
        if (!check.ok) {
          alert(check.message)
          printWindow.close()
          return
        }
        if (check.reprintLotNos.length > 0) {
          effectiveReprint = true
          if (!reason.trim()) {
            setReprintRequired(true)
            alert("이미 출력된 LOT 입니다. 재출력 사유를 입력한 뒤 다시 눌러 주세요.")
            printWindow.close()
            return
          }
        }
      }

      // 2) 라벨 데이터를 인쇄 페이지로 넘길 job 저장(저장소를 못 쓰면 여기서 중단 — 부작용 전)
      jobId = saveLabelJob(window.localStorage, labels, effectiveReprint)
      if (!jobId) {
        alert("브라우저 저장소를 사용할 수 없어 라벨 인쇄 페이지를 열 수 없습니다. 사생활 보호 모드를 해제해 주세요.")
        printWindow.close()
        return
      }

      // 3) 기존 onBeforePrint (자동채번 예약 인쇄 표시 등)
      if (onBeforePrint) {
        const result = await onBeforePrint()
        if (!result.success) {
          alert(result.message)
          window.localStorage.removeItem(LABEL_JOB_PREFIX + jobId)
          printWindow.close()
          return
        }
      }

      // 4) 감사 기록(최초/재출력은 서버 이력으로 판정)
      if (lotNos.length > 0) {
        const audit = await recordLotLabelPrint({ lotNos, reason: effectiveReprint ? reason.trim() : undefined, purpose, context })
        if (!audit.ok) {
          if (audit.code === "REASON_REQUIRED") setReprintRequired(true)
          alert(audit.message)
          window.localStorage.removeItem(LABEL_JOB_PREFIX + jobId)
          printWindow.close()
          return
        }
      }

      // 5) 라벨 전용 페이지로 이동 — 그 페이지가 QR 렌더링을 확인한 뒤 인쇄한다.
      printWindow.location.href = labelPrintUrl(jobId)
    } catch (error) {
      console.error("라벨 출력 준비 실패:", error)
      if (jobId) {
        try {
          window.localStorage.removeItem(LABEL_JOB_PREFIX + jobId)
        } catch {
          /* ignore */
        }
      }
      printWindow.close()
      alert(toUserErrorMessage(error, { fallback: "라벨 출력을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요." }))
    } finally {
      setIsPrinting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[18px] font-semibold">
            {title}
            {reprint ? " (재출력)" : ""}
          </DialogTitle>
          <p className="text-[13px] text-muted-foreground">
            총 {labels.length}개 라벨 · 29×90mm 라벨(Brother QL-820NWB)에 1장씩 출력됩니다
            {reprint ? " · 재출력해도 LOT 번호와 QR 은 변경되지 않습니다" : ""}
          </p>
        </DialogHeader>

        {testMode && (
          <div className="rounded-md border-2 border-dashed border-gray-900 bg-gray-50 p-3 text-[14px] text-gray-900" data-test-banner>
            <p className="font-semibold">{TEST_LABEL_MARK} 라벨 모드 — 실제 LOT 가 아닙니다</p>
            <p className="mt-1">
              임시 LOT 번호(TEST-…)로 출력 테스트만 합니다. LOT 저장·재고·입출고·출력 이력은 만들어지지 않으며, 이 QR 을 스캔해도 LOT 조회는 되지 않습니다.
              QR 형식은 실제와 같습니다(DAEWON|LOT|1|&lt;LOT번호&gt;).
            </p>
            <div className="mt-2 space-y-2">
              {testLabels.map((label, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-gray-700">
                    [{label.itemCode}] {label.itemName}
                  </span>
                  <Input
                    value={testLotNos[i] ?? ""}
                    onChange={(e) => setTestLotNos((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                    className="h-9 w-56 font-mono text-[14px]"
                    maxLength={105}
                    aria-label={`시험용 LOT 번호 ${i + 1}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {!testMode && printBlockedReason && (
          <p className="rounded-md bg-amber-50 p-3 text-[14px] text-amber-900">{printBlockedReason}</p>
        )}

        {!testMode && notices.length > 0 && (
          <div className="rounded-md bg-amber-50 p-3 text-[14px] text-amber-900" data-label-notices>
            <p className="font-semibold">라벨 대상에서 제외된 항목</p>
            <ul className="mt-1 list-disc pl-5">
              {notices.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        {!testMode && labels.length === 0 && (
          <p className="rounded-md bg-gray-100 p-3 text-[14px] text-gray-700">출력할 수 있는 LOT QR 라벨이 없습니다.</p>
        )}

        {blockedReasons.length > 0 && (
          <div className="rounded-md bg-red-50 p-3 text-[14px] text-red-900">
            <p className="font-semibold">출력할 수 없는 라벨이 있습니다</p>
            <ul className="mt-1 list-disc pl-5">
              {blockedReasons.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        {needsReason && (
          <div className="space-y-1">
            <label className="text-[13px] font-medium text-muted-foreground" htmlFor="label-reprint-reason">
              재출력 사유
            </label>
            <Input
              id="label-reprint-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 라벨 훼손/오염, 부착 위치 변경"
              className="h-10 text-[14px]"
              maxLength={200}
            />
          </div>
        )}

        {/* 미리보기 — 실제 인쇄 페이지와 같은 컴포넌트(90×29mm) */}
        <div className="max-h-[60vh] overflow-auto rounded-md bg-gray-100 p-4">
          <div className="flex flex-col items-center gap-3">
            {labels.map((label, i) => (
              <div key={i} className="border border-gray-300 bg-white shadow-sm" style={{ width: "fit-content" }}>
                <BarcodeLabel data={label} reprint={needsReason && reason.trim().length > 0 ? true : reprint} />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          {candidateCount > 0 && (
            <Button
              variant="outline"
              className="mr-auto"
              onClick={() => (testMode ? setTestMode(false) : enterTestMode())}
              disabled={isPrinting}
            >
              {testMode ? "실제 라벨로 돌아가기" : `${TEST_LABEL_MARK} 라벨로 테스트`}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button
            onClick={() => void handlePrintClick()}
            disabled={isPrinting || (!testMode && Boolean(printBlockedReason)) || blockedReasons.length > 0 || labels.length === 0 || duplicateTestLot}
          >
            <Printer className="mr-2 h-4 w-4" />
            {isPrinting ? "처리 중..." : testMode ? `${TEST_LABEL_MARK} 라벨 인쇄` : reprint ? "재출력" : "인쇄"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
