/**
 * Daewon 기준정보(Master) 이관 CLI — Phase 7A
 *
 *   analyze          Excel(저장된 값만) → 추출/검증/분류 → 보고서 + (SAFE/승인분) Approved Dataset. DB 쓰기 없음.
 *   export-existing  현재 MES 의 Master 현황을 읽기 전용(SELECT)으로 JSON 으로 내보낸다.
 *   seed             Approved Dataset 을 "개발/테스트 DB" 에 적용(가드 필수). 운영에는 사용 금지.
 *
 * 사용(예):
 *   npx ts-node ... scripts/master-migration.ts analyze --xlsx "<경로>" --out <출력폴더> [--existing existing.json] [--decisions decisions.json]
 *   npx ts-node ... scripts/master-migration.ts export-existing --tenant <tenantId> --out existing.json      (DATABASE_URL 필요, SELECT 만)
 *   MASTER_SEED_CONFIRM=DEV_ONLY MASTER_SEED_DATABASE_URL=<개발DB> npx ts-node ... scripts/master-migration.ts seed --dataset dataset.json [--dry-run] [--tenant <id>]
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
import { reconcileCandidates, summarize } from "../src/lib/master-migration/reconcile"
import { summarizeAnalysis, summarizeSeedDataset } from "../src/lib/master-migration/report"
import { assertDevSeedTarget, isSeedGuardError } from "../src/lib/master-migration/seed-guard"
import { buildSheetReport } from "../src/lib/master-migration/sheet-report"
import { readWorkbookGrids } from "../src/lib/master-migration/workbook"
import type { ExistingMasterSnapshot, MasterDecisions } from "../src/lib/master-migration/types"

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (name: string) => process.argv.includes(`--${name}`)

function writeJson(dir: string, name: string, value: unknown) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2), "utf8")
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
  const decisions: MasterDecisions | undefined = arg("decisions") ? JSON.parse(readFileSync(resolve(arg("decisions") as string), "utf8")) : undefined
  const dataset = buildApprovedDataset(analysis, { workbookSha256: sha256, decisions })

  // 승인 결정 템플릿: REVIEW 항목과 제안값(accept=false 로 시작 — 사람이 true 로 바꿔야 포함된다)
  const template: Record<string, Record<string, unknown>> = { items: {}, boms: {}, partners: {}, itemSuppliers: {} }
  analysis.items.forEach((i) => {
    if (i.grade === "REVIEW") {
      template.items[i.code] = { accept: false, ...i.suggestions, _issues: i.issues.map((x) => x.code) }
    }
  })
  analysis.boms.forEach((b) => {
    if (b.grade === "REVIEW") template.boms[b.parentCode] = { accept: false, _issues: b.issues.map((x) => x.code) }
  })
  analysis.partners.forEach((p) => {
    template.partners[`${p.partnerType}|${p.name}`] = { accept: false, code: "", _issues: p.issues.map((x) => x.code) }
  })

  // 일괄 정책 "미리보기"(적용 아님): 이 정책을 승인하면 데이터셋이 어떻게 되는지 건수만 계산한다
  const projected = buildApprovedDataset(analysis, {
    workbookSha256: sha256,
    decisions: {
      bulk: {
        finishedUseCodeAsName: true,
        finishedDefaultUom: "EA",
        allowMissingSpec: true,
        partnerCodeRule: { customerPrefix: "C", supplierPrefix: "S", width: 3 },
        acceptItemSuppliersOfAcceptedPartners: true,
        acceptBomsWithoutRejectedLines: true,
      },
    },
  })

  writeJson(out, "decisions.template.json", template)
  writeJson(out, "dataset.projected-policy-preview.json", projected)
  writeJson(out, "sheet-report.json", sheetReport)
  writeJson(out, "analysis.json", { analysis, structuralIssues: extraction.structuralIssues })
  writeJson(out, "dry-run-summary.json", { workbookSha256: sha256, summary, seed: summarizeSeedDataset(dataset) })
  writeJson(out, "reconcile.json", reconcileEntries ?? [])
  writeJson(out, "dataset.json", dataset)
  console.log(JSON.stringify({ workbookSha256: sha256, sheets: sheetReport.map((r) => ({ sheet: r.sheet, class: r.class, usedRows: r.usedRows, maxRow: r.maxRow, maxCol: r.maxCol, nonEmptyCells: r.nonEmptyCells, dateRange: r.dateRange, dateProbes: r.dateProbes })), summary, seedStrict: summarizeSeedDataset(dataset), seedIfBulkPolicyApproved: summarizeSeedDataset(projected), out }, null, 2))
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
      // 운영 정보(참고: Phase 7 에서 이관하지 않음)
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

async function seed() {
  const file = arg("dataset")
  if (!file) throw new Error("--dataset <dataset.json> 이 필요합니다")
  const { databaseUrl, host } = assertDevSeedTarget(process.env)
  const raw = JSON.parse(readFileSync(resolve(file), "utf8"))
  const shape = validateDatasetShape(raw)
  if (!shape.ok) throw new Error(`데이터셋 검증 실패: ${shape.reason}`)
  const tenant = arg("tenant") ?? process.env.DEFAULT_TENANT_ID
  if (!tenant) throw new Error("--tenant 또는 DEFAULT_TENANT_ID 가 필요합니다")
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const result = await applyMasterDataset(prisma, { tenantId: tenant, dataset: shape.dataset, dryRun: has("dry-run"), onConflict: "ABORT" })
    console.log(JSON.stringify({ host, dryRun: result.dryRun, aborted: result.aborted, summary: result.summary, created: result.created, conflicts: result.conflicts.length }, null, 2))
    if (result.aborted) process.exitCode = 2
  } finally {
    await prisma.$disconnect()
  }
}

async function main() {
  const cmd = process.argv[2]
  if (cmd === "analyze") return analyze()
  if (cmd === "export-existing") return exportExisting()
  if (cmd === "seed") return seed()
  throw new Error("사용법: analyze | export-existing | seed")
}

main().catch((e) => {
  if (isSeedGuardError(e)) console.error("[seed guard] " + e.message)
  else console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
