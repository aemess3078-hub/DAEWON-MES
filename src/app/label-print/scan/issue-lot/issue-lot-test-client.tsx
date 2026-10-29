"use client"

import { useRef, useState } from "react"
import { LotQrScanSection } from "@/app/app/mes/material-issue/lot-qr-scan-section"
import { applyScannedLot, lotSelectValue, ISSUE_LOT_LOOKUP_MESSAGES, type LotSplitRowLike } from "@/lib/material-issue/lot-scan"
import type { IssueLotLookupResult } from "@/lib/actions/material-issue-lot-lookup.actions"
import type { LotStockOption } from "@/lib/actions/material-issue.actions"

const ITEM_A = { itemId: "item-a", itemCode: "RM-A", itemName: "원자재 A" }
const opt = (lotNo: string, wh: string, qty: number): LotStockOption => ({
  lotId: `id-${lotNo}`,
  lotNo,
  warehouseId: `wh-${wh}`,
  warehouseCode: `WH-${wh}`,
  warehouseName: `창고 ${wh}`,
  qtyAvailable: qty,
  unit: "KG",
})
const okFor = (item: typeof ITEM_A, options: LotStockOption[], extra: Partial<Extract<IssueLotLookupResult, { ok: true }>> = {}): IssueLotLookupResult => ({
  ok: true,
  itemId: item.itemId,
  itemCode: item.itemCode,
  itemName: item.itemName,
  itemType: "RAW_MATERIAL",
  isLotTracked: true,
  lotId: options[0].lotId,
  lotNo: options[0].lotNo,
  lotStatus: "ACTIVE",
  options,
  ...extra,
})
const fail = (code: keyof typeof ISSUE_LOT_LOOKUP_MESSAGES): IssueLotLookupResult => ({ ok: false, code, message: ISSUE_LOT_LOOKUP_MESSAGES[code] })

/** 가짜 서버 응답 — 실제 서버 액션의 응답 형태/메시지와 같다(서버 검증 자체는 scripts/test-material-issue-qr.ts 가 가짜 DB 로 검증). */
const FAKE_SERVER: Record<string, () => Promise<IssueLotLookupResult>> = {
  "LOT-A-1": async () => okFor(ITEM_A, [opt("LOT-A-1", "1", 100)]),
  "LOT-A-2": async () => okFor(ITEM_A, [opt("LOT-A-2", "1", 40), opt("LOT-A-2", "2", 60)]),
  "LOT-A-3": async () => okFor(ITEM_A, [opt("LOT-A-3", "1", 30)]),
  "LOT-SLOW": async () => {
    await new Promise((r) => setTimeout(r, 1500))
    return okFor(ITEM_A, [opt("LOT-SLOW", "1", 10)])
  },
  "LOT-FULL": async () => okFor({ itemId: "item-full", itemCode: "RM-FULL", itemName: "이미 출고 완료 자재" }, [opt("LOT-FULL", "1", 10)]),
  "LOT-NONLOT": async () => okFor({ itemId: "item-nonlot", itemCode: "RM-NL", itemName: "비LOT 자재" }, [opt("LOT-NONLOT", "1", 10)]),
  "LOT-OTHERLIST": async () => okFor({ itemId: "item-unknown", itemCode: "RM-X", itemName: "목록에 없는 자재" }, [opt("LOT-OTHERLIST", "1", 10)]),
  "LOT-NOTFOUND": async () => fail("LOT_NOT_FOUND"),
  "LOT-OTHERTENANT": async () => fail("LOT_NOT_FOUND"),
  "LOT-NOTBOM": async () => fail("NOT_BOM_MATERIAL"),
  "LOT-RESTRICTED": async () => fail("LOT_RESTRICTED"),
  "LOT-NOSTOCK": async () => fail("NO_STOCK"),
  "LOT-ERROR": async () => {
    throw new Error("network")
  },
}

const MATERIALS = [
  { itemId: ITEM_A.itemId, pendingQty: 50, lotManaged: true },
  { itemId: "item-full", pendingQty: 0, lotManaged: true },
  { itemId: "item-nonlot", pendingQty: 20, lotManaged: false },
]

