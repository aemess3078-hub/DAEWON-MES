/**
 * Daewon 기준정보(Master) 이관 CLI — Phase 7A / 7B-1
 *
 *   analyze          Excel(저장된 값만) → 추출/검증/분류 → 보고서 + Approved Dataset(+거래처 코드 매핑, 남은 REVIEW). DB 쓰기 없음.
 *   export-existing  현재 MES 의 Master 현황을 읽기 전용(SELECT/count)으로 JSON 으로 내보낸다.
 *   preview          Approved Dataset 을 export-existing 결과와 오프라인으로 대조(CREATE/MATCH/CONFLICT). DB 접속 없음.
 *   seed             Approved Dataset 을 "개발/테스트 DB" 에 적용(가드 필수). 운영에는 사용 금지.
 *   verify-mrp       개발 DB 의 실제 Master(BOM)로 가상 수요를 사용한 MRP 전개 검증(읽기 전용, 가상 수요는 메모리에만 존재).
 *
 * 사용(예):
 *   analyze --xlsx "<경로>" --out <폴더> [--existing existing.json] [--decisions policy.json] [--partner-codes map.json]
 *   export-existing --tenant <tenantId> --out existing.json            (DATABASE_URL 필요, SELECT 만)
 *   preview --dataset dataset.json --existing existing.json
 *   MASTER_SEED_CONFIRM=DEV_ONLY MASTER_SEED_DATABASE_URL=<개발DB> seed --dataset dataset.json [--dry-run] [--tenant <id>] [--on-conflict ABORT|SKIP]
 *   MASTER_SEED_CONFIRM=DEV_ONLY MASTER_SEED_DATABASE_URL=<개발DB> verify-mrp --tenant <id> [--qty 10]
 *
 * 출력 파일에는 실제 거래처명/품명/코드가 들어간다. 저장소(Git) 밖 폴더를 지정하고 커밋하지 않는다(.master-migration-out/ 은 gitignore).
 * Vercel 빌드/배포는 이 스크립트를 실행하지 않는다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { analyzeMaster } from "../src/lib/master-migration/analyze"
import { applyMasterDataset, loadExistingSnapshot } from "../src/lib/master-migration/apply"
import { buildApprovedDataset, validateDatasetShape } from "../src/lib/master-migration/dataset"
import { extractDaewonWorkbook } from "../src/lib/master-migration/extract"
import { reconcileCandidates, reconcileDataset, summarize } from "../src/lib/master-migration/reconcile"
import { summarizeAnalysis, summarizeSeedDataset } from "../src/lib/master-migration/report"
import { assertDevSeedTarget, isSeedGuardError } from "../src/lib/master-migration/seed-guard"
import { buildSheetReport } from "../src/lib/master-migration/sheet-report"
import { readWorkbookGrids } from "../src/lib/master-migration/workbook"
import type { ApprovedMasterDataset, ExistingMasterSnapshot, MasterAnalysis, MasterDecisions } from "../src/lib/master-migration/types"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

function writeJson(dir: string, name: string, value: unknown) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2), "utf8")
}

/** 승인 데이터셋 기준 "남은 REVIEW" 정리(실제 코드/이름 포함 — 로컬 보고서 전용) */
function remainingReview(analysis: MasterAnalysis, dataset: ApprovedMasterDataset) {
  const included = new Set(dataset.items.map((i) => i.code))
  const bomIncluded = new Set(dataset.boms.map((b) => b.parentCode))
  const notIncludedItems = analysis.items.filter((i) => i.code !== "" && !included.has(i.code))
  const rawMismatch = notIncludedItems.filter((i) => i.flags.inSettings && i.flags.isBomComponent)
  const unused = notIncludedItems.filter((i) => i.flags.inSettings && !i.flags.isBomComponent && !i.flags.isBomParent)
  const orderOnly = notIncludedItems.filter((i) => i.flags.orderOnly)
  const rejectedItems = analysis.items.filter((i) => i.grade === "REJECT")
  const invalidBoms = analysis.boms.filter((b) => b.grade === "REJECT")
  const blockedBoms = analysis.boms
    .filter((b) => b.grade !== "REJECT" && !bomIncluded.has(b.parentCode))
    .map((b) => ({ parentCode: b.parentCode, blockedBy: Array.from(new Set(b.lines.map((l) => l.componentCode).filter((c) => !included.has(c)))) }))
  const placeholders = dataset.items.filter((i) => i.needsMasterEnrichment)
  return {
    counts: {
      rawMismatch: rawMismatch.length,
      unusedMaterials: unused.length,
      invalidBom: invalidBoms.length,
      bomBlockedByUnapprovedComponent: blockedBoms.length,
      orderOnlyProducts: orderOnly.length,
      rejectedItems: rejectedItems.length,
      finishedPlaceholder: placeholders.length,
      partnersActiveUnconfirmed: dataset.partners.length,
    },
    details: {
      rawMismatch: rawMismatch.map((i) => ({ code: i.code, issues: i.issues.map((x) => x.code), sources: i.sources })),
      unusedMaterials: unused.map((i) => ({ code: i.code, issues: i.issues.map((x) => x.code), sources: i.sources })),
      invalidBom: invalidBoms.map((b) => ({
        parentCode: b.parentCode,
        src: b.src,
        badLines: b.lines.filter((l) => l.grade === "REJECT").map((l) => ({ src: l.src, qtyRaw: l.qtyRaw, issues: l.issues.map((x) => x.code) })),
      })),
      bomBlockedByUnapprovedComponent: blockedBoms,
      orderOnlyProducts: orderOnly.map((i) => ({ code: i.code, sources: i.sources })),
      partnersActiveUnconfirmed: dataset.partners.map((p) => ({ code: p.code, name: p.name, partnerType: p.partnerType })),
    },
    productionImportNotes: [
      "FINISHED 품명/규격/단위는 Excel 에 없어 임시값(name=code, uom=EA, spec=null)이다 — 실제 값 확보 또는 정책 재승인 필요",
      "고객/공급업체의 현재 거래 여부(ACTIVE), 사업자번호/연락처는 Excel 로 확인 불가 — Production import 전 확인 필요",
    ],
  }
}

