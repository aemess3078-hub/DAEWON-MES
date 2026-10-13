import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = process.cwd()
let passed = 0

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8")
}

function ok(value: unknown, message: string) {
  assert.ok(value, message)
  passed += 1
  console.log(`PASS ${message}`)
}

const schema = read("prisma/schema.prisma")
const popActions = read("src/lib/actions/pop.actions.ts")
const productionClient = read("src/app/pop/production/[operationId]/production-client.tsx")
const workQueueClient = read("src/app/app/pop/work-queue/work-queue-client.tsx")
const packageJson = read("package.json")

ok(schema.includes("productionResultId   String?"), "EquipmentUsageHistory links to ProductionResult with a nullable field")
ok(schema.includes("productionResult   ProductionResult?   @relation(fields: [productionResultId], references: [id], onDelete: SetNull)"), "tool usage keeps manual histories valid by using optional SetNull relation")
ok(schema.includes("equipmentUsageHistories      EquipmentUsageHistory[]"), "ProductionResult exposes linked tool usage histories")
ok(!schema.includes("requiredTool"), "F18 does not introduce a requiredTool flag")

ok(popActions.includes("toolIds?: string[]"), "submitProductionResult accepts optional selected tool ids")
ok(popActions.includes("if (args.toolIds.length === 0) return"), "server action treats missing tool selection as 사용 안 함")
ok(popActions.includes("operationMaps: { some: { routingOperationId: args.routingOperationId } }"), "selected tool must be planned/available for the operation")
ok(popActions.includes("status: \"ACTIVE\""), "selected tool must be active before actual usage is recorded")
ok(popActions.includes("siteId: args.siteId"), "selected tool is constrained to the work order site")
ok(popActions.includes("productionResultId: args.productionResultId"), "created ToolUsage is tied to the exact ProductionResult")
ok(popActions.includes("currentUsage: { increment: usageCount }"), "selected tool increments currentUsage in the same transaction")
ok(popActions.includes("selectedToolIds = normalizePopToolIds(data.toolIds)"), "server normalizes duplicate selected tool ids")
ok(!/recordPopToolUsage\(tx,[\s\S]*toolIds:\s*operation\.routingOperation/.test(popActions), "operation mapped tools are not automatically converted to actual usage")

ok(productionClient.includes("const [selectedToolIds, setSelectedToolIds] = useState<string[]>([])"), "POP production detail defaults to no actual tool selected")
ok(productionClient.includes("사용 안 함"), "POP production detail exposes explicit 사용 안 함 option")
ok(productionClient.includes("toolIds: selectedToolIds"), "POP production detail submits only user-selected tools")
ok(productionClient.includes("선택하지 않으면 공구 사용이력과 수명 사용량을 남기지 않습니다."), "POP detail explains the optional tool policy")

ok(workQueueClient.includes("toolIds: []"), "POP work queue inline form defaults to no actual tool selected")
ok(workQueueClient.includes("toolIds: form.toolIds"), "POP work queue submits only selected tools")
ok(workQueueClient.includes("미선택 시 공구 이력/수명은 변경되지 않습니다."), "POP work queue explains the optional tool policy")

ok(packageJson.includes("test:pop-tool-usage-integrity"), "package script includes F18 POP tool usage integrity test")

console.log(`\n${passed} POP tool usage integrity checks passed.`)
// Execute the actual Server Action with isolated transaction/auth adapters. No live data is changed.
import { transpileModule, ModuleKind } from "typescript"
import { runInNewContext } from "node:vm"
import * as toolHelpers from "../src/lib/actions/tool.helpers"
import * as prismaTypes from "@prisma/client"

async function runActionScenarios() {
  let state = { results: [] as any[], histories: [] as any[], counts: {} as Record<string, number> }
  let failAfterUsage = false
  let toolReads = 0
  const tools = ["TOOL-A", "TOOL-B", "JIG-01", "FIXTURE-01"].map(id => ({
    id, tenantId: "tenant", siteId: "site", status: "ACTIVE", routingOperationId: "routing",
    equipmentType: id.startsWith("JIG") ? "JIG" : id.startsWith("FIXTURE") ? "FIXTURE" : "TOOL",
  }))
  tools.push({ ...tools[0], id: "OTHER-TENANT", tenantId: "other" },
    { ...tools[0], id: "OTHER-SITE", siteId: "other" },
    { ...tools[0], id: "OTHER-OP", routingOperationId: "other" },
    { ...tools[0], id: "DISCARDED", status: "DISCARDED" })
  let withAssignment = false
  const operation = () => ({
    id: "op", status: "IN_PROGRESS", completedQty: 0, plannedQty: 1000,
    startedAt: new Date(0), workOrderId: "wo", seq: 1, routingOperationId: "routing",
    routingOperation: { workCenterId: "wc", equipmentMaps: tools },
    assignments: withAssignment ? [{ id: "assignment", tenantId: "tenant", workOrderOperationId: "op",
      assignedQty: 1000, completedQty: 0, status: "IN_PROGRESS", startedAt: new Date(0) }] : [],
    workOrder: { tenantId: "tenant", siteId: "site", itemId: "item", status: "IN_PROGRESS", operations: [] },
  })
  const db = { $transaction: async (callback: (tx: any) => Promise<void>) => {
    const draft = structuredClone(state)
    const tx = {
      tenantUser: { findFirst: async () => ({ id: "worker" }) },
      workOrderOperation: { findUnique: async () => operation(), update: async () => ({}) },
      workOrderOperationAssignment: { update: async () => ({}), findMany: async () => [{ status: "IN_PROGRESS" }] },
      productionResult: { findFirst: async () => null, create: async ({ data }: any) => {
        const result = { id: `result-${draft.results.length}`, ...data }; draft.results.push(result); return result
      } },
      equipment: {
        findMany: async ({ where }: any) => { toolReads++; return tools.filter(t =>
          where.id.in.includes(t.id) && t.tenantId === where.tenantId && t.siteId === where.siteId &&
          t.status === where.status && where.equipmentType.in.includes(t.equipmentType) &&
          t.routingOperationId === where.operationMaps.some.routingOperationId) },
        update: async ({ where, data }: any) => { draft.counts[where.id] = (draft.counts[where.id] ?? 0) + data.currentUsage.increment },
      },
      equipmentUsageHistory: { createMany: async ({ data }: any) => { draft.histories.push(...data) } },
    }
    await callback(tx)
    state = draft
  } }
  const noop = () => undefined
  const dependencies: Record<string, any> = {
    "@/lib/db/prisma": { prisma: db },
    "@prisma/client": prismaTypes,
    "next/cache": { revalidatePath: noop },
    "@/lib/auth": { requireRole: async () => { throw new Error("TOOL management unavailable") } },
    "@/lib/auth/pop-worker-session": { getPopWorkerSession: async () => ({ tenantId: "tenant", siteId: "site", profileId: "worker", tenantUserId: "tu" }) },
    "@/lib/auth/pop-pin": {},
    "@/lib/actions/tool.helpers": toolHelpers,
    "@/lib/pop-work-standard.server": { getWorkStandardsForOperationContext: async () => [] },
    "@/lib/actions/wip-traceability.helpers": { findActiveWipUnitForWorkOrder: async () => null,
      recordProductionResultQualityMovements: async () => { if (failAfterUsage) throw new Error("downstream failure") } },
    "@/lib/actions/self-inspection.helpers": { recordSelfInspectionDefects: noop },
    "@/lib/actions/production-plan.actions": {},
    "@/lib/operation-status-integrity": { assertOperationResultAllowed: noop },
    "@/lib/pop-worktime-operator": { resolveProductionResultTime: ({ endedAt }: any) => ({ startedAt: new Date(0), endedAt }) },
    "@/lib/bom-material-sufficiency": { getWorkOrderMaterialSufficiency: async () => ({}), assertProductionQuantityWithinMaterialLimit: noop },
    "@/lib/quantity-concurrency": { lockWorkOrderOperationForUpdate: noop },
  }
  const exported: any = {}
  runInNewContext(transpileModule(popActions, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText,
    { exports: exported, require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unmocked dependency: ${name}`)
      return dependencies[name]
    }, console, Date, BigInt, Set, Map })
  const submit = (toolIds?: string[], goodQty = 30, extra = {}) => exported.submitProductionResult({
    workOrderOperationId: "op", goodQty, defectQty: 0, reworkQty: 0, toolIds,
    ...(withAssignment ? { assignmentId: "assignment" } : {}), ...extra,
  })
  ok((await submit()).success, "actual action: no tool creates ProductionResult without TOOL management permission")
  ok(state.results.length === 1 && state.histories.length === 0, "no selection creates zero usage histories despite planned tools")
  ok(Object.keys(state.counts).length === 0 && toolReads === 0, "no selection does not read or update tool life")
  ok((await submit(["TOOL-A"])).success, "later TOOL-A selection succeeds")
  ok(state.counts["TOOL-A"] === 1 && state.histories[0].productionResultId === state.results[1].id, "TOOL-A starts usage only at its selected result")
  ok((await submit(["TOOL-B"], 20)).success && state.counts["TOOL-B"] === 1 && state.counts["TOOL-A"] === 1, "tool switch attributes separate results and counts one use per segment")
  ok((await submit(["TOOL-A", "TOOL-A", "JIG-01", "FIXTURE-01"], 0.5)).success, "duplicate ids deduplicate; multiple tool types and fractional production quantity remain valid")
  ok(state.counts["TOOL-A"] === 2 && state.counts["JIG-01"] === 1 && state.counts["FIXTURE-01"] === 1, "all selected types retain count-based usage")
  for (const id of ["OTHER-TENANT", "OTHER-SITE", "OTHER-OP", "DISCARDED"]) {
    const before = JSON.stringify(state)
    ok(!(await submit([id])).success && JSON.stringify(state) === before, `${id} rejects and rolls back the ProductionResult`)
  }
  const before = JSON.stringify(state)
  failAfterUsage = true
  ok(!(await submit(["TOOL-A"])).success && JSON.stringify(state) === before, "downstream failure rolls back result, usage and life together")
  failAfterUsage = false
  ok((await submit(["TOOL-A"])).success && state.counts["TOOL-A"] === 3, "retry after rollback records exactly one successful usage")
  withAssignment = true
  ok((await submit([])).success, "equipment assignment path also supports no tool")
  ok((await submit(["TOOL-B"], 2, { defectQty: 1, reworkQty: 1, defectDetails: [{ defectCodeId: "defect", qty: 1 }] })).success, "mixed good/defect/rework result records one selected-tool use")
  const last = state.results[state.results.length - 1]
  const history = state.histories[state.histories.length - 1]
  ok(last.workOrderOperationAssignmentId === "assignment" && history.productionResultId === last.id &&
    history.operatorId === last.operatorId && history.usedAt.getTime() === last.endedAt.getTime(), "F09 assignment and F04 worker/time remain traceable from usage through result")
}

runActionScenarios().then(() => console.log(`\n${passed} total F18 checks passed.`)).catch(error => {
  console.error(error); process.exitCode = 1
})
