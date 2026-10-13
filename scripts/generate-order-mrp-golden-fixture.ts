/**
 * Excel MRP(V09) → 익명화 Golden Fixture 생성 스크립트 (읽기 전용 · DB 비의존)
 *
 * 사용: npx ts-node --compiler-options "{\"module\":\"commonjs\"}" --project tsconfig.json \
 *         scripts/generate-order-mrp-golden-fixture.ts "<MRP_자재소요량_엑셀프로그램V09.xlsm 경로>"
 *
 * 출력(scripts/fixtures/order-mrp/):
 *   excel-golden-shipment-plan.json  출고예정소요량 시트 기준선 (수주 라인 × 자재 소요량)
 *   excel-golden-mrp.json            MRP작성 시트 기준선 (소요량·잔량 체인·결품수/누계)
 *
 * 원본 Excel 은 수정하지 않는다. 고객명은 포함하지 않으며 PO번호/제품코드는 순번으로 익명화한다.
 * 자재 코드(DW-n)는 내부 순번 코드이므로 그대로 둔다.
 */
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as XLSX from "xlsx"

const OUT_DIR = join(process.cwd(), "scripts", "fixtures", "order-mrp")

type Ws = XLSX.WorkSheet

function val(ws: Ws, r: number, c: number): string | number | undefined {
  const cell = ws[XLSX.utils.encode_cell({ r: r - 1, c: c - 1 })]
  if (!cell || cell.v === undefined || cell.v === "") return undefined
  return cell.v as string | number
}

function serialToDateOnly(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10)
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, "0")
}

