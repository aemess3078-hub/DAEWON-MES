import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { InspectionResult, InspectionStage } from "@prisma/client"
import {
  assertLotQualityReleaseAllowed,
  getWorkOrderLotQualityReleaseStatus,
} from "../src/lib/actions/quality-release-gate.helpers"

let passed = 0
function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    passed += 1
    console.log(`PASS ${passed}: ${name}`)
  })
}

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8")
}

const finalOp = (inspections: any[]) => ({
  id: "op-final",
  routingOperationId: "routing-op-final",
  qualityInspections: inspections,
})

function mockDb(inspections: any[], receipts: Array<{ workOrderId: string }> = [{ workOrderId: "wo-1" }]) {
  return {
    workOrder: {
      findFirst: async () => ({
        itemId: "item-fg",
        operations: [finalOp(inspections)],
      }),
    },
    inspectionSpec: {
      findFirst: async () => ({ id: "spec-final" }),
    },
    finishedGoodsReceipt: {
      findMany: async () => receipts,
    },
  } as any
}

const inspection = (id: string, lotId: string | null, result: InspectionResult | null, minute: number) => ({
  id,
  lotId,
  inspectionSpecId: "spec-final",
  stage: InspectionStage.FINAL,
  result,
  inspectedAt: new Date(`2026-09-08T00:${String(minute).padStart(2, "0")}:00.000Z`),
})

