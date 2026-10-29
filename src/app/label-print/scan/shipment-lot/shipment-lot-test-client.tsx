"use client"

import { useRef, useState } from "react"
import { FgLotQrScan } from "@/app/app/mes/shipments/fg-lot-qr-scan"
import { planScannedFgLot, SHIPMENT_LOT_LOOKUP_MESSAGES, type LotAllocationLike, type ShipmentLotLookupFailCode } from "@/lib/shipment/fg-lot-scan"
import { lookupLotForShipment, type ShipmentLotLookupResult } from "@/lib/actions/shipment-lot-lookup.actions"
import type { AvailableFinishedGoodsLot } from "@/lib/actions/shipment.actions"

type ItemKey = "fg-a" | "fg-b"
const ITEMS: Record<ItemKey, { code: string; name: string; remaining: number }> = {
  "fg-a": { code: "FG-A", name: "완제품 A", remaining: 150 },
  "fg-b": { code: "FG-B", name: "완제품 B", remaining: 25 },
}
const WAREHOUSES = [
  { id: "wh-1", name: "완제품창고" },
  { id: "wh-2", name: "보조창고" },
]

type FakeLot = { lotNo: string; itemId: ItemKey; warehouseId: string; qty: number; kind?: "raw" | "restricted" | "quality" | "nostock" }
const FAKE_LOTS: FakeLot[] = [
  { lotNo: "FG-LOT-1", itemId: "fg-a", warehouseId: "wh-1", qty: 100 },
  { lotNo: "FG-LOT-2", itemId: "fg-a", warehouseId: "wh-1", qty: 40 },
  { lotNo: "FG-LOT-MANUAL", itemId: "fg-a", warehouseId: "wh-1", qty: 60 },
  { lotNo: "FG-LOT-SLOW", itemId: "fg-a", warehouseId: "wh-1", qty: 10 },
  { lotNo: "FG-LOT-STALE", itemId: "fg-a", warehouseId: "wh-1", qty: 5 }, // 서버는 가능하다고 하지만 화면 목록에는 없음
  { lotNo: "FG-LOT-WH2", itemId: "fg-a", warehouseId: "wh-2", qty: 15 },
  { lotNo: "FG-B-1", itemId: "fg-b", warehouseId: "wh-1", qty: 25 },
  { lotNo: "RM-LOT-1", itemId: "fg-a", warehouseId: "wh-1", qty: 99, kind: "raw" },
  { lotNo: "FG-LOT-QUAR", itemId: "fg-a", warehouseId: "wh-1", qty: 10, kind: "restricted" },
  { lotNo: "FG-LOT-QFAIL", itemId: "fg-a", warehouseId: "wh-1", qty: 10, kind: "quality" },
  { lotNo: "FG-LOT-NOSTOCK", itemId: "fg-a", warehouseId: "wh-1", qty: 0, kind: "nostock" },
]
const fail = (code: ShipmentLotLookupFailCode): ShipmentLotLookupResult => ({ ok: false, code, message: SHIPMENT_LOT_LOOKUP_MESSAGES[code] })
const lotRow = (l: FakeLot): AvailableFinishedGoodsLot => ({
  lotId: `id-${l.lotNo}`,
  lotNo: l.lotNo,
  itemId: l.itemId,
  warehouseId: l.warehouseId,
  warehouseName: WAREHOUSES.find((w) => w.id === l.warehouseId)?.name ?? "",
  locationId: null,
  locationName: null,
  qtyAvailable: l.qty,
})