/** 자재출고 QR 연동 점검 화면. 실제 화면과 같은 LotQrScanSection + 같은 반영 규칙, 서버 조회만 가짜. */
export function IssueLotScanTestClient() {
  // 수동 선택 UI 가 쓰는 LOT 목록(기존 방식)과 LOT 분할 행(기존 구조)
  const [options, setOptions] = useState<LotStockOption[]>([opt("LOT-MANUAL-1", "1", 80), opt("LOT-MANUAL-2", "1", 20)])
  const [rows, setRows] = useState<LotSplitRowLike[]>([{ key: "A-0", lotValue: "", qty: "50" }])
  const [lookupCalls, setLookupCalls] = useState(0)
  const [confirmCount, setConfirmCount] = useState(0)
  const stock = useRef({ "LOT-A-1": 100, "LOT-MANUAL-1": 80 })
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  async function lookup({ lotNo }: { workOrderId: string; lotNo: string }): Promise<IssueLotLookupResult> {
    setLookupCalls((n) => n + 1)
    const handler = FAKE_SERVER[lotNo]
    return handler ? handler() : fail("LOT_NOT_FOUND")
  }

  function onSelectLot(itemId: string, option: LotStockOption) {
    void itemId
    const makeKey = () => `A-qr-${Date.now()}`
    const { outcome, qty } = applyScannedLot(rowsRef.current, option, makeKey)
    if (outcome === "ALREADY_SELECTED") return { outcome, qty }
    setOptions((prev) => (prev.some((o) => o.lotId === option.lotId && o.warehouseId === option.warehouseId) ? prev : [...prev, option]))
    setRows((prev) => applyScannedLot(prev, option, makeKey).splits)
    return { outcome, qty }
  }

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto" }} className="bg-gray-100 text-gray-900">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <h1 className="text-[24px] font-bold">자재출고 QR 연동 점검</h1>
        <p className="text-[14px] leading-relaxed text-gray-700">
          실제 자재출고 화면의 [QR 스캔] 컴포넌트와 LOT 반영 규칙을 그대로 쓰고 서버 조회만 가짜입니다. 서버·DB·재고 처리는 호출하지 않습니다.
        </p>

        <section className="rounded-lg border bg-white p-4">
          <LotQrScanSection workOrderId="wo-test" materials={MATERIALS} title="출고 자재 목록" onSelectLot={onSelectLot} isLotSelected={(_itemId, lotId) => rowsRef.current.some((r) => r.lotValue.startsWith(`${lotId}:`))} lookup={lookup} />

          <div className="mt-4 space-y-3" data-testid="harness-rows">
            <p className="text-[14px] font-medium">{ITEM_A.itemCode} {ITEM_A.itemName} — LOT 선택 (필요 50 KG)</p>
            {rows.map((row, i) => (
              <div key={row.key} className="flex items-center gap-2" data-testid={`harness-row-${i}`}>
                <select
                  data-testid={`harness-row-${i}-select`}
                  className="h-11 min-w-0 flex-1 rounded-md border bg-white px-2 text-[14px]"
                  value={row.lotValue}
                  onChange={(e) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, lotValue: e.target.value } : r)))}
                >
                  <option value="">LOT 선택</option>
                  {options.map((o) => (
                    <option key={lotSelectValue(o)} value={lotSelectValue(o)}>
                      {o.lotNo} · {o.warehouseName} · 가용 {o.qtyAvailable} {o.unit}
                    </option>
                  ))}
                </select>
                <input
                  data-testid={`harness-row-${i}-qty`}
                  className="h-11 w-28 rounded-md border px-2 text-right text-[14px]"
                  inputMode="decimal"
                  value={row.qty}
                  onChange={(e) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, qty: e.target.value } : r)))}
                />
              </div>
            ))}
            <button type="button" className="h-11 rounded-md border bg-white px-4 text-[14px]" data-testid="harness-add-row" onClick={() => setRows((prev) => [...prev, { key: `A-m-${prev.length}`, lotValue: "", qty: "" }])}>
              LOT 행 추가(수동)
            </button>
          </div>
        </section>

        <section className="rounded-lg border bg-white p-4 text-[14px]">
          <p>
            서버 조회 호출 횟수: <b data-testid="lookup-calls">{lookupCalls}</b>
          </p>
          <p>
            [출고 처리] 클릭 횟수(스캔은 이 값을 올리지 않아야 함): <b data-testid="confirm-count">{confirmCount}</b>
          </p>
          <p>
            재고(점검용 고정값): <b data-testid="stock-snapshot">{JSON.stringify(stock.current)}</b>
          </p>
          <button type="button" className="mt-2 h-11 rounded-md bg-blue-700 px-4 text-[14px] font-semibold text-white" data-testid="harness-confirm" onClick={() => setConfirmCount((n) => n + 1)}>
            출고 처리(점검용)
          </button>
        </section>
      </div>
    </div>
  )
}