async function analyze() {
  const xlsx = arg("xlsx")
  if (!xlsx) throw new Error("--xlsx <경로> 가 필요합니다")
  const out = resolve(arg("out") ?? ".master-migration-out")
  const buffer = readFileSync(xlsx) // 읽기 전용. 원본은 수정하지 않는다
  const { sheets, sha256 } = readWorkbookGrids(buffer)
  const sheetReport = buildSheetReport(sheets)
  const extraction = extractDaewonWorkbook(sheets)
  const analysis = analyzeMaster(extraction)

  const existing: ExistingMasterSnapshot | null = arg("existing") ? JSON.parse(readFileSync(resolve(arg("existing") as string), "utf8")).master : null
  const reconcileEntries = existing ? reconcileCandidates(analysis, existing) : null
  const summary = summarizeAnalysis(analysis, extraction, reconcileEntries ? summarize(reconcileEntries) : undefined)
  const decisions: MasterDecisions = arg("decisions") ? JSON.parse(readFileSync(resolve(arg("decisions") as string), "utf8")) : {}
  if (arg("partner-codes")) decisions.partnerCodeMap = JSON.parse(readFileSync(resolve(arg("partner-codes") as string), "utf8"))
  const dataset = buildApprovedDataset(analysis, { workbookSha256: sha256, decisions })
  const review = remainingReview(analysis, dataset)

  // 이후 재생성에서 같은 거래처가 같은 코드를 유지하도록 매핑을 함께 저장한다
  const partnerCodeMap: Record<string, string> = {}
  dataset.partners.forEach((p) => (partnerCodeMap[`${p.partnerType}|${p.name}`] = p.code))

  const template: Record<string, Record<string, unknown>> = { items: {}, boms: {}, partners: {}, itemSuppliers: {} }
  analysis.items.forEach((i) => {
    if (i.grade === "REVIEW") template.items[i.code] = { accept: false, ...i.suggestions, _issues: i.issues.map((x) => x.code) }
  })
  analysis.boms.forEach((b) => {
    if (b.grade === "REVIEW") template.boms[b.parentCode] = { accept: false, _issues: b.issues.map((x) => x.code) }
  })

  writeJson(out, "decisions.template.json", template)
  writeJson(out, "sheet-report.json", sheetReport)
  writeJson(out, "analysis.json", { analysis, structuralIssues: extraction.structuralIssues })
  writeJson(out, "dry-run-summary.json", { workbookSha256: sha256, summary, seed: summarizeSeedDataset(dataset) })
  writeJson(out, "reconcile.json", reconcileEntries ?? [])
  writeJson(out, "dataset.json", dataset)
  writeJson(out, "partner-code-map.json", partnerCodeMap)
  writeJson(out, "review-remaining.json", review)
  console.log(
    JSON.stringify(
      {
        workbookSha256: sha256,
        datasetHash: dataset.datasetHash,
        summary,
        seed: summarizeSeedDataset(dataset),
        placeholderItems: dataset.items.filter((i) => i.needsMasterEnrichment).length,
        normalizedItems: dataset.items.filter((i) => i.normalizations && i.normalizations.length > 0).length,
        review: review.counts,
        out,
      },
      null,
      2
    )
  )
}