function main() {
  const file = process.argv[2]
  if (!file) {
    console.error("Excel 파일 경로를 첫 번째 인자로 전달하세요.")
    process.exit(1)
  }
  const buf = readFileSync(file)
  const sha256 = createHash("sha256").update(buf).digest("hex")
  const wb = XLSX.read(buf, { type: "buffer", cellFormula: false, cellDates: false })
  const sheet = (name: string): Ws => {
    const ws = wb.Sheets[name]
    if (!ws) throw new Error(`시트를 찾을 수 없습니다: ${name}`)
    return ws
  }

  // ── 자재 마스터(설정 B11~) ────────────────────────────────────────────────
  const settings = sheet("설정")
  const materialCodes: string[] = []
  for (let r = 11; r <= 2000; r++) {
    const code = val(settings, r, 2)
    if (code !== undefined) materialCodes.push(String(code))
  }

  // ── BOM(DB 시트: A=번호, B=제품, 번호 k 의 블록 = 5k..5k+4 [코드,부품명,규격,수량,단위]) ──
  const db = sheet("DB")
  const bomByProduct = new Map<string, Array<{ code: string; qty: number | string }>>()
  for (let r = 1; r <= 5000; r++) {
    const product = val(db, r, 2)
    if (product === undefined) continue
    const k = Number(val(db, r, 1))
    const col = 5 * k
    const lines: Array<{ code: string; qty: number | string }> = []
    for (let rr = 11; rr <= 5000; rr++) {
      const code = val(db, rr, col)
      const qty = val(db, rr, col + 3)
      if (code === undefined && qty === undefined) continue
      if (code === undefined) continue
      lines.push({ code: String(code), qty: qty as number | string })
    }
    bomByProduct.set(String(product), lines)
  }

  // ── 현재 수주(수주관리대장 B:G, 11행~) ────────────────────────────────────
  const orders = sheet("수주관리대장")
  type OrderRow = { row: number; po: string; item: string; qty: number; due: number; ship: unknown }
  const orderRows: OrderRow[] = []
  for (let r = 11; r <= 5000; r++) {
    const item = val(orders, r, 3)
    if (item === undefined) continue
    orderRows.push({
      row: r,
      po: String(val(orders, r, 2)),
      item: String(item),
      qty: Number(val(orders, r, 4)),
      due: Number(val(orders, r, 5)),
      ship: val(orders, r, 6),
    })
  }

  // ════════ 기준선 A: 출고예정소요량 ════════════════════════════════════════
  const plan = sheet("출고예정소요량")
  type PlanCol = { col: number; po: string; item: string; qty: number; due: number }
  const planCols: PlanCol[] = []
  for (let c = 8; c <= 600; c++) {
    const po = val(plan, 2, c)
    const item = val(plan, 3, c)
    if (po === undefined && item === undefined) continue
    planCols.push({ col: c, po: String(po), item: String(item), qty: Number(val(plan, 4, c)), due: Number(val(plan, 9, c)) })
  }
  const keyOf = (po: string, item: string, qty: number, due: number) => `${po}|${item}|${qty}|${due}`
  const pool = new Map<string, number[]>()
  planCols.forEach((pc, i) => {
    const k = keyOf(pc.po, pc.item, pc.qty, pc.due)
    pool.set(k, [...(pool.get(k) ?? []), i])
  })

  const poAlias = new Map<string, string>()
  const itemAlias = new Map<string, string>()
  const aliasPo = (po: string) => {
    if (!poAlias.has(po)) poAlias.set(po, `PO-${pad(poAlias.size + 1, 3)}`)
    return poAlias.get(po) as string
  }
  const aliasItem = (item: string) => {
    if (!itemAlias.has(item)) itemAlias.set(item, `FG-${pad(itemAlias.size + 1, 3)}`)
    return itemAlias.get(item) as string
  }

  const matchedDemands: Array<{ po: string; item: string; qty: number; due: string; planCol: number }> = []
  for (const o of orderRows) {
    if (o.ship !== undefined) continue
    if (!bomByProduct.has(o.item)) continue
    const k = keyOf(o.po, o.item, o.qty, o.due)
    const list = pool.get(k)
    if (!list || list.length === 0) continue
    const idx = list.shift() as number
    matchedDemands.push({ po: aliasPo(o.po), item: aliasItem(o.item), qty: o.qty, due: serialToDateOnly(o.due), planCol: planCols[idx].col })
  }

  const shipmentExpected: Array<Record<string, number>> = matchedDemands.map((d) => {
    const cells: Record<string, number> = {}
    for (let r = 11; r <= 11 + materialCodes.length + 5; r++) {
      const code = val(plan, r, 2)
      if (code === undefined) continue
      const v = val(plan, r, d.planCol)
      if (typeof v === "number" && v !== 0) cells[String(code)] = v
    }
    return cells
  })

  const usedItems = new Set(matchedDemands.map((d) => d.item))
  const reverseItem = new Map(Array.from(itemAlias.entries()).map(([orig, alias]) => [alias, orig]))
  const shipmentBoms: Record<string, Array<[string, number | string]>> = {}
  Array.from(usedItems)
    .sort()
    .forEach((alias) => {
      const orig = reverseItem.get(alias) as string
      shipmentBoms[alias] = (bomByProduct.get(orig) ?? []).map((l) => [l.code, l.qty])
    })

  const shipmentFixture = {
    meta: {
      description: "Excel V09 출고예정소요량 시트 기준선 (익명화). 현재 수주+DB BOM 으로 재구성한 열이 캐시와 일치하는 열만 포함",
      sourceSha256: sha256,
      materialCount: materialCodes.length,
      demandCount: matchedDemands.length,
      cellsCompared: matchedDemands.length * materialCodes.length,
    },
    materialCodes,
    boms: shipmentBoms,
    demands: matchedDemands.map(({ po, item, qty, due }, i) => ({ po, item, qty, due, line: i + 1 })),
    expected: shipmentExpected,
  }

  // ════════ 기준선 B: MRP작성 ════════════════════════════════════════════════
  const mrp = sheet("MRP작성")
  const mrpMaterialRows: Array<{ row: number; code: string }> = []
  for (let r = 11; r <= 2000; r++) {
    const code = val(mrp, r, 2)
    if (code !== undefined) mrpMaterialRows.push({ row: r, code: String(code) })
  }
  const poB = new Map<string, string>()
  const itemB = new Map<string, string>()
  const aliasPoB = (po: string) => {
    if (!poB.has(po)) poB.set(po, `POB-${pad(poB.size + 1, 2)}`)
    return poB.get(po) as string
  }
  const aliasItemB = (item: string) => {
    if (!itemB.has(item)) itemB.set(item, `FGB-${pad(itemB.size + 1, 2)}`)
    return itemB.get(item) as string
  }

  const openingStock: Record<string, number> = {}
  for (const m of mrpMaterialRows) {
    const g = val(mrp, m.row, 7)
    if (typeof g === "number" && g !== 0) openingStock[m.code] = g
  }

  const issues: string[] = []
  const derivedBoms = new Map<string, Map<string, number>>()
  const mrpDemands: Array<{ po: string; item: string; qty: number; due: string; line: number }> = []
  const mrpExpected: Array<{
    req: Record<string, number>
    bal: Record<string, number>
    shortageItemCount: number
    cumulativeNegativeItemCount: number
  }> = []
  let line = 0
  for (let c = 11; c <= 400; c += 2) {
    const po = val(mrp, 2, c)
    const item = val(mrp, 3, c)
    if (po === undefined && item === undefined) continue
    const qty = Number(val(mrp, 4, c))
    const due = Number(val(mrp, 4, c + 1))
    line += 1
    const itemAlias = aliasItemB(String(item))
    mrpDemands.push({ po: aliasPoB(String(po)), item: itemAlias, qty, due: serialToDateOnly(due), line })
    const req: Record<string, number> = {}
    const bal: Record<string, number> = {}
    const unit = derivedBoms.get(itemAlias) ?? new Map<string, number>()
    for (const m of mrpMaterialRows) {
      const rv = val(mrp, m.row, c)
      const bv = val(mrp, m.row, c + 1)
      if (typeof rv === "number" && rv !== 0) {
        req[m.code] = rv
        const u = rv / qty
        if (!Number.isInteger(rv / qty) && Math.abs(u * qty - rv) > 1e-9) issues.push(`${itemAlias}/${m.code}: 소요량 ${rv} 가 수량 ${qty} 로 나누어지지 않음`)
        const prev = unit.get(m.code)
        if (prev !== undefined && Math.abs(prev - u) > 1e-9) issues.push(`${itemAlias}/${m.code}: 동일 제품의 열 간 단위 소요량 불일치 ${prev} vs ${u}`)
        unit.set(m.code, u)
      }
      if (typeof bv === "number" && bv !== 0) bal[m.code] = bv
    }
    derivedBoms.set(itemAlias, unit)
    mrpExpected.push({
      req,
      bal,
      shortageItemCount: Number(val(mrp, 6, c) ?? 0),
      cumulativeNegativeItemCount: Number(val(mrp, 6, c + 1) ?? 0),
    })
  }

  const mrpBoms: Record<string, Array<[string, number]>> = {}
  Array.from(derivedBoms.keys())
    .sort()
    .forEach((alias) => {
      mrpBoms[alias] = Array.from(derivedBoms.get(alias)!.entries())
    })

  const mrpFixture = {
    meta: {
      description:
        "Excel V09 MRP작성 시트 기준선 (익명화). BOM 은 캐시 소요량/수량으로 역산(당시 BOM). 주문 열 순서는 시트 순서이며 납기 오름차순이 아님",
      sourceSha256: sha256,
      materialCount: mrpMaterialRows.length,
      demandCount: mrpDemands.length,
      derivationIssues: issues,
    },
    materialCodes: mrpMaterialRows.map((m) => m.code),
    openingStock,
    boms: mrpBoms,
    demands: mrpDemands,
    expected: mrpExpected,
  }

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, "excel-golden-shipment-plan.json"), JSON.stringify(shipmentFixture) + "\n")
  writeFileSync(join(OUT_DIR, "excel-golden-mrp.json"), JSON.stringify(mrpFixture) + "\n")
  console.log(
    JSON.stringify(
      { shipmentDemands: matchedDemands.length, shipmentProducts: usedItems.size, mrpDemands: mrpDemands.length, derivationIssues: issues.length },
      null,
      2
    )
  )
}

main()
