/**
 * ItemPrice tenant 보안 테스트 (fake DB 주입 · 실제 DB 접속/쓰기 없음)
 *
 * 실행: npm run test:item-price-security
 *
 *  IP1 client tenantId 위조 create → 인증 tenant 만 사용     IP2 타 tenant ItemPrice update → 실패
 *  IP3 타 tenant ItemPrice delete → 실패                      IP4 타 tenant item/businessPartner create → 실패
 *  IP5 정상 tenant CRUD → 기존 동작 유지
 *  + 권한 실패 시 DB 접근 0, 조회는 인증 tenant 한정, 액션 시그니처에 tenantId 없음
 */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  createItemPriceCore,
  deleteItemPriceCore,
  INVALID_ITEM_PRICE_REFERENCE,
  listItemPricesCore,
  listPartnersForPricesCore,
  updateItemPriceCore,
  type ItemPriceDb,
} from "../src/lib/services/item-price.service"
import { makeFakeMasterDb } from "./helpers/fake-master-db"

let passed = 0
function eq<T>(actual: T, expected: T, label: string) {
  assert.deepStrictEqual(actual, expected, label)
  passed += 1
  console.log("PASS " + label)
}
function ok(value: unknown, label: string) {
  assert.ok(value, label)
  passed += 1
  console.log("PASS " + label)
}
function section(t: string) {
  console.log("\n── " + t)
}
async function rejects(fn: () => Promise<unknown>, message: string | RegExp, label: string) {
  await assert.rejects(fn, (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e)
    return typeof message === "string" ? m === message : message.test(m)
  }, label)
  passed += 1
  console.log("PASS " + label)
}

const A = { id: "user-a", name: "A 사용자", tenantId: "tenant-A" }

function seed() {
  return makeFakeMasterDb({
    item: [
      { id: "item-A1", tenantId: "tenant-A", code: "A-1", name: "A 품목" },
      { id: "item-B1", tenantId: "tenant-B", code: "B-1", name: "B 품목" },
    ],
    businessPartner: [
      { id: "bp-A1", tenantId: "tenant-A", code: "VA", name: "A 거래처", partnerType: "SUPPLIER", status: "ACTIVE" },
      { id: "bp-B1", tenantId: "tenant-B", code: "VB", name: "B 거래처", partnerType: "SUPPLIER", status: "ACTIVE" },
    ],
    itemPrice: [
      {
        id: "ip-A1", tenantId: "tenant-A", itemId: "item-A1", partnerId: "bp-A1", priceType: "PURCHASE",
        unitPrice: 100, currency: "KRW", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, note: null,
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "ip-B1", tenantId: "tenant-B", itemId: "item-B1", partnerId: "bp-B1", priceType: "PURCHASE",
        unitPrice: 999, currency: "KRW", effectiveFrom: new Date("2026-01-01"), effectiveTo: null, note: null,
        createdAt: new Date("2026-01-02"),
      },
    ],
  })
}

const baseInput = {
  itemId: "item-A1",
  partnerId: "bp-A1",
  priceType: "PURCHASE",
  unitPrice: 250,
  currency: "KRW",
  effectiveFrom: new Date("2026-10-01"),
}