/** 가짜 서버 응답 — 실제 서버 액션의 응답 형태/메시지와 같다(서버 검증 자체는 scripts/test-shipment-fg-qr.ts 가 가짜 DB 로 검증). */
async function fakeServer(input: { warehouseId: string; itemId: string; lotNo: string }): Promise<ShipmentLotLookupResult> {
  if (input.lotNo === "FG-LOT-ERROR") throw new Error("network")
  if (input.lotNo === "FG-LOT-SLOW") await new Promise((r) => setTimeout(r, 1500))
  const lot = FAKE_LOTS.find((l) => l.lotNo === input.lotNo)
  if (!lot) return fail("LOT_NOT_FOUND")
  if (lot.kind === "raw") return fail("NOT_FINISHED_GOODS")
  if (lot.itemId !== input.itemId) return fail("ITEM_MISMATCH")
  if (lot.kind === "restricted") return fail("LOT_RESTRICTED")
  if (lot.kind === "quality") return { ok: false, code: "QUALITY_HOLD", message: "최종검사 불합격 제품은 출하할 수 없습니다." }
  if (lot.kind === "nostock") return fail("NO_STOCK")
  if (lot.warehouseId !== input.warehouseId) return fail("OTHER_WAREHOUSE")
  const item = ITEMS[lot.itemId]
  return { ok: true, itemId: lot.itemId, itemCode: item.code, itemName: item.name, lotId: `id-${lot.lotNo}`, lotNo: lot.lotNo, lot: lotRow(lot) }
}

type Alloc = LotAllocationLike & { key: string }

/** 출하 화면의 수동 선택 목록(= getAvailableFinishedGoodsLots 결과)에 해당. 창고별로 다르다. */
function manualList(warehouseId: string, itemId: ItemKey): AvailableFinishedGoodsLot[] {
  return FAKE_LOTS.filter((l) => l.itemId === itemId && l.warehouseId === warehouseId && !l.kind && l.lotNo !== "FG-LOT-STALE").map(lotRow)
}

const emptyRows = (): Record<ItemKey, Alloc[]> => ({
  "fg-a": [{ key: "a0", lotId: "", qty: 0 }],
  "fg-b": [{ key: "b0", lotId: "", qty: 0 }],
})