async function main() {
  await check("LOT별 검사가 없으면 기존 작업지시 기준 최종 PASS를 legacy fallback으로 허용한다", async () => {
    const status = await getWorkOrderLotQualityReleaseStatus(mockDb([inspection("legacy-pass", null, InspectionResult.PASS, 1)]), {
      tenantId: "tenant-a",
      workOrderId: "wo-1",
      lotId: "lot-a",
    })
    assert.equal(status.inspectionResult, InspectionResult.PASS)
  })

  await check("같은 작업지시에서 LOT-A PASS는 LOT-B 출하 승인으로 재사용되지 않는다", async () => {
    const db = mockDb([inspection("lot-a-pass", "lot-a", InspectionResult.PASS, 1)])
    const status = await getWorkOrderLotQualityReleaseStatus(db, { tenantId: "tenant-a", workOrderId: "wo-1", lotId: "lot-b" })
    assert.equal(status.inspectionStatus, "NOT_INSPECTED")
    await assert.rejects(
      () => assertLotQualityReleaseAllowed(db, { tenantId: "tenant-a", lotId: "lot-b" }),
      /최종검사를 완료/,
    )
  })

  await check("같은 작업지시에서 LOT-A PASS와 LOT-B FAIL은 서로 분리되어 판정된다", async () => {
    const db = mockDb([
      inspection("lot-a-pass", "lot-a", InspectionResult.PASS, 1),
      inspection("lot-b-fail", "lot-b", InspectionResult.FAIL, 2),
    ])
    const lotA = await getWorkOrderLotQualityReleaseStatus(db, { tenantId: "tenant-a", workOrderId: "wo-1", lotId: "lot-a" })
    const lotB = await getWorkOrderLotQualityReleaseStatus(db, { tenantId: "tenant-a", workOrderId: "wo-1", lotId: "lot-b" })
    assert.equal(lotA.inspectionResult, InspectionResult.PASS)
    assert.equal(lotB.inspectionResult, InspectionResult.FAIL)
    await assert.doesNotReject(() => assertLotQualityReleaseAllowed(db, { tenantId: "tenant-a", lotId: "lot-a" }))
    await assert.rejects(
      () => assertLotQualityReleaseAllowed(db, { tenantId: "tenant-a", lotId: "lot-b" }),
      /불합격 제품은 출하/,
    )
  })

  await check("LOT별 재검사는 최신 판정을 사용한다", async () => {
    const status = await getWorkOrderLotQualityReleaseStatus(mockDb([
      inspection("old-fail", "lot-a", InspectionResult.FAIL, 1),
      inspection("new-pass", "lot-a", InspectionResult.PASS, 2),
    ]), { tenantId: "tenant-a", workOrderId: "wo-1", lotId: "lot-a" })
    assert.equal(status.inspectionId, "new-pass")
    assert.equal(status.inspectionResult, InspectionResult.PASS)
  })

  const schema = read("prisma/schema.prisma")
  const inspectionHelper = read("src/lib/actions/quality-inspection-integrity.helpers.ts")
  const qualityActions = read("src/lib/actions/quality.actions.ts")
  const stageActions = read("src/lib/actions/inspection-stages.actions.ts")
  const receiptActions = read("src/lib/actions/finished-goods.actions.ts")
  const shipmentActions = read("src/lib/actions/shipment.actions.ts")
  const lineageActions = read("src/lib/actions/lot-lineage.actions.ts")
  const traceabilityClient = read("src/app/app/mes/traceability/traceability-client.tsx")

  await check("QualityInspection은 Lot.id를 nullable FK로 직접 참조한다", () => {
    assert.match(schema, /model QualityInspection[\s\S]*lotId\s+String\?/) 
    assert.match(schema, /lot\s+Lot\?\s+@relation\(fields: \[lotId\], references: \[id\]\)/)
  })

  await check("QualityInspection lotId에는 단일 조회와 시계열 조회 인덱스가 있다", () => {
    assert.match(schema, /@@index\(\[lotId\]\)/)
    assert.match(schema, /@@index\(\[lotId, inspectedAt\]\)/)
  })

  await check("검사 생성 정본 validator가 LOT tenant와 품목 일치를 검증한다", () => {
    assert.match(inspectionHelper, /client\.lot\.findFirst\([\s\S]*where: \{ id: data\.lotId, tenantId \}/)
    assert.match(inspectionHelper, /lot\.itemId !== operation\.workOrder\.itemId/)
  })

  await check("일반 QualityInspection 생성은 validator가 확정한 lotId만 저장한다", () => {
    assert.match(qualityActions, /validatedLotId/)
    assert.match(qualityActions, /lotId: validatedLotId/)
  })

  await check("inspection-stages 우회 생성 경로도 같은 validator와 lotId 저장을 사용한다", () => {
    assert.match(stageActions, /validateInspectionMutationContext/)
    assert.match(stageActions, /lotId: validatedLotId/)
  })

  await check("완제품입고는 기존 LOT가 지정되면 LOT별 release gate를 호출한다", () => {
    assert.match(receiptActions, /assertWorkOrderLotQualityReleaseAllowed\(tx/)
    assert.match(receiptActions, /selectedLot\.itemId !== workOrder\.itemId/)
  })

  await check("출하는 LOT별 release gate를 보존한다", () => {
    assert.match(shipmentActions, /assertLotQualityReleaseAllowed\(tx, \{ tenantId, lotId: lot\.id \}\)/)
  })

  await check("추적 조회는 기준 LOT를 tenantId와 Lot.id로 고정한다", () => {
    assert.match(lineageActions, /where: \{ tenantId, lotNo: \{ contains: query \} \}/)
    assert.match(lineageActions, /lotId: lot\.id/)
  })

  await check("자재 LOT → 작업지시는 WorkOrderMaterialLot 문자열이 아니라 InventoryTransaction.lotId 경로로 연결한다", () => {
    assert.match(lineageActions, /workOrderMaterialLot\.findMany\([\s\S]*inventoryTransaction: \{ lotId: lot\.id \}/)
  })

  await check("완제품 LOT → 입고는 FinishedGoodsReceipt.lotId로 연결한다", () => {
    assert.match(lineageActions, /finishedGoodsReceipt\.findMany\([\s\S]*lotId: lot\.id/)
  })

  await check("완제품 LOT → 출하는 ShipmentItem.lotId로 연결하고 PLANNED와 SHIPPED 상태를 섞지 않는다", () => {
    assert.match(lineageActions, /shipmentItem\.findMany\([\s\S]*lotId: lot\.id/)
    assert.match(traceabilityClient, /PLANNED: "예약"/)
    assert.match(traceabilityClient, /SHIPPED: "실출하"/)
  })

  await check("LOT 직접 귀속 검사가 없을 때만 작업지시 기준 legacy 검사를 별도 표시한다", () => {
    assert.match(lineageActions, /inspections\.length === 0/)
    assert.match(lineageActions, /lotId: null/)
    assert.match(traceabilityClient, /작업지시 기준 이력/)
  })

  await check("추적 화면은 연결 없는 이력을 추정하지 않는다고 명시한다", () => {
    assert.match(traceabilityClient, /LOT 번호\/일자\/품목명으로 생산이력을 추정 연결하지 않습니다/)
  })

  await check("조회 결과에는 공정, 생산실적, 작업자, 설비가 포함된다", () => {
    assert.match(lineageActions, /productionResults/)
    assert.match(lineageActions, /operator/)
    assert.match(lineageActions, /equipment/)
    assert.match(traceabilityClient, /작업자/)
    assert.match(traceabilityClient, /설비/)
  })

  await check("조회 결과에는 검사 측정값이 포함된다", () => {
    assert.match(lineageActions, /measurements/)
    assert.match(traceabilityClient, /inspection\.measurements/)
  })

  await check("조회 결과에는 Defect → 원인분석 → 시정조치 → 재발방지 이력이 포함된다", () => {
    assert.match(lineageActions, /causeAnalysis/)
    assert.match(lineageActions, /correctiveActions/)
    assert.match(lineageActions, /recurrencePreventions/)
  })

  await check("비 LOT 추적 품목은 추적 대상 아님으로 표시한다", () => {
    assert.match(lineageActions, /isTraceTarget: lot\.item\.isLotTracked/)
    assert.match(traceabilityClient, /LOT 추적 대상 아님/)
  })

  await check("F12는 중복 메뉴를 만들지 않고 기존 traceability client를 확장한다", () => {
    assert.ok(!lineageActions.includes("manufacturing-traceability"))
    assert.match(traceabilityClient, /getLotLineageByNo/)
  })

  console.log(`lot lineage integrity: ${passed}/${passed} PASS`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})