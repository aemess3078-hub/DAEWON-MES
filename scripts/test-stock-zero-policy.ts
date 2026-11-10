import assert from "node:assert/strict"
import fs from "node:fs"
import { applyZeroStockPolicyToGroup } from "../src/lib/stock-zero-policy"

const row = (lotId: string | null, warehouseId: string, onHand: number, hold = 0) => ({
  lotId, warehouseId, qtyOnHand: onHand, qtyAvailable: onHand - hold, qtyHold: hold,
})
const base = {
  isLotTracked: true, totalQtyOnHand: 0, totalQtyAvailable: 0, totalQtyHold: 0,
  lotCount: 0, warehouseCount: 0, hasUnlottedStock: false,
}

// 1) LOT 품목: 0 행 숨김, 합계·LOT/창고 개수는 보이는 행 기준
const rows = [row("L1", "A", 0), row("L1", "B", 30), row("L2", "A", 70, 10), row("L3", "B", 0)]
const hidden = applyZeroStockPolicyToGroup(base, rows, false)!
assert.equal(hidden.rows.length, 2)
assert.equal(hidden.group.totalQtyOnHand, 100)
assert.equal(hidden.group.totalQtyAvailable, 90)
assert.equal(hidden.group.totalQtyHold, 10)
assert.equal(hidden.group.lotCount, 2, "재고 있는 LOT 기준")
assert.equal(hidden.group.warehouseCount, 2)

// 2) 재고 0 포함: 모든 행, LOT 3개
const all = applyZeroStockPolicyToGroup(base, rows, true)!
assert.equal(all.rows.length, 4)
assert.equal(all.group.lotCount, 3)
assert.equal(all.group.totalQtyOnHand, 100, "0 행은 합계에 영향 없음")

// 3) 재고이동 후 출발이 0이 되면 기본 화면 제외, 도착만 남음, 총량 동일
const afterTransfer = [row("L1", "A", 0), row("L1", "B", 100)]
const t = applyZeroStockPolicyToGroup(base, afterTransfer, false)!
assert.deepEqual(t.rows.map((r) => r.warehouseId), ["B"])
assert.equal(t.group.totalQtyOnHand, 100)
assert.equal(t.group.warehouseCount, 1)

// 4) 비LOT 품목도 동일 정책
const plain = applyZeroStockPolicyToGroup({ ...base, isLotTracked: false }, [row(null, "A", 0), row(null, "B", 5)], false)!
assert.equal(plain.rows.length, 1)
assert.equal(plain.group.lotCount, 0)

// 5) 전부 0이면 품목 자체 숨김(기본), 포함 시 표시
assert.equal(applyZeroStockPolicyToGroup(base, [row("L1", "A", 0)], false), null)
assert.ok(applyZeroStockPolicyToGroup(base, [row("L1", "A", 0)], true))

// 6) 음수 재고(이상 징후)는 숨기지 않음
assert.equal(applyZeroStockPolicyToGroup(base, [row("L1", "A", -2)], false)!.rows.length, 1)

// 7) LOT 미지정 경고는 보이는 행 기준
assert.equal(applyZeroStockPolicyToGroup(base, [row(null, "A", 0), row("L1", "A", 3)], false)!.group.hasUnlottedStock, false)
assert.equal(applyZeroStockPolicyToGroup(base, [row(null, "A", 4)], false)!.group.hasUnlottedStock, true)

// 8) 두 화면 모두 정책·체크박스(기본 OFF)를 사용하는지, 원본 조회 로직은 그대로인지
const mat = fs.readFileSync("src/app/app/mes/material/stock/material-stock-data-table.tsx", "utf8")
const inv = fs.readFileSync("src/app/app/mes/inventory/inventory-data-table.tsx", "utf8")
assert.match(mat, /useState\(false\)/)
assert.match(mat, /applyZeroStockPolicyToGroup/)
assert.match(mat, /재고 0 포함/)
assert.match(inv, /const \[includeZero, setIncludeZero\] = useState\(false\)/)
assert.match(inv, /!includeZero && b\.qtyOnHand === 0/)
assert.match(inv, /재고 0 포함/)
console.log("stock zero policy: passed")
