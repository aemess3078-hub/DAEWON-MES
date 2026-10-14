/**
 * Daewon 기준정보(Master) 이관 CLI — Phase 7A / 7B-1
 *
 *   analyze          Excel(저장된 값만) → 추출/검증/분류 → 보고서 + Approved Dataset(+거래처 코드 매핑, 남은 REVIEW). DB 쓰기 없음.
 *   export-existing  현재 MES 의 Master 현황을 읽기 전용(SELECT/count)으로 JSON 으로 내보낸다.
 *   preview          Approved Dataset 을 export-existing 결과와 오프라인으로 대조(CREATE/MATCH/CONFLICT). DB 접속 없음.
 *   seed             Approved Dataset 을 "개발/테스트 DB" 에 적용(가드 필수). 운영에는 사용 금지.
 *   verify-mrp       개발 DB 의 실제 Master(BOM)로 가상 수요를 사용한 MRP 전개 검증(읽기 전용, 가상 수요는 메모리에만 존재).
 *   import-production  승인된 Dataset 을 운영 DB 에 CREATE-only 로 적용(승인 가드 + dry-run + 단일 트랜잭션 + 감사). --dry-run 은 쓰기 0.
 *   verify-production  운영 Master 사후 검증(SELECT 전용): 건수/필드/무결성/업무 테이블 증가 0/2차 dry-run/감사/MRP.
 *   audit-production   운영 Master 최종 감사(SELECT 전용, Phase 7C): Dataset 대조, baseline hash, 커버리지/의존성, 로컬 보완 템플릿(CSV).
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
import {
  auditBoms,
  auditItems,
  auditItemSuppliers,
  auditPartners,
  buildReviewPack,
  compareToDataset,
  coverageAndDependencies,
  masterBaseline,
  rawUsage,
  type ProdMaster,
  type RawBomLineInfo,
} from "../src/lib/master-migration/audit"
import { buildApprovedDataset, datasetCounts, validateDatasetShape } from "../src/lib/master-migration/dataset"
import { extractDaewonWorkbook } from "../src/lib/master-migration/extract"
import { reconcileCandidates, reconcileDataset, summarize } from "../src/lib/master-migration/reconcile"
import { summarizeAnalysis, summarizeSeedDataset } from "../src/lib/master-migration/report"
import { assertDevSeedTarget, assertProductionImportAllowed, isProductionImportGuardError, isSeedGuardError } from "../src/lib/master-migration/seed-guard"
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

/** 실제 BOM + 메모리상 가상 수요(SO-DEMO)로 MRP 전개를 검증한다. DB 에는 아무것도 쓰지 않는다(SELECT 전용). */
async function syntheticMrp(prisma: import("@prisma/client").PrismaClient, tenant: string, qty: number) {
  const { loadDefaultBomRows } = await import("../src/lib/services/mrp-loaders")
  const { runOrderMrpFromRows } = await import("../src/lib/mrp/order-mrp-adapter")
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
    stockRows: [], // 재고 없음(가상, 메모리 전용)
    params: { from: null, to: null, includeDraft: false },
  })
  // 독립 계산: Σ(수량 × qtyPer) 와 엔진 결과를 대조
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
  return {
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
  }
}

async function verifyMrp() {
  const { databaseUrl, host } = assertDevSeedTarget(process.env)
  const tenant = arg("tenant") ?? process.env.DEFAULT_TENANT_ID
  if (!tenant) throw new Error("--tenant 또는 DEFAULT_TENANT_ID 가 필요합니다")
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    console.log(JSON.stringify({ host, ...(await syntheticMrp(prisma, tenant, Number(arg("qty") ?? "10"))) }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

// ─── Production Master import (Phase 7B-2) ─────────────────────────────────────

function parseExpectedCounts(raw: string | undefined): Record<string, number> | undefined {
  if (!raw) return undefined
  const out: Record<string, number> = {}
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split("=")
    const n = Number(v)
    if (!k || !Number.isInteger(n)) throw new Error(`--expected-counts 형식 오류: ${pair}`)
    out[k.trim()] = n
  }
  return out
}

const EXPECTED_CREATE_KEYS = (c: Record<string, number>) => ({ items: c.items, boms: c.boms, partners: c.customers + c.suppliers, itemSuppliers: c.itemSuppliers })

async function transactionCounts(prisma: import("@prisma/client").PrismaClient) {
  return {
    inventoryBalance: await prisma.inventoryBalance.count(),
    inventoryTransaction: await prisma.inventoryTransaction.count(),
    lot: await prisma.lot.count(),
    salesOrder: await prisma.salesOrder.count(),
    salesOrderItem: await prisma.salesOrderItem.count(),
    purchaseOrder: await prisma.purchaseOrder.count(),
    purchaseOrderItem: await prisma.purchaseOrderItem.count(),
    productionPlan: await prisma.productionPlan.count(),
    workOrder: await prisma.workOrder.count(),
    wipUnit: await prisma.wipUnit.count(),
    productionResult: await prisma.productionResult.count(),
    finishedGoodsReceipt: await prisma.finishedGoodsReceipt.count(),
    materialConsumption: await prisma.materialConsumption.count(),
    receivingInspection: await prisma.receivingInspection.count(),
    mrpRun: await prisma.mrpRun.count(),
  }
}

async function productionContext(requireApply: boolean) {
  const file = arg("dataset")
  const tenant = arg("tenant")
  if (!file || !tenant) throw new Error("--dataset 과 --tenant 가 필요합니다")
  const dataset = loadDataset(file)
  const counts = datasetCounts(dataset)
  assertProductionImportAllowed({
    env: process.env,
    apply: requireApply,
    datasetHash: dataset.datasetHash,
    expectedHash: arg("expected-hash"),
    tenantId: tenant,
    expectedTenantId: arg("expected-tenant"),
    counts,
    expectedCounts: parseExpectedCounts(arg("expected-counts")),
  })
  const url = process.env.DIRECT_URL
  if (!url) throw new Error("DIRECT_URL 이 필요합니다")
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient({ datasourceUrl: url })
  let host = "(unknown)"
  try {
    host = new URL(url).host
  } catch {
    // ignore
  }
  return { dataset, counts, tenant, prisma, host }
}

async function masterCounts(prisma: import("@prisma/client").PrismaClient, tenant: string) {
  const s = await countState(prisma, tenant)
  return s.master
}

async function importProduction() {
  const dryOnly = has("dry-run")
  const { dataset, counts, tenant, prisma, host } = await productionContext(!dryOnly)
  try {
    const t = await prisma.tenant.findUnique({ where: { id: tenant }, select: { id: true } })
    if (!t) throw new Error("대상 tenant 를 찾을 수 없습니다")
    console.error(`[master import] target host=${host} tenant=${tenant} mode=${dryOnly ? "PRODUCTION DRY-RUN" : "PRODUCTION APPLY"} datasetHash=${dataset.datasetHash}`)
    const before = { master: await masterCounts(prisma, tenant), transaction: await transactionCounts(prisma) }
    const m = before.master
    if (m.item + m.bom + m.bomItem + m.customer + m.supplier + m.itemSupplier !== 0) {
      throw new Error("운영 Master 가 비어 있지 않습니다 — 첫 Import 는 빈 Master 기준 CREATE-only 입니다. 중단합니다.")
    }
    const expectedCreate = EXPECTED_CREATE_KEYS(counts)
    const dry = await applyMasterDataset(prisma, { tenantId: tenant, dataset, dryRun: true, createOnly: true, expectedCreate })
    const allCreate = dry.entries.every((e) => e.class === "CREATE")
    const summary = { summary: dry.summary, conflicts: dry.conflicts.length, allCreate, abortReason: dry.abortReason ?? null }
    if (dry.aborted || dry.abortReason || !allCreate || dry.conflicts.length > 0) {
      console.log(JSON.stringify({ stage: "DRY_RUN_FAILED", ...summary, before }, null, 2))
      process.exitCode = 3
      return
    }
    if (dryOnly) {
      console.log(JSON.stringify({ stage: "DRY_RUN_OK", host, datasetHash: dataset.datasetHash, datasetCounts: counts, ...summary, before, write: 0 }, null, 2))
      return
    }
    // 실제 적용: 명시된 활성 OWNER 로 감사 기록
    const actorProfile = arg("actor-profile")
    if (!actorProfile) throw new Error("--actor-profile 이 필요합니다(현재 tenant 의 활성 OWNER)")
    const tu = await prisma.tenantUser.findFirst({ where: { tenantId: tenant, profileId: actorProfile, role: "OWNER", isActive: true }, include: { profile: { select: { id: true, name: true } } } })
    if (!tu) throw new Error("지정한 actor 가 현재 tenant 의 활성 OWNER 가 아닙니다")
    const result = await applyMasterDataset(prisma, {
      tenantId: tenant,
      dataset,
      dryRun: false,
      createOnly: true,
      expectedCreate,
      audit: { actorId: tu.profile.id, actorLabel: tu.profile.name, source: "DAEWON_MASTER_MIGRATION" },
    })
    const after = { master: await masterCounts(prisma, tenant), transaction: await transactionCounts(prisma) }
    const txDelta = Object.keys(after.transaction).filter((k) => (after.transaction as Record<string, number>)[k] !== (before.transaction as Record<string, number>)[k])
    console.log(
      JSON.stringify(
        { stage: "APPLIED", host, datasetHash: dataset.datasetHash, aborted: result.aborted, abortReason: result.abortReason ?? null, created: result.created, auditId: result.auditId ?? null, actor: { profileId: tu.profile.id, label: tu.profile.name }, before, after, transactionTablesChanged: txDelta },
        null,
        2
      )
    )
    if (result.aborted || txDelta.length > 0) process.exitCode = 4
    if (arg("out")) {
      writeJson(resolve(arg("out") as string), "import-before-after.json", { before, after, created: result.created, auditId: result.auditId })
    }
  } finally {
    await prisma.$disconnect()
  }
}

/** 운영 Master 사후 검증(SELECT 전용) */
async function verifyProduction() {
  const { dataset, counts, tenant, prisma, host } = await productionContext(false)
  const beforeFile = arg("before")
  const beforeTx: Record<string, number> | null = beforeFile ? JSON.parse(readFileSync(resolve(beforeFile), "utf8")).before.transaction : null
  const checks: Array<{ name: string; ok: boolean; detail?: unknown }> = []
  const check = (name: string, ok: boolean, detail?: unknown) => checks.push({ name, ok, detail })
  try {
    const state = await countState(prisma, tenant)
    const m = state.master
    check("Item = 승인 건수", m.item === counts.items, { actual: m.item, expected: counts.items })
    check("FINISHED / RAW / SEMI", m.itemByType.FINISHED === counts.finished && m.itemByType.RAW_MATERIAL === counts.raw && m.itemByType.SEMI_FINISHED === counts.semi, m.itemByType)
    check("BOM / BOMItem", m.bom === counts.boms && m.bomItem === counts.bomItems, { bom: m.bom, bomItem: m.bomItem })
    check("Customer / Supplier", m.customer === counts.customers && m.supplier === counts.suppliers, { customer: m.customer, supplier: m.supplier })
    check("ItemSupplier = 승인 건수, Default 0", m.itemSupplier === counts.itemSuppliers && m.itemSupplierDefault === 0, { itemSupplier: m.itemSupplier, default: m.itemSupplierDefault })

    // 필드 일치(데이터셋 ↔ DB)
    const snap = await loadExistingSnapshot(prisma, tenant)
    const byCode = new Map(snap.items.map((i) => [i.code, i]))
    const fieldMismatch = dataset.items.filter((d) => {
      const e = byCode.get(d.code)
      return !e || e.name !== d.name || (e.spec ?? null) !== d.spec || e.uom !== d.uom || e.itemType !== d.itemType
    })
    check("Item 필드가 Approved Dataset 과 일치", fieldMismatch.length === 0, { mismatches: fieldMismatch.length })
    const placeholderBad = dataset.items.filter((d) => d.needsMasterEnrichment).filter((d) => {
      const e = byCode.get(d.code)
      return !e || e.itemType !== "FINISHED" || e.name !== d.code || e.uom !== "EA" || (e.spec ?? null) !== null
    })
    check("FINISHED placeholder(name=code/EA/spec null) 유지", placeholderBad.length === 0 && dataset.items.filter((d) => d.needsMasterEnrichment).length === counts.finished, { bad: placeholderBad.length })

    // BOM / Partner / ItemSupplier 무결성(SELECT)
    const q = async (sql: string) => Number(((await prisma.$queryRawUnsafe(sql)) as Array<{ n: bigint | number }>)[0].n)
    check("orphan BOMItem = 0", (await q(`select count(*)::int n from "BOMItem" bi left join "BOM" b on b.id = bi."bomId" where b.id is null`)) === 0)
    check("missing BOM parent item = 0", (await q(`select count(*)::int n from "BOM" b left join "Item" i on i.id = b."itemId" where i.id is null`)) === 0)
    check("missing component item = 0", (await q(`select count(*)::int n from "BOMItem" bi left join "Item" i on i.id = bi."componentItemId" where i.id is null`)) === 0)
    check("component tenant mismatch = 0", (await q(`select count(*)::int n from "BOMItem" bi join "BOM" b on b.id = bi."bomId" join "Item" i on i.id = bi."componentItemId" where i."tenantId" <> b."tenantId"`)) === 0)
    check("duplicate component line = 0", (await q(`select count(*)::int n from (select "bomId","componentItemId" from "BOMItem" group by 1,2 having count(*) > 1) x`)) === 0)
    check("invalid qty(<=0) = 0", (await q(`select count(*)::int n from "BOMItem" where "qtyPer" <= 0`)) === 0)
    check("BOM 전부 ACTIVE + default + version 1", (await q(`select count(*)::int n from "BOM" where not (status::text = 'ACTIVE' and "isDefault" = true and version = '1')`)) === 0)
    check("Item 당 default BOM 1개 이하", (await q(`select count(*)::int n from (select "itemId" from "BOM" where "isDefault" = true group by 1 having count(*) > 1) x`)) === 0)
    const edges = new Map<string, string[]>()
    snap.boms.forEach((b) => edges.set(b.itemCode, (edges.get(b.itemCode) ?? []).concat(b.lines.map((l) => l.componentCode))))
    const color = new Map<string, number>()
    let cyc = 0
    const dfs = (n: string) => {
      color.set(n, 1)
      ;(edges.get(n) ?? []).forEach((c) => {
        if (color.get(c) === 1) cyc += 1
        else if (!color.has(c)) dfs(c)
      })
      color.set(n, 2)
    }
    Array.from(edges.keys()).forEach((n) => {
      if (!color.has(n)) dfs(n)
    })
    check("BOM cycle = 0", cyc === 0, { cycles: cyc })
    check("Item code 중복 = 0", (await q(`select count(*)::int n from (select code from "Item" where "tenantId" = '${tenant.replace(/'/g, "''")}' group by 1 having count(*) > 1) x`)) === 0)
    check("Partner code 중복 = 0", (await q(`select count(*)::int n from (select code from "BusinessPartner" where "tenantId" = '${tenant.replace(/'/g, "''")}' group by 1 having count(*) > 1) x`)) === 0)
    const partnerByCode = new Map(snap.partners.map((p) => [p.code, p]))
    const partnerBad = dataset.partners.filter((p) => {
      const e = partnerByCode.get(p.code)
      return !e || e.name !== p.name || e.partnerType !== p.partnerType
    })
    check("Partner 코드/이름/유형이 Dataset mapping 과 일치", partnerBad.length === 0 && snap.partners.length === dataset.partners.length, { bad: partnerBad.length })
    check("ItemSupplier foreign item/supplier = 0", (await q(`select count(*)::int n from "ItemSupplier" s left join "Item" i on i.id = s."itemId" left join "BusinessPartner" p on p.id = s."supplierId" where i.id is null or p.id is null or i."tenantId" <> s."tenantId" or p."tenantId" <> s."tenantId"`)) === 0)
    check("ItemSupplier LT/MOQ/배수 non-null = 0", (await q(`select count(*)::int n from "ItemSupplier" where "leadTimeDays" is not null or moq is not null or "orderMultiple" is not null`)) === 0)

    // 운영 정보 증가 0
    const tx = await transactionCounts(prisma)
    if (beforeTx) {
      const changed = Object.keys(tx).filter((k) => (tx as Record<string, number>)[k] !== beforeTx[k])
      check("업무(Transaction) 테이블 증가 0 (Import 전 대비)", changed.length === 0, { changed })
    } else {
      check("업무(Transaction) 테이블 row 0", Object.values(tx).every((v) => v === 0), tx)
    }

    // 두 번째 Dry-Run (idempotency)
    const second = await applyMasterDataset(prisma, { tenantId: tenant, dataset, dryRun: true })
    const sc = second.summary
    check(
      "두 번째 Dry-Run: CREATE 0 / MATCH 전체 / CONFLICT 0",
      sc.ITEM.CREATE + sc.BOM.CREATE + sc.PARTNER.CREATE + sc.ITEM_SUPPLIER.CREATE === 0 &&
        sc.ITEM.MATCH === counts.items &&
        sc.BOM.MATCH === counts.boms &&
        sc.PARTNER.MATCH === counts.customers + counts.suppliers &&
        sc.ITEM_SUPPLIER.MATCH === counts.itemSuppliers &&
        second.conflicts.length === 0,
      sc
    )

    // 감사 기록
    const audit = await prisma.auditLog.findMany({ where: { tenantId: tenant, entityType: "MasterImport" }, select: { id: true, actorLabel: true, actedAt: true, afterData: true } })
    check("Master Import AuditLog 존재(1건)", audit.length === 1, { count: audit.length })

    // 읽기 전용 MRP(가상 수요, 메모리)
    const mrp = await syntheticMrp(prisma, tenant, 10)
    check("읽기 전용 MRP 전개: 불일치 0", mrp.requirementMismatches === 0 && mrp.materials === mrp.expectedMaterials && mrp.write === 0, mrp)

    const failed = checks.filter((c) => !c.ok)
    console.log(JSON.stringify({ host, tenant, datasetHash: dataset.datasetHash, passed: checks.length - failed.length, failed: failed.length, checks, state, transaction: tx, audit: audit.map((a) => ({ id: a.id, actor: a.actorLabel, actedAt: a.actedAt, summary: a.afterData })) }, null, 2))
    if (failed.length > 0) process.exitCode = 5
  } finally {
    await prisma.$disconnect()
  }
}

// ─── Phase 7C: 운영 Master 최종 감사(SELECT 전용) ───────────────────────────────

/** 운영 Master 를 읽기 전용으로 읽는다(findMany 만 사용). */
async function readProductionMaster(prisma: import("@prisma/client").PrismaClient, tenant: string): Promise<ProdMaster> {
  const items = await prisma.item.findMany({ where: { tenantId: tenant }, select: { code: true, name: true, spec: true, uom: true, itemType: true, status: true, tenantId: true } })
  const boms = await prisma.bOM.findMany({
    where: { tenantId: tenant },
    select: {
      version: true,
      status: true,
      isDefault: true,
      tenantId: true,
      item: { select: { code: true } },
      bomItems: { select: { seq: true, qtyPer: true, scrapRate: true, componentItem: { select: { code: true, tenantId: true } } } },
    },
  })
  const partners = await prisma.businessPartner.findMany({ where: { tenantId: tenant } })
  const itemSuppliers = await prisma.itemSupplier.findMany({
    where: { tenantId: tenant },
    select: {
      isDefault: true,
      leadTimeDays: true,
      moq: true,
      orderMultiple: true,
      isActive: true,
      tenantId: true,
      item: { select: { code: true, tenantId: true } },
      supplier: { select: { code: true, tenantId: true, partnerType: true } },
    },
  })
  return {
    tenantId: tenant,
    items: items.map((i) => ({ code: i.code, name: i.name, spec: i.spec ?? null, uom: String(i.uom), itemType: String(i.itemType), status: String(i.status), tenantId: i.tenantId })),
    boms: boms.map((b) => ({
      itemCode: b.item?.code ?? null,
      version: b.version,
      status: String(b.status),
      isDefault: b.isDefault,
      tenantId: b.tenantId,
      lines: b.bomItems.map((l) => ({ seq: l.seq, componentCode: l.componentItem?.code ?? null, qtyPer: Number(l.qtyPer), scrapRate: Number(l.scrapRate), componentTenantId: l.componentItem?.tenantId ?? null })),
    })),
    partners: partners.map((p) => ({
      code: p.code,
      name: p.name,
      partnerType: String(p.partnerType),
      status: String(p.status),
      tenantId: p.tenantId,
      businessNumber: p.businessNumber,
      ceoName: p.ceoName,
      phone: p.phone,
      email: p.email,
      address: p.address,
      contactName: p.contactName,
      contactPhone: p.contactPhone,
    })),
    itemSuppliers: itemSuppliers.map((s) => ({
      itemCode: s.item?.code ?? null,
      supplierCode: s.supplier?.code ?? null,
      isDefault: s.isDefault,
      leadTimeDays: s.leadTimeDays,
      moq: s.moq === null ? null : Number(s.moq),
      orderMultiple: s.orderMultiple === null ? null : Number(s.orderMultiple),
      isActive: s.isActive,
      tenantId: s.tenantId,
      itemTenantId: s.item?.tenantId ?? null,
      supplierTenantId: s.supplier?.tenantId ?? null,
      supplierPartnerType: s.supplier ? String(s.supplier.partnerType) : null,
    })),
  }
}

async function auditProduction() {
  const { dataset, counts, tenant, prisma, host } = await productionContext(false)
  const xlsx = arg("xlsx")
  if (!xlsx) throw new Error("--xlsx 가 필요합니다(보완 템플릿의 원본 근거 — 검토용으로만 읽음)")
  const out = resolve(arg("out") ?? join(".master-migration-out", "final-review"))
  try {
    const { sheets, sha256 } = readWorkbookGrids(readFileSync(xlsx))
    const extraction = extractDaewonWorkbook(sheets)
    const analysis = analyzeMaster(extraction)
    const master = await readProductionMaster(prisma, tenant)

    const baseline = masterBaseline(master)
    const baselineAgain = masterBaseline({ ...master, items: master.items.slice().reverse(), boms: master.boms.slice().reverse() })
    const cmp = compareToDataset(master, dataset)
    const items = auditItems(master)
    const boms = auditBoms(master)
    const raws = rawUsage(master)
    const partners = auditPartners(master)
    const itemSuppliers = auditItemSuppliers(master)
    const coverage = coverageAndDependencies(master, analysis)

    const tx = await transactionCounts(prisma)
    const auditRows = await prisma.auditLog.findMany({ where: { tenantId: tenant, entityType: "MasterImport" }, select: { id: true, actorLabel: true, afterData: true } })
    const a = (auditRows[0]?.afterData ?? {}) as Record<string, unknown>
    const ai = (a.items ?? {}) as Record<string, number>
    const auditMatches =
      auditRows.length === 1 &&
      a.datasetHash === dataset.datasetHash &&
      ai.total === master.items.length &&
      ai.FINISHED === items.byType.FINISHED &&
      ai.RAW_MATERIAL === items.byType.RAW_MATERIAL &&
      a.boms === boms.boms &&
      a.bomItems === boms.bomItems &&
      a.customers === partners.customer &&
      a.suppliers === partners.supplier &&
      a.itemSuppliers === itemSuppliers.total

    const mrp = await syntheticMrp(prisma, tenant, 10)
    // 실제 MRP/발주제안 계산 경로(SELECT 전용)가 빈 업무 데이터에서 오류 없이 빈 결과를 내는지
    const { loadAndRunOrderMrp } = await import("../src/lib/services/mrp-order.service")
    const { computePurchaseSuggestions } = await import("../src/lib/services/mrp-purchase-suggestion.service")
    const emptyView = await loadAndRunOrderMrp(prisma, tenant, { from: null, to: null, includeDraft: false, includeScheduledReceipts: true })
    const emptySuggest = await computePurchaseSuggestions(prisma, tenant, { from: null, to: null, includeDraft: false }, { includePrices: false })
    const emptyState = {
      materials: emptyView.view.materials.length,
      demandLines: emptyView.view.kpi.demandLineCount,
      warnings: emptyView.view.warnings.length,
      suggestionRows: emptySuggest.payload.rows.length,
    }

    const rawBomLines: RawBomLineInfo[] = extraction.bomLines.map((l) => ({
      parentCode: l.parentCode,
      componentCode: l.component.raw ?? "",
      qty: l.qty,
      name: l.name,
      spec: l.spec,
      uom: l.uom,
      row: l.src.row,
    }))
    const pack = buildReviewPack({ master, analysis, coverage, rawBomLines })
    mkdirSync(out, { recursive: true })
    Object.keys(pack).forEach((f) => writeFileSync(join(out, f), pack[f], "utf8"))

    const mismatchTotal = cmp.items.MISMATCH + cmp.boms.MISMATCH + cmp.bomItems.MISMATCH + cmp.partners.MISMATCH + cmp.itemSuppliers.MISMATCH
    const missingTotal = cmp.items.MISSING + cmp.boms.MISSING + cmp.bomItems.MISSING + cmp.partners.MISSING + cmp.itemSuppliers.MISSING
    const extraTotal = cmp.items.EXTRA + cmp.boms.EXTRA + cmp.bomItems.EXTRA + cmp.partners.EXTRA + cmp.itemSuppliers.EXTRA
    const summary = {
      masterBaselineHash: baseline.hash,
      masterBaselineHashDeterministic: baseline.hash === baselineAgain.hash,
      baselineAt: new Date().toISOString(),
      approvedDatasetHash: dataset.datasetHash,
      workbookSha256: sha256,
      items: master.items.length,
      finished: items.byType.FINISHED,
      raw: items.byType.RAW_MATERIAL,
      semi: items.byType.SEMI_FINISHED,
      bom: boms.boms,
      bomItems: boms.bomItems,
      customer: partners.customer,
      supplier: partners.supplier,
      itemSupplier: itemSuppliers.total,
      expectedCounts: counts,
      bomCoverage: `${coverage.withBom}/${coverage.finished}`,
      bomCoveragePct: coverage.coveragePct,
      review: {
        finishedEnrichment: items.finishedEnrichmentRequired,
        rawMismatch: analysis.items.filter((i) => i.flags.inSettings && i.flags.isBomComponent && !master.items.some((m) => m.code === i.code)).length,
        unusedRaw: analysis.items.filter((i) => i.flags.inSettings && !i.flags.isBomComponent && !i.flags.isBomParent && !master.items.some((m) => m.code === i.code)).length,
        invalidBom: coverage.invalidParents.length,
        blockedBom: coverage.blocked.length,
        orderOnlyProducts: analysis.items.filter((i) => i.flags.orderOnly).length,
        partnerReview: partners.masterEnrichmentRequired,
      },
      transactionRows: tx,
      transactionRowsTotal: Object.values(tx).reduce((s, v) => s + v, 0),
    }
    writeFileSync(join(out, "summary.json"), JSON.stringify({ summary, dependency: coverage.dependency, blocked: coverage.blocked, compare: { items: cmp.items, boms: cmp.boms, bomItems: cmp.bomItems, partners: cmp.partners, itemSuppliers: cmp.itemSuppliers } }, null, 2), "utf8")

    console.log(
      JSON.stringify(
        {
          mode: "PRODUCTION_READ_ONLY_AUDIT",
          write: 0,
          host,
          tenant,
          summary,
          datasetCompare: {
            items: { MATCH: cmp.items.MATCH, MISMATCH: cmp.items.MISMATCH, MISSING: cmp.items.MISSING, EXTRA: cmp.items.EXTRA },
            boms: { MATCH: cmp.boms.MATCH, MISMATCH: cmp.boms.MISMATCH, MISSING: cmp.boms.MISSING, EXTRA: cmp.boms.EXTRA },
            bomItems: { MATCH: cmp.bomItems.MATCH, MISMATCH: cmp.bomItems.MISMATCH, MISSING: cmp.bomItems.MISSING, EXTRA: cmp.bomItems.EXTRA },
            partners: { MATCH: cmp.partners.MATCH, MISMATCH: cmp.partners.MISMATCH, MISSING: cmp.partners.MISSING, EXTRA: cmp.partners.EXTRA },
            itemSuppliers: { MATCH: cmp.itemSuppliers.MATCH, MISMATCH: cmp.itemSuppliers.MISMATCH, MISSING: cmp.itemSuppliers.MISSING, EXTRA: cmp.itemSuppliers.EXTRA },
            totals: { mismatchTotal, missingTotal, extraTotal },
          },
          itemIntegrity: items,
          bomIntegrity: boms,
          rawUsage: { ...raws, unusedCodes: raws.unusedCodes.length },
          coverage: { ...coverage, blocked: coverage.blocked.length, invalidParents: coverage.invalidParents.length, dependency: coverage.dependency.map((d) => ({ blockedBoms: d.blockedBoms, affectedFinished: d.affectedFinished, unlockedIfOnlyThisApproved: d.unlockedIfOnlyThisApproved })) },
          partnerIntegrity: partners,
          itemSupplierIntegrity: itemSuppliers,
          audit: { rows: auditRows.length, actor: auditRows[0]?.actorLabel ?? null, matchesDatasetAndDb: auditMatches },
          emptyState,
          mrp: { materials: mrp.materials, expectedMaterials: mrp.expectedMaterials, mismatches: mrp.requirementMismatches, demandLines: mrp.kpi.demandLineCount, requirementLines: mrp.kpi.requirementLineCount, productsWithBom: mrp.productsWithDefaultBom, excludedLines: mrp.excludedLines, write: mrp.write },
          reviewPack: { dir: out, files: Object.keys(pack).concat(["summary.json"]) },
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
  if (cmd === "import-production") return importProduction()
  if (cmd === "verify-production") return verifyProduction()
  if (cmd === "audit-production") return auditProduction()
  throw new Error("사용법: analyze | export-existing | preview | seed | verify-mrp | import-production | verify-production | audit-production")
}

main().catch((e) => {
  if (isSeedGuardError(e)) console.error("[seed guard] " + e.message)
  else if (isProductionImportGuardError(e)) console.error(`[production import guard:${e.code}] ` + e.message)
  else console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
