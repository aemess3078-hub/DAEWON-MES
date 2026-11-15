/**
 * MRP 구매발주 생성 정책/진입점 — 소스 구조 + 정책 판정 검증 (DB·네트워크 없음)
 * 서버 액션 실호출 검증은 tests/e2e/tc-mrp-po-block.e2e.ts.
 *
 * 확인 항목
 *  - 정책은 상수가 아니라 환경 판정이다: 로컬 플래그 + 루프백 DB + 비 Vercel 일 때만 켜진다(운영/원격 DB 에서는 켜질 수 없다).
 *  - 공통 발주 파이프라인(createDraftPurchaseOrdersFromSuggestions)을 쓰는 서버 액션은 1개뿐이고,
 *    정책 판정 차단 분기를 서비스 호출보다 앞에 둔다. 구 방식(createPurchaseOrdersFromMrp: 첫 공급업체/멱등 없음)은 어떤 소스도 import 하지 않는다.
 *  - 그 밖의 "use server" 파일·API 라우트에서 위 서비스를 직접 가져다 쓰지 않는다(우회 진입점 없음).
 *  - 화면(수주기준/생산계획)은 같은 패널·같은 서버 판정을 쓴다.
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { evaluateMrpPurchaseCreationPolicy, isMrpPurchaseCreationEnabled, MRP_PURCHASE_CREATION_DISABLED_MESSAGE } from "../src/lib/mrp/purchase-creation-policy"
import { DRAFT_PO_ERROR_MESSAGES } from "../src/lib/services/mrp-purchase-draft.service"

let passed = 0
function ok(value: unknown, label: string) { assert.ok(value, label); passed += 1; console.log(`PASS ${label}`) }

const ROOT = path.resolve(__dirname, "..")
const SRC = path.join(ROOT, "src")
function walk(dir: string, out: string[] = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}
const files = walk(SRC)
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/")
const text = (f: string) => fs.readFileSync(f, "utf8")

// ── 정책 판정(환경) ──
const LOCAL_DB = "postgresql://u:p@127.0.0.1:5432/db?schema=public"
ok(!isMrpPurchaseCreationEnabled({}), "P1 환경 설정이 없으면 꺼져 있다")
ok(!isMrpPurchaseCreationEnabled({ DATABASE_URL: LOCAL_DB }), "P1 로컬 DB 만으로는 켜지지 않는다(플래그 필요)")
ok(!isMrpPurchaseCreationEnabled({ MRP_PURCHASE_CREATION_LOCAL: "1" }), "P1 플래그만으로는 켜지지 않는다(DB 필요)")
ok(!isMrpPurchaseCreationEnabled({ MRP_PURCHASE_CREATION_LOCAL: "1", DATABASE_URL: "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres" }), "P1 원격(운영) DB 는 플래그가 있어도 켜지지 않는다")
ok(!isMrpPurchaseCreationEnabled({ MRP_PURCHASE_CREATION_LOCAL: "1", DATABASE_URL: "postgresql://u:p@127.0.0.1.evil.com:5432/db" }), "P1 루프백처럼 보이는 외부 호스트는 켜지지 않는다")
ok(!isMrpPurchaseCreationEnabled({ MRP_PURCHASE_CREATION_LOCAL: "1", DATABASE_URL: "not a url" }), "P1 DB 주소를 해석하지 못하면 꺼진다")
ok(!isMrpPurchaseCreationEnabled({ MRP_PURCHASE_CREATION_LOCAL: "1", DATABASE_URL: LOCAL_DB, VERCEL: "1" }), "P1 Vercel 환경에서는 켜지지 않는다")
ok(!isMrpPurchaseCreationEnabled({ MRP_PURCHASE_CREATION_LOCAL: "1", DATABASE_URL: LOCAL_DB, VERCEL_ENV: "production" }), "P1 VERCEL_ENV 가 있어도 켜지지 않는다")
ok(!isMrpPurchaseCreationEnabled({ MRP_PURCHASE_CREATION_LOCAL: "true", DATABASE_URL: LOCAL_DB }), "P1 플래그 값은 정확히 1 이어야 한다")
ok(
  isMrpPurchaseCreationEnabled({ MRP_PURCHASE_CREATION_LOCAL: "1", DATABASE_URL: LOCAL_DB }) &&
    evaluateMrpPurchaseCreationPolicy({ MRP_PURCHASE_CREATION_LOCAL: "1", DATABASE_URL: "postgresql://u:p@localhost:54329/x" }).enabled,
  "P1 플래그 + 루프백 DB 에서만 켜진다"
)
const policySrc = text(path.join(SRC, "lib/mrp/purchase-creation-policy.ts"))
ok(!/export const MRP_PURCHASE_CREATION_ENABLED/.test(policySrc), "P1 정책은 상수 스위치가 아니다")
ok(/[가-힣]/.test(MRP_PURCHASE_CREATION_DISABLED_MESSAGE) && /구매발주/.test(MRP_PURCHASE_CREATION_DISABLED_MESSAGE) && /발주관리/.test(MRP_PURCHASE_CREATION_DISABLED_MESSAGE) && /조회/.test(MRP_PURCHASE_CREATION_DISABLED_MESSAGE), "P2 안내 문구는 한글이며 구매발주·조회·발주관리 안내를 담는다")
ok(DRAFT_PO_ERROR_MESSAGES.CREATION_DISABLED === MRP_PURCHASE_CREATION_DISABLED_MESSAGE, "P3 발주 초안 서비스의 오류 문구 표에 같은 안내가 있다")

// ── 진입점 ──
const SERVICE_USE = /createDraftPurchaseOrdersFromSuggestions\b/
const importers = files.filter((f) => !/[\\/]services[\\/]mrp-purchase-draft\.service\.ts$/.test(f) && SERVICE_USE.test(text(f)))
const importerNames = importers.map(rel).sort()
ok(importerNames.join(",") === "src/lib/actions/mrp-purchase-suggestion.actions.ts", `S1 공통 발주 파이프라인을 쓰는 파일은 서버 액션 1개뿐 (${importerNames.join(", ")})`)
ok(!files.some((f) => /import[^;]*\bcreatePurchaseOrdersFromMrp\b[^;]*from/.test(text(f))), "S1 구 방식 서비스(createPurchaseOrdersFromMrp)를 import 하는 소스가 없다")

const draftAction = text(path.join(SRC, "lib/actions/mrp-purchase-suggestion.actions.ts"))
ok(/^["']use server["']/m.test(draftAction), "S2 mrp-purchase-suggestion.actions.ts 는 서버 액션 파일")
{
  const gate = draftAction.indexOf("if (!isMrpPurchaseCreationEnabled())")
  const call = draftAction.indexOf("createDraftPurchaseOrdersFromSuggestions(")
  ok(gate > 0 && call > gate, "S3 서비스 호출보다 앞에서 정책을 판정한다")
  ok(
    /if \(!isMrpPurchaseCreationEnabled\(\)\) \{[\s\S]*?requireResourcePermission\("MRP", "CREATE"\)[\s\S]*?requireResourcePermission\("PURCHASE_ORDER", "CREATE"\)[\s\S]*?return \{ success: false/.test(draftAction),
    "S4 차단 분기는 권한 확인 후 실패 결과만 반환한다(쓰기 없음)"
  )
  ok(/loadPlanBuilt:/.test(draftAction) && /loadBuilt:/.test(draftAction), "S4 수주기준·생산계획 모두 같은 파이프라인에 근거 계산을 주입한다")
}
{
  const legacy = text(path.join(SRC, "lib/actions/mrp.actions.ts"))
  const fn = legacy.slice(legacy.indexOf("export async function createPurchaseOrdersFromMRP"))
  ok(!/createPurchaseOrdersFromMrp\(|prisma\./.test(fn), "S4 구 진입점(createPurchaseOrdersFromMRP)은 발주를 만들지 않는다")
}

const apiRoutes = files.filter((f) => /[\\/]app[\\/]api[\\/]/.test(f))
ok(!apiRoutes.some((f) => /mrp-purchase|purchaseOrder\.create|purchaseOrderItem\.create/.test(text(f))), `S5 API 라우트 ${apiRoutes.length}개 중 MRP 발주 생성이나 발주 직접 생성이 없다`)

// 발주를 만드는 모든 위치 목록(일반 발주 등록·외주 발주는 정책 대상 아님)
const creators = files.filter((f) => /\b(?:tx|db|prisma)\.purchaseOrder\.create\(/.test(text(f))).map(rel).sort()
ok(
  creators.join(",") === ["src/lib/actions/outsourcing.actions.ts", "src/lib/actions/purchase-order.actions.ts", "src/lib/services/mrp-purchase-draft.service.ts", "src/lib/services/mrp-purchase.service.ts"].join(","),
  `S6 구매발주 생성 위치 4곳(일반 등록·외주·MRP 서비스 2) 외에 없다 (${creators.join(", ")})`
)

// ── 화면: 수주기준/생산계획이 같은 패널과 같은 서버 판정을 따른다(방어선은 서버지만 사용자가 눌러 보게 두지 않는다) ──
const panel = text(path.join(ROOT, "src/app/app/mes/mrp/purchase-suggestion-panel.tsx"))
ok(
  /getMrpPurchaseCreationState/.test(panel) && /disabled=\{!enabled \|\| !canCreate \|\| creating\}/.test(panel) && /MRP_PURCHASE_CREATION_DISABLED_MESSAGE/.test(panel),
  "U1 패널은 서버 판정이 꺼져 있으면 생성 버튼을 비활성화하고 안내한다"
)
ok(/구매발주 생성 \(\{selectedRows\.length\}건\)/.test(panel), "U1 버튼명은 '구매발주 생성 (N건)'")
ok(/source=\{\{ kind: "PLAN"/.test(text(path.join(ROOT, "src/app/app/mes/mrp/mrp-dashboard.tsx"))), "U2 생산계획 MRP 는 같은 패널(PLAN)을 쓴다")
ok(/source=\{\{ kind: "ORDER"/.test(text(path.join(ROOT, "src/app/app/mes/mrp/order-mrp-panel.tsx"))), "U2 수주기준 MRP 는 같은 패널(ORDER)을 쓴다")

console.log(`\n${passed} checks passed`)