async function exportExisting() {
  const tenant = arg("tenant") ?? process.env.DEFAULT_TENANT_ID
  if (!tenant) throw new Error("--tenant 또는 DEFAULT_TENANT_ID 가 필요합니다")
  const out = resolve(arg("out") ?? "existing-master.json")
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient()
  try {
    // SELECT 전용: findMany/count 만 사용한다
    const master = await loadExistingSnapshot(prisma, tenant)
    const counts = {
      item: await prisma.item.count({ where: { tenantId: tenant } }),
      bom: await prisma.bOM.count({ where: { tenantId: tenant } }),
      businessPartner: await prisma.businessPartner.count({ where: { tenantId: tenant } }),
      itemSupplier: await prisma.itemSupplier.count({ where: { tenantId: tenant } }),
      routing: await prisma.routing.count({ where: { tenantId: tenant } }),
      equipment: await prisma.equipment.count({ where: { tenantId: tenant } }),
      workCenter: await prisma.workCenter.count(),
      warehouse: await prisma.warehouse.count({ where: { tenantId: tenant } }),
      inspectionSpec: await prisma.inspectionSpec.count({ where: { tenantId: tenant } }),
      salesOrder: await prisma.salesOrder.count({ where: { tenantId: tenant } }),
      purchaseOrder: await prisma.purchaseOrder.count({ where: { tenantId: tenant } }),
      inventoryBalance: await prisma.inventoryBalance.count({ where: { tenantId: tenant } }),
    }
    writeFileSync(out, JSON.stringify({ master, counts }, null, 2), "utf8")
    console.log(JSON.stringify({ counts, out }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

function loadDataset(file: string): ApprovedMasterDataset {
  const raw = JSON.parse(readFileSync(resolve(file), "utf8"))
  const shape = validateDatasetShape(raw)
  if (!shape.ok) throw new Error(`데이터셋 검증 실패: ${shape.reason}`)
  return shape.dataset
}

function preview() {
  const file = arg("dataset")
  const ex = arg("existing")
  if (!file || !ex) throw new Error("--dataset 과 --existing 이 필요합니다")
  const dataset = loadDataset(file)
  const existing: ExistingMasterSnapshot = JSON.parse(readFileSync(resolve(ex), "utf8")).master
  const entries = reconcileDataset(dataset, existing)
  const placeholders = dataset.items.filter((i) => i.needsMasterEnrichment)
  const placeholderFields: Record<string, number> = {}
  placeholders.forEach((i) => (i.placeholderFields ?? []).forEach((f) => (placeholderFields[f] = (placeholderFields[f] ?? 0) + 1)))
  console.log(
    JSON.stringify(
      {
        mode: "PRODUCTION_PREVIEW_READ_ONLY",
        write: 0,
        datasetHash: dataset.datasetHash,
        dataset: summarizeSeedDataset(dataset),
        reconcile: summarize(entries),
        conflicts: entries.filter((e) => e.class === "CONFLICT").length,
        placeholder: {
          finishedItems: placeholders.length,
          fields: placeholderFields,
          note: "name=제품코드, uom=EA, spec=null 은 Excel 에 값이 없어 쓴 임시값이다(실제 제품명 아님)",
        },
      },
      null,
      2
    )
  )
}

async function countState(prisma: import("@prisma/client").PrismaClient, tenant: string) {
  return {
    master: {
      item: await prisma.item.count({ where: { tenantId: tenant } }),
      itemByType: {
        FINISHED: await prisma.item.count({ where: { tenantId: tenant, itemType: "FINISHED" } }),
        SEMI_FINISHED: await prisma.item.count({ where: { tenantId: tenant, itemType: "SEMI_FINISHED" } }),
        RAW_MATERIAL: await prisma.item.count({ where: { tenantId: tenant, itemType: "RAW_MATERIAL" } }),
      },
      bom: await prisma.bOM.count({ where: { tenantId: tenant } }),
      bomItem: await prisma.bOMItem.count({ where: { bom: { tenantId: tenant } } }),
      customer: await prisma.businessPartner.count({ where: { tenantId: tenant, partnerType: { in: ["CUSTOMER", "BOTH"] } } }),
      supplier: await prisma.businessPartner.count({ where: { tenantId: tenant, partnerType: { in: ["SUPPLIER", "BOTH"] } } }),
      itemSupplier: await prisma.itemSupplier.count({ where: { tenantId: tenant } }),
      itemSupplierDefault: await prisma.itemSupplier.count({ where: { tenantId: tenant, isDefault: true } }),
    },
    transaction: {
      inventoryBalance: await prisma.inventoryBalance.count(),
      inventoryTransaction: await prisma.inventoryTransaction.count(),
      lot: await prisma.lot.count(),
      salesOrder: await prisma.salesOrder.count(),
      purchaseOrder: await prisma.purchaseOrder.count(),
      workOrder: await prisma.workOrder.count(),
      wipUnit: await prisma.wipUnit.count(),
      productionResult: await prisma.productionResult.count(),
      finishedGoodsReceipt: await prisma.finishedGoodsReceipt.count(),
    },
  }
}

async function seed() {
  const file = arg("dataset")
  if (!file) throw new Error("--dataset <dataset.json> 이 필요합니다")
  const { databaseUrl, host } = assertDevSeedTarget(process.env)
  const dataset = loadDataset(file)
  const tenant = arg("tenant") ?? process.env.DEFAULT_TENANT_ID
  if (!tenant) throw new Error("--tenant 또는 DEFAULT_TENANT_ID 가 필요합니다")
  const dbName = (() => {
    try {
      return new URL(databaseUrl).pathname.replace(/^\//, "") || "(default)"
    } catch {
      return "(unknown)"
    }
  })()
  // 대상 DB 표시(접속 정보/비밀번호는 출력하지 않는다)
  console.error(`[master seed] target host=${host} database=${dbName} tenant=${tenant} mode=${has("dry-run") ? "DRY-RUN" : "APPLY"}`)
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const before = await countState(prisma, tenant)
    const onConflict = (arg("on-conflict") ?? "ABORT") === "SKIP" ? "SKIP" : "ABORT"
    const result = await applyMasterDataset(prisma, { tenantId: tenant, dataset, dryRun: has("dry-run"), onConflict })
    const after = await countState(prisma, tenant)
    console.log(
      JSON.stringify(
        {
          host,
          database: dbName,
          dryRun: result.dryRun,
          aborted: result.aborted,
          datasetHash: dataset.datasetHash,
          summary: result.summary,
          created: result.created,
          conflicts: result.conflicts.length,
          before,
          after,
        },
        null,
        2
      )
    )
    if (result.aborted) process.exitCode = 2
  } finally {
    await prisma.$disconnect()
  }
}

/** 개발 DB 의 실제 BOM + 메모리상 가상 수요(SO-DEMO)로 MRP 전개를 검증한다. DB 에는 아무것도 쓰지 않는다. */
async function verifyMrp() {
  const { databaseUrl, host } = assertDevSeedTarget(process.env)
  const tenant = arg("tenant") ?? process.env.DEFAULT_TENANT_ID
  if (!tenant) throw new Error("--tenant 또는 DEFAULT_TENANT_ID 가 필요합니다")
  const qty = Number(arg("qty") ?? "10")
  const { PrismaClient } = await import("@prisma/client")
  const { loadDefaultBomRows } = await import("../src/lib/services/mrp-loaders")
  const { runOrderMrpFromRows } = await import("../src/lib/mrp/order-mrp-adapter")
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const finished = await prisma.item.findMany({ where: { tenantId: tenant, itemType: "FINISHED" }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } })
    const { bomRows } = await loadDefaultBomRows(prisma, tenant, finished.map((f) => f.id))
    const due = new Date(Date.now() + 7 * 86_400_000)
    const demandRows = finished.map((f, i) => ({
      id: `demo-line-${i + 1}`,
      qty,
      shippedQty: 0,
      deliveryDate: due,
      itemId: f.id,
      item: { id: f.id, code: f.code, name: f.name },
      salesOrder: { id: `demo-so-${i + 1}`, orderNo: `SO-DEMO-${String(i + 1).padStart(3, "0")}`, status: "CONFIRMED", deliveryDate: due, customer: { name: "DEMO" } },
    }))
    const view = runOrderMrpFromRows({
      tenantId: tenant,
      demandRows: demandRows as never,
      bomRows,
      stockRows: [], // 재고 없음(가상)
      params: { from: null, to: null, includeDraft: false },
    })
    // 독립 계산: 제품별 Σ(수량 × qtyPer) 와 엔진 결과를 대조
    const expected = new Map<string, number>()
    const parentsWithBom = new Set<string>()
    bomRows.forEach((b) => {
      if (b.status !== "ACTIVE" || !b.isDefault) return
      parentsWithBom.add(b.itemId)
      b.bomItems.forEach((bi) => expected.set(bi.componentItemId, (expected.get(bi.componentItemId) ?? 0) + qty * Number(bi.qtyPer)))
    })
    let mismatches = 0
    view.materials.forEach((m) => {
      const e = expected.get(m.componentItemId)
      if (e === undefined || Math.abs(e - m.totalRequirement) > 1e-6) mismatches += 1
    })
    console.log(
      JSON.stringify(
        {
          host,
          mode: "READ_ONLY_SYNTHETIC_DEMAND",
          write: 0,
          finishedProducts: finished.length,
          productsWithDefaultBom: parentsWithBom.size,
          syntheticDemandLines: demandRows.length,
          demandQtyEach: qty,
          kpi: view.kpi,
          materials: view.materials.length,
          expectedMaterials: expected.size,
          requirementMismatches: mismatches,
          excludedLines: view.excludedLines.length,
          warnings: view.warnings.length,
        },
        null,
        2
      )
    )
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const cmd = process.argv[2]
  if (cmd === "analyze") return analyze()
  if (cmd === "export-existing") return exportExisting()
  if (cmd === "preview") return preview()
  if (cmd === "seed") return seed()
  if (cmd === "verify-mrp") return verifyMrp()
  throw new Error("사용법: analyze | export-existing | preview | seed | verify-mrp")
}

main().catch((e) => {
  if (isSeedGuardError(e)) console.error("[seed guard] " + e.message)
  else console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