async function main() {
  // ───────────────────────────────────────────────────────────────────────────
  section("IP1 client tenantId 위조 create → 인증 tenant 만 사용")
  {
    const f = seed()
    const spoofed = { ...baseInput, tenantId: "tenant-B" } as typeof baseInput
    await createItemPriceCore({ authorize: async () => A, db: f.db as ItemPriceDb }, spoofed)
    const created = f.tables.itemPrice.find((r) => r.unitPrice === 250)
    ok(created, "IP1 row created")
    eq(created!.tenantId, "tenant-A", "IP1 tenantId = authenticated tenant (spoof ignored)")
    eq(f.tables.auditLog[0].tenantId, "tenant-A", "IP1 audit tenant = authenticated tenant")
    eq(f.tables.itemPrice.filter((r) => r.tenantId === "tenant-B").length, 1, "IP1 tenant B untouched")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IP2 타 tenant ItemPrice update → 실패, write 0")
  {
    const f = seed()
    await rejects(
      () => updateItemPriceCore({ authorize: async () => A, db: f.db as ItemPriceDb }, "ip-B1", { unitPrice: 1 }),
      INVALID_ITEM_PRICE_REFERENCE,
      "IP2 foreign update rejected with generic message"
    )
    eq(f.countWrites(), 0, "IP2 no DB writes")
    eq(f.tables.itemPrice.find((r) => r.id === "ip-B1")!.unitPrice, 999, "IP2 foreign row unchanged")
    await rejects(
      () => updateItemPriceCore({ authorize: async () => A, db: f.db as ItemPriceDb }, "no-such-id", { unitPrice: 1 }),
      INVALID_ITEM_PRICE_REFERENCE,
      "IP2 nonexistent id → same generic message (existence not disclosed)"
    )
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IP3 타 tenant ItemPrice delete → 실패, write 0")
  {
    const f = seed()
    await rejects(
      () => deleteItemPriceCore({ authorize: async () => A, db: f.db as ItemPriceDb }, "ip-B1"),
      INVALID_ITEM_PRICE_REFERENCE,
      "IP3 foreign delete rejected"
    )
    eq(f.countWrites(), 0, "IP3 no DB writes")
    ok(f.tables.itemPrice.some((r) => r.id === "ip-B1"), "IP3 foreign row still exists")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IP4 타 tenant item / businessPartner create → 실패, write 0")
  {
    const f = seed()
    const deps = { authorize: async () => A, db: f.db as ItemPriceDb }
    await rejects(
      () => createItemPriceCore(deps, { ...baseInput, itemId: "item-B1" }),
      INVALID_ITEM_PRICE_REFERENCE,
      "IP4 foreign item rejected"
    )
    await rejects(
      () => createItemPriceCore(deps, { ...baseInput, partnerId: "bp-B1" }),
      INVALID_ITEM_PRICE_REFERENCE,
      "IP4 foreign partner rejected"
    )
    await rejects(
      () => createItemPriceCore(deps, { ...baseInput, itemId: "nope" }),
      INVALID_ITEM_PRICE_REFERENCE,
      "IP4 nonexistent item → same message"
    )
    eq(f.countWrites(), 0, "IP4 no DB writes")
    eq(f.tables.itemPrice.length, 2, "IP4 no rows added")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("IP5 정상 tenant CRUD → 기존 behavior 유지")
  {
    const f = seed()
    const deps = { authorize: async () => A, db: f.db as ItemPriceDb }
    await createItemPriceCore(deps, { ...baseInput, note: "신규", effectiveTo: new Date("2026-12-31") })
    const created = f.tables.itemPrice.find((r) => r.unitPrice === 250)!
    eq(
      [created.itemId, created.partnerId, created.priceType, created.currency, created.note],
      ["item-A1", "bp-A1", "PURCHASE", "KRW", "신규"],
      "IP5 create fields"
    )
    eq(f.tables.auditLog[0].action, "CREATE", "IP5 create audit")
    eq(f.tables.auditLog[0].menuName, "품목 가격 관리", "IP5 audit menuName unchanged")

    // update: 허용 필드만 반영, itemId/partnerId/tenantId 변경 시도는 무시
    const patch = { unitPrice: 300, currency: "USD", note: "수정", itemId: "item-B1", partnerId: "bp-B1", tenantId: "tenant-B" }
    await updateItemPriceCore(deps, created.id, patch as any)
    const updated = f.tables.itemPrice.find((r) => r.id === created.id)!
    eq([updated.unitPrice, updated.currency, updated.note], [300, "USD", "수정"], "IP5 update allowed fields")
    eq([updated.itemId, updated.partnerId, updated.tenantId], ["item-A1", "bp-A1", "tenant-A"], "IP5 update cannot move ownership")
    eq(f.tables.auditLog.at(-1)!.action, "UPDATE", "IP5 update audit")

    await deleteItemPriceCore(deps, created.id)
    ok(!f.tables.itemPrice.some((r) => r.id === created.id), "IP5 delete removes own row")
    eq(f.tables.auditLog.at(-1)!.action, "DELETE", "IP5 delete audit")
    eq(f.tables.itemPrice.some((r) => r.id === "ip-B1"), true, "IP5 other tenant row intact")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("권한/조회 경계")
  {
    const f = seed()
    const denied = async () => {
      throw new Error("이 기능을 사용할 권한이 없습니다.")
    }
    await rejects(
      () => createItemPriceCore({ authorize: denied, db: f.db as ItemPriceDb }, baseInput),
      "이 기능을 사용할 권한이 없습니다.",
      "권한 없음 create → throw"
    )
    await rejects(
      () => updateItemPriceCore({ authorize: denied, db: f.db as ItemPriceDb }, "ip-A1", { unitPrice: 1 }),
      /권한/,
      "권한 없음 update → throw"
    )
    await rejects(
      () => deleteItemPriceCore({ authorize: denied, db: f.db as ItemPriceDb }, "ip-A1"),
      /권한/,
      "권한 없음 delete → throw"
    )
    eq(f.countReads() + f.countWrites(), 0, "권한 실패 시 DB read/write 0")

    const listed = await listItemPricesCore({ authorizeTenant: async () => "tenant-A", db: f.db as ItemPriceDb })
    eq(listed.map((r: any) => r.id), ["ip-A1"], "조회: 인증 tenant 의 단가만")
    const partners = await listPartnersForPricesCore({ authorizeTenant: async () => "tenant-A", db: f.db as ItemPriceDb })
    eq(partners.map((r: any) => r.id), ["bp-A1"], "조회: 인증 tenant 의 거래처만")
  }

  // ───────────────────────────────────────────────────────────────────────────
  section("액션 시그니처: 클라이언트 tenantId 를 받지 않는다")
  {
    const src = readFileSync(join(__dirname, "..", "src", "lib", "actions", "item-price.actions.ts"), "utf8")
    ok(/export async function createItemPrice\(data: CreateItemPriceInput\)/.test(src), "createItemPrice(data) — tenantId 인자 없음")
    ok(/export async function getItemPrices\(\)/.test(src), "getItemPrices() — tenantId 인자 없음")
    ok(/export async function getAllPartners\(\)/.test(src), "getAllPartners() — tenantId 인자 없음")
    ok(!/tenantId:\s*string/.test(src), "액션 파일에 tenantId: string 파라미터 없음")
    ok(!/\.\.\.data/.test(readFileSync(join(__dirname, "..", "src", "lib", "services", "item-price.service.ts"), "utf8")), "서비스가 data 를 spread 하지 않는다")
  }

  console.log(`\nALL PASS (${passed} checks)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
