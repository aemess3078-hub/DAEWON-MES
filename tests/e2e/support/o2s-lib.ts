/**
 * 수주~출하 통합 테스트 공용 라이브러리 — 로컬 테스트 DB/서버 전용.
 *  - 서버 액션을 실제 HTTP(Next-Action)로 호출한다(화면이 부르는 코드와 동일한 경로, 세션 쿠키 인증 포함).
 *  - 응답은 RSC 플라이트 본문(`1:{...}`)에서 값/오류를 해석한다.
 *  - 단계 간 식별자는 test-results/e2e/o2s-state.json 에 남겨 워커가 재시작돼도 이어서 검증한다.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { PrismaClient } from "@prisma/client"
import { E2E_BASE } from "../guard"
import { buildActionMap, type ActionInfo } from "./perm-lib"
import { DAEWON_ALLOWED_ROUTES } from "../../../src/lib/auth/daewon-scope"

export const DATA_FILE = path.join(process.cwd(), "test-results/e2e/o2s-data.json")
export const STATE_FILE = path.join(process.cwd(), "test-results/e2e/o2s-state.json")
export const DETAIL_FILE = path.join(process.cwd(), "test-results/e2e/o2s-detail.jsonl")

export type O2sData = {
  tenantId: string
  site: { id: string; code: string; name: string }
  warehouses: { raw: { id: string; code: string }; wip: { id: string; code: string }; fg: { id: string; code: string } }
  customer: { id: string; code: string; name: string }
  supplier: { id: string; code: string; name: string }
  items: { fg: { id: string; code: string }; rm1: { id: string; code: string }; rm2: { id: string; code: string } }
  bom: { id: string; version: string }
  routing: { id: string; code: string; ops: string[] }
  equipments: { eq1: { id: string; code: string }; eq2: { id: string; code: string } }
  specs: { op1: string; op2: string }
  defectCode: { id: string; code: string }
  worker: { loginId: string; profileId: string; tenantUserId: string; pin: string }
}
export const loadData = (): O2sData => JSON.parse(fs.readFileSync(DATA_FILE, "utf8").replace(/^﻿/, ""))

export type State = Record<string, any>
export const loadState = (): State => { try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) } catch { return {} } }
export const saveState = (patch: State): State => {
  const s = { ...loadState(), ...patch }
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf8")
  return s
}
export const logDetail = (o: Record<string, unknown>) => fs.appendFileSync(DETAIL_FILE, JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n", "utf8")

let _db: PrismaClient | null = null
export const db = () => (_db ??= new PrismaClient())
export const closeDb = async () => { await _db?.$disconnect(); _db = null }
export const num = (v: unknown) => Number(v ?? 0)

// ───────── 서버 액션 호출 ─────────
let MAP: ActionInfo[] = []
export const refreshMap = () => (MAP = buildActionMap())
const toPath = (key: string) => "/" + key.replace(/^app\//, "").replace(/\/page$/, "").split("/").filter((s) => !/^\(.*\)$/.test(s)).join("/")

export function findAction(name: string, fileRe: RegExp): ActionInfo {
  const a = MAP.find((x) => x.name === name && x.files.some((f) => fileRe.test(f)))
  if (!a) throw new Error(`액션 ${name} 이(가) 매니페스트에 없습니다(해당 페이지 컴파일 실패?)`)
  return a
}

export type Res = { status: number; ok: boolean; value: any; error: string | null; raw: string; setCookie: string }
/** ok = 서버가 예외를 던지지 않았고 { success:false | ok:false } 형태의 소프트 오류도 아님 */
export async function call(cookie: string | null, a: ActionInfo, args: unknown[], opts: { pagePath?: string } = {}): Promise<Res> {
  const pages = a.pages.map(toPath)
  // 대원정밀 구축 범위 밖 경로로 비개발자 POST 를 보내면 개발 서버가 멈추므로(S-05) 범위 안(또는 /pop·/login) 경로를 우선 사용한다
  const inScope = (p: string) => p === "/login" || p.startsWith("/pop") || DAEWON_ALLOWED_ROUTES.some((r) => p === r || p.startsWith(r + "/"))
  const pagePath = opts.pagePath ?? pages.find((p) => !p.includes("[") && inScope(p)) ?? pages.find((p) => !p.includes("[")) ?? pages[0]
  const headers: Record<string, string> = { "next-action": a.id, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }
  if (cookie) headers.cookie = cookie
  const r = await fetch(`${E2E_BASE}${pagePath}`, { method: "POST", headers, body: JSON.stringify(args), redirect: "manual", signal: AbortSignal.timeout(110_000) })
  const raw = await r.text()
  const setCookie = r.headers.get("set-cookie") ?? ""
  const err = /(?:^|\n)\d+:E(\{.*)/.exec(raw)
  if (err) {
    let msg = err[1].slice(0, 300)
    try { msg = (JSON.parse(err[1]) as { message?: string }).message ?? msg } catch { /* raw */ }
    return { status: r.status, ok: false, value: null, error: msg, raw, setCookie }
  }
  if (r.status >= 300) return { status: r.status, ok: false, value: null, error: `HTTP ${r.status}${r.headers.get("location") ? ` → ${r.headers.get("location")}` : ""}`, raw: raw.slice(0, 300), setCookie }
  const line = /(?:^|\n)1:(.*)$/m.exec(raw)?.[1]?.trim() ?? ""
  let value: any = line
  try { value = JSON.parse(line) } catch { /* 문자열 그대로 */ }
  const soft = value && typeof value === "object" && !Array.isArray(value) && (value.success === false || value.ok === false)
  const softMsg = soft ? String(value.error ?? value.message ?? JSON.stringify(value)).slice(0, 300) : null
  return { status: r.status, ok: !soft, value, error: softMsg, raw, setCookie }
}

export async function warm(cookie: string, pages: string[]) {
  for (const p of pages) {
    try { await fetch(`${E2E_BASE}${p}`, { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(180_000) }) } catch { /* 다음 */ }
  }
  return refreshMap()
}

// ───────── 공통 ─────────
export const iso = (d: Date) => d.toISOString()
export const addDays = (n: number) => new Date(Date.now() + n * 86_400_000)
export const rid = (tag: string) => `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-e2e`.slice(0, 64)

/** 모든 재고 잔고/원장을 한 번에 요약(품목+LOT 기준) */
export async function stockOf(tenantId: string, itemId: string) {
  const rows = await db().inventoryBalance.findMany({ where: { tenantId, itemId }, include: { lot: { select: { lotNo: true } }, warehouse: { select: { code: true } } } })
  return rows.map((r) => ({ lotNo: r.lot?.lotNo ?? null, wh: r.warehouse.code, onHand: num(r.qtyOnHand), avail: num(r.qtyAvailable), hold: num(r.qtyHold), lotId: r.lotId, id: r.id }))
}
export const sumOnHand = async (tenantId: string, itemId: string) => (await stockOf(tenantId, itemId)).reduce((s, r) => s + r.onHand, 0)

/** 업무 거래 테이블 행 수 스냅샷(실패한 요청이 DB 를 바꾸지 않았는지 대조) */
const TXN = ["SalesOrder", "SalesOrderItem", "ProductionPlan", "ProductionPlanItem", "PurchaseOrder", "PurchaseOrderItem", "ReceivingInspection", "ReceivingRequest", "Lot", "InventoryBalance", "InventoryTransaction",
  "WorkOrder", "WorkOrderOperation", "WorkOrderMaterialLot", "MaterialReservation", "WipUnit", "WipMovement", "WipUnitMaterialLot", "ProductionResult", "QualityInspection", "DefectRecord", "FinishedGoodsReceipt", "ShipmentOrder", "ShipmentItem", "LotGenealogy", "MrpRun"]
export async function counts(): Promise<Record<string, number>> {
  const sql = TXN.map((t) => `select '${t}' t, count(*)::int c from "${t}"`).join(" union all ")
  const rows = await db().$queryRawUnsafe<{ t: string; c: number }[]>(sql)
  return Object.fromEntries(rows.map((r) => [r.t, r.c]))
}
export const diffCounts = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(b).filter((k) => a[k] !== b[k]).map((k) => `${k}:${a[k]}→${b[k]}`)
/** 잔고 합계/수량 변화까지 보는 정밀 스냅샷 */
export async function fingerprint(): Promise<string> {
  const rows = await db().$queryRawUnsafe<{ s: string }[]>(`select coalesce(sum("qtyOnHand"),0)::text || '/' || coalesce(sum("qtyAvailable"),0)::text as s from "InventoryBalance"`)
  return JSON.stringify([await counts(), rows[0].s])
}
