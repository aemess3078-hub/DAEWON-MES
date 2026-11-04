/**
 * 2-D-0 MRP 구매발주 생성 차단 — 소스 구조 검증 (DB·네트워크 없음)
 * 서버 액션 실호출 검증은 tests/e2e/tc-mrp-po-block.e2e.ts.
 *
 * 확인 항목
 *  - 정책 값이 꺼짐이고 안내 문구가 한글이며 필요한 안내를 담는다.
 *  - MRP 결과로 발주를 만드는 서비스(createPurchaseOrdersFromMrp / createDraftPurchaseOrdersFromSuggestions)를
 *    가져다 쓰는 파일은 "서버 액션 두 개"뿐이고, 둘 다 정책 값을 확인하는 차단 분기를 서비스 호출보다 앞에 둔다.
 *  - 그 밖의 "use server" 파일·API 라우트에서 위 서비스를 직접 가져다 쓰지 않는다(우회 진입점 없음).
 */
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { MRP_PURCHASE_CREATION_DISABLED_MESSAGE, MRP_PURCHASE_CREATION_ENABLED } from "../src/lib/mrp/purchase-creation-policy"
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

ok(MRP_PURCHASE_CREATION_ENABLED === false, "P1 MRP 구매발주 생성 정책이 꺼져 있다")
ok(/[가-힣]/.test(MRP_PURCHASE_CREATION_DISABLED_MESSAGE) && /구매발주/.test(MRP_PURCHASE_CREATION_DISABLED_MESSAGE) && /발주관리/.test(MRP_PURCHASE_CREATION_DISABLED_MESSAGE) && /조회/.test(MRP_PURCHASE_CREATION_DISABLED_MESSAGE), "P2 안내 문구는 한글이며 구매발주·조회·발주관리 안내를 담는다")
ok(DRAFT_PO_ERROR_MESSAGES.CREATION_DISABLED === MRP_PURCHASE_CREATION_DISABLED_MESSAGE, "P3 발주 초안 서비스의 오류 문구 표에 같은 안내가 있다")

const SERVICE_USE = /createPurchaseOrdersFromMrp\b|createDraftPurchaseOrdersFromSuggestions\b/
const importers = files.filter((f) => !/[\\/]services[\\/]mrp-purchase(-draft)?\.service\.ts$/.test(f) && SERVICE_USE.test(text(f)))
const importerNames = importers.map(rel).sort()
ok(importerNames.join(",") === ["src/lib/actions/mrp-purchase-suggestion.actions.ts", "src/lib/actions/mrp.actions.ts"].join(","), `S1 발주 생성 서비스를 쓰는 파일은 서버 액션 2개뿐 (${importerNames.join(", ")})`)

for (const f of importers) {
  const t = text(f)
  ok(/^["']use server["']/m.test(t), `S2 ${rel(f)} 는 서버 액션 파일`)
  const gate = t.indexOf("MRP_PURCHASE_CREATION_ENABLED)")
  const call = Math.min(...["createPurchaseOrdersFromMrp(", "createDraftPurchaseOrdersFromSuggestions("].map((n) => t.indexOf(n)).filter((i) => i >= 0))
  ok(gate > 0 && call > gate, `S3 ${rel(f)} 는 서비스 호출보다 앞에서 정책 값을 확인한다`)
  ok(/if \(!MRP_PURCHASE_CREATION_ENABLED\) \{[\s\S]*?requireResourcePermission\("MRP", "CREATE"\)[\s\S]*?requireResourcePermission\("PURCHASE_ORDER", "CREATE"\)[\s\S]*?return \{ success: false/.test(t), `S4 ${rel(f)} 의 차단 분기는 권한 확인 후 실패 결과만 반환한다(쓰기 없음)`)
}

const apiRoutes = files.filter((f) => /[\\/]app[\\/]api[\\/]/.test(f))
ok(!apiRoutes.some((f) => /mrp-purchase|purchaseOrder\.create|purchaseOrderItem\.create/.test(text(f))), `S5 API 라우트 ${apiRoutes.length}개 중 MRP 발주 생성이나 발주 직접 생성이 없다`)

// 발주를 만드는 모든 위치 목록(일반 발주 등록·외주 발주는 정책 대상 아님)
const creators = files.filter((f) => /\b(?:tx|db|prisma)\.purchaseOrder\.create\(/.test(text(f))).map(rel).sort()
ok(creators.join(",") === ["src/lib/actions/outsourcing.actions.ts", "src/lib/actions/purchase-order.actions.ts", "src/lib/services/mrp-purchase-draft.service.ts", "src/lib/services/mrp-purchase.service.ts"].join(","), `S6 구매발주 생성 위치 4곳(일반 등록·외주·MRP 서비스 2) 외에 없다 (${creators.join(", ")})`)

// 화면 버튼도 같은 정책을 따른다(방어선은 서버지만 사용자가 눌러 보게 두지 않는다)
for (const f of ["src/app/app/mes/mrp/mrp-dashboard.tsx", "src/app/app/mes/mrp/purchase-suggestion-panel.tsx"]) {
  const t = text(path.join(ROOT, f))
  ok(/!MRP_PURCHASE_CREATION_ENABLED/.test(t) && /MRP_PURCHASE_CREATION_DISABLED_MESSAGE/.test(t), `U1 ${f} 는 생성 버튼을 비활성화하고 안내를 보여준다`)
}

console.log(`\n${passed} checks passed`)