/** 출하예정 등록 [QR 스캔] 연동 점검 화면. 실제 화면과 같은 FgLotQrScan + 같은 반영 규칙, 서버 조회만 가짜. */
export function ShipmentLotScanTestClient() {
  const [warehouseId, setWarehouseId] = useState("wh-1")
  const [rows, setRows] = useState<Record<ItemKey, Alloc[]>>(emptyRows)
  const [lookupCalls, setLookupCalls] = useState(0)
  const [registerCount, setRegisterCount] = useState(0)
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const seq = useRef(0)

  async function lookup(input: { warehouseId: string; itemId: string; lotNo: string }) {
    setLookupCalls((n) => n + 1)
    // ?real=1: 실제 읽기 전용 조회 서버 액션(lookupLotForShipment)만 호출한다 — 로그인이 없으므로 거부되며, "QR 조회 요청"의 네트워크 모양(POST 1건)을 확인하는 용도다.
    if (new URLSearchParams(window.location.search).get("real") === "1") return lookupLotForShipment(input)
    return fakeServer(input)
  }

  /** 수동 선택(handleLotChange)과 같은 수량 제안: min(가용, 미출하 − 다른 행 합계). */
  function suggest(item: ItemKey, list: Alloc[], index: number, lot: AvailableFinishedGoodsLot) {
    const others = list.reduce((sum, a, i) => (i === index ? sum : sum + (Number(a.qty) || 0)), 0)
    return Math.min(lot.qtyAvailable, Math.max(0, ITEMS[item].remaining - others))
  }

  function selectManually(item: ItemKey, index: number, lotId: string) {
    setRows((prev) => {
      const list = [...prev[item]]
      const lot = manualList(warehouseId, item).find((l) => l.lotId === lotId)
      list[index] = { ...list[index], lotId, qty: lot ? suggest(item, list, index, lot) : 0 }
      return { ...prev, [item]: list }
    })
  }

  function onSelectLot(item: ItemKey, lot: AvailableFinishedGoodsLot) {
    const plan = planScannedFgLot(rowsRef.current[item], lot.lotId)
    if (plan.outcome === "ALREADY_SELECTED") return plan.outcome
    setRows((prev) => {
      const list = [...prev[item]]
      if (plan.outcome === "ADDED_ROW") list.push({ key: `${item}-q${++seq.current}`, lotId: "", qty: 0 })
      list[plan.rowIndex] = { ...list[plan.rowIndex], lotId: lot.lotId, qty: plan.preserveQty ?? suggest(item, list, plan.rowIndex, lot) }
      return { ...prev, [item]: list }
    })
    return plan.outcome
  }

  // 실제 화면과 같이 창고를 바꾸면 LOT 선택을 초기화한다(기존 handleWarehouseChange)
  const changeWarehouse = (id: string) => {
    setWarehouseId(id)
    setRows(emptyRows())
  }

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "auto" }} className="bg-gray-100 text-gray-900">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <h1 className="text-[24px] font-bold">출하 QR 연동 점검</h1>
        <p className="text-[14px] leading-relaxed text-gray-700">
          실제 출하예정 등록 화면의 [QR 스캔] 컴포넌트와 LOT 반영 규칙을 그대로 쓰고 서버 조회만 가짜입니다. 서버·DB·재고 처리는 호출하지 않습니다.
        </p>

        <section className="rounded-lg border bg-white p-4">
          <label className="flex items-center gap-2 text-[14px]">
            출하 창고
            <select data-testid="harness-warehouse" className="h-11 rounded-md border bg-white px-2 text-[14px]" value={warehouseId} onChange={(e) => changeWarehouse(e.target.value)}>
              {WAREHOUSES.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>

          {(Object.keys(ITEMS) as ItemKey[]).map((item) => {
            const list = rows[item]
            const available = manualList(warehouseId, item)
            return (
              <div key={item} className="mt-4 space-y-2 rounded-md border p-3" data-testid={`harness-item-${item}`}>
                <p className="text-[14px] font-medium">
                  [{ITEMS[item].code}] {ITEMS[item].name} — 미출하 {ITEMS[item].remaining}
                </p>
                {list.map((row, i) => (
                  <div key={row.key} className="flex items-center gap-2" data-testid={`harness-${item}-row-${i}`}>
                    <select data-testid={`harness-${item}-row-${i}-select`} className="h-11 min-w-0 flex-1 rounded-md border bg-white px-2 text-[14px]" value={row.lotId} onChange={(e) => selectManually(item, i, e.target.value)}>
                      <option value="">LOT 선택</option>
                      {available.map((l) => (
                        <option key={l.lotId} value={l.lotId}>
                          {l.lotNo} · 가용 {l.qtyAvailable}
                        </option>
                      ))}
                    </select>
                    <input
                      data-testid={`harness-${item}-row-${i}-qty`}
                      className="h-11 w-28 rounded-md border px-2 text-right text-[14px]"
                      inputMode="decimal"
                      value={row.qty}
                      onChange={(e) => setRows((prev) => ({ ...prev, [item]: prev[item].map((r, j) => (j === i ? { ...r, qty: Number(e.target.value) || 0 } : r)) }))}
                    />
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="h-9 rounded-md border bg-white px-3 text-[13px]" data-testid={`harness-${item}-add-row`} onClick={() => setRows((prev) => ({ ...prev, [item]: [...prev[item], { key: `${item}-m${++seq.current}`, lotId: "", qty: 0 }] }))}>
                    LOT 추가
                  </button>
                  <FgLotQrScan
                    itemId={item}
                    warehouseId={warehouseId}
                    findLot={(lotId) => available.find((l) => l.lotId === lotId)}
                    isLotSelected={(lotId) => list.some((r) => r.lotId === lotId) || rowsRef.current[item].some((r) => r.lotId === lotId)}
                    onSelectLot={(lot) => onSelectLot(item, lot)}
                    lookup={lookup}
                  />
                </div>
              </div>
            )
          })}
        </section>

        <section className="rounded-lg border bg-white p-4 text-[14px]">
          <p>
            서버 조회 호출 횟수: <b data-testid="lookup-calls">{lookupCalls}</b>
          </p>
          <p>
            [출하예정 등록] 클릭 횟수(스캔은 이 값을 올리지 않아야 함): <b data-testid="register-count">{registerCount}</b>
          </p>
          <p>
            선택 상태: <span data-testid="state-snapshot">{JSON.stringify(rows)}</span>
          </p>
          <button type="button" className="mt-2 h-11 rounded-md bg-gray-900 px-4 text-[14px] text-white" data-testid="harness-register" onClick={() => setRegisterCount((n) => n + 1)}>
            출하예정 등록(점검용 — 실제 등록 없음)
          </button>
        </section>
      </div>
    </div>
  )
}
