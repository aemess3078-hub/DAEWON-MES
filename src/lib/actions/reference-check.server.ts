// 기준정보 선택 일괄삭제 전용 참조 확인 헬퍼.
//
// 이 파일은 절대 "use server"를 붙이지 않는다 — Client Component에서 import하지 말 것.
// "use server" 서버 액션 파일(item.actions.ts 등)에서만 import해서 사용한다.
//
// 중요: 여기서 함수를 "값"으로 만들어(예: 화살표 함수를 배열/객체에 담아) 다른 함수의
// 인자로 전달하는 고차함수 패턴은 절대 쓰지 않는다. "use server" 파일이 이 모듈을
// import하면 webpack/SWC가 두 모듈을 같은 청크로 병합(scope hoisting)할 수 있는데,
// 이때 파일 경계와 무관하게 그 청크 안의 함수 리터럴이 서버 액션 컴파일러의 스캔
// 대상이 되어 "A 'use server' file can only export async functions" 런타임 오류가
// 날 수 있다(실제로 한 차례 겪었다). 대신 Promise.all에는 즉시 호출한 결과
// (prisma.xxx.count(...) — Promise<number> 값)만 담고, 함수 리터럴은 만들지 않는다.
// 기존 checkItemReferences(단건삭제), deleteMold 등도 전부 이 방식이며 문제된 적이 없다.

import { prisma } from "@/lib/db/prisma"
import { getCurrentUser, requireRole, type CurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"

export type ReferenceCheckResult = {
  canDelete: boolean
  reasons: string[]
}

/**
 * 기준정보 선택 일괄삭제 공통 권한: ADMIN 이상, 또는 role 계층과 무관한
 * 개발자 계정(loginId='test'). 품목관리 선택삭제에서 쓰던 정책을 그대로 재사용한다.
 */
export async function requireBulkDeletePermission(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error("UNAUTHORIZED")
  if (isDeveloperUser(user)) return user
  return requireRole("ADMIN", user)
}

/**
 * 작업지시/재고/BOM/라우팅/검사/LOT 등 이력 데이터에서 품목 사용 여부를 확인한다.
 * item.actions.ts의 단건 삭제용 checkItemReferences보다 넓은 범위를 확인한다.
 */
export async function checkItemReferencesForBulk(itemId: string, tenantId: string): Promise<ReferenceCheckResult> {
  const [
    workOrder,
    bom,
    bomComponent,
    routing,
    inventoryTxn,
    inventoryBalance,
    lot,
    inspectionSpec,
    materialReservation,
    materialConsumption,
    wipUnit,
    finishedGoodsReceipt,
    productionPlanItem,
    salesOrderItem,
    purchaseOrderItem,
    quotationItem,
    itemCost,
    engineeringChange,
    itemSubstitute,
    materialLot,
    workStandardMapping,
  ] = await Promise.all([
    prisma.workOrder.count({ where: { itemId, tenantId } }),
    prisma.bOM.count({ where: { itemId, tenantId } }),
    prisma.bOMItem.count({ where: { componentItemId: itemId } }),
    prisma.itemRouting.count({ where: { itemId, tenantId } }),
    prisma.inventoryTransaction.count({ where: { itemId, tenantId } }),
    prisma.inventoryBalance.count({ where: { itemId, tenantId, qtyOnHand: { not: 0 } } }),
    prisma.lot.count({ where: { itemId, tenantId } }),
    prisma.inspectionSpec.count({ where: { itemId, tenantId } }),
    prisma.materialReservation.count({ where: { itemId } }),
    prisma.materialConsumption.count({ where: { itemId } }),
    prisma.wipUnit.count({ where: { itemId, tenantId } }),
    prisma.finishedGoodsReceipt.count({ where: { itemId, tenantId } }),
    prisma.productionPlanItem.count({ where: { itemId } }),
    prisma.salesOrderItem.count({ where: { itemId } }),
    prisma.purchaseOrderItem.count({ where: { itemId } }),
    prisma.quotationItem.count({ where: { itemId } }),
    prisma.itemCost.count({ where: { itemId, tenantId } }),
    prisma.engineeringChange.count({ where: { targetItemId: itemId, tenantId } }),
    prisma.itemSubstitute.count({ where: { OR: [{ itemId }, { substituteItemId: itemId }] } }),
    prisma.workOrderMaterialLot.count({ where: { materialItemId: itemId, tenantId } }),
    prisma.workStandardMapping.count({ where: { itemId, tenantId } }),
  ])

  const reasons: string[] = []
  if (workOrder > 0) reasons.push(`작업지시 ${workOrder}건`)
  if (bom > 0) reasons.push(`BOM ${bom}건`)
  if (bomComponent > 0) reasons.push(`BOM 구성품 ${bomComponent}건`)
  if (routing > 0) reasons.push(`라우팅 ${routing}건`)
  if (inventoryTxn > 0) reasons.push(`재고입출고 이력 ${inventoryTxn}건`)
  if (inventoryBalance > 0) reasons.push(`재고 보유 ${inventoryBalance}건`)
  if (lot > 0) reasons.push(`LOT ${lot}건`)
  if (inspectionSpec > 0) reasons.push(`검사 규격 ${inspectionSpec}건`)
  if (materialReservation > 0) reasons.push(`자재예약 ${materialReservation}건`)
  if (materialConsumption > 0) reasons.push(`자재소비 이력 ${materialConsumption}건`)
  if (wipUnit > 0) reasons.push(`WIP 이력 ${wipUnit}건`)
  if (finishedGoodsReceipt > 0) reasons.push(`완성품입고 ${finishedGoodsReceipt}건`)
  if (productionPlanItem > 0) reasons.push(`생산계획 ${productionPlanItem}건`)
  if (salesOrderItem > 0) reasons.push(`판매주문 ${salesOrderItem}건`)
  if (purchaseOrderItem > 0) reasons.push(`구매주문 ${purchaseOrderItem}건`)
  if (quotationItem > 0) reasons.push(`견적 ${quotationItem}건`)
  if (itemCost > 0) reasons.push(`원가정보 ${itemCost}건`)
  if (engineeringChange > 0) reasons.push(`ECN ${engineeringChange}건`)
  if (itemSubstitute > 0) reasons.push(`대체품 설정 ${itemSubstitute}건`)
  if (materialLot > 0) reasons.push(`자재LOT 사용 ${materialLot}건`)
  if (workStandardMapping > 0) reasons.push(`작업표준서 매핑 ${workStandardMapping}건`)

  return { canDelete: reasons.length === 0, reasons }
}

/**
 * 로케이션관리(실제 모델은 Warehouse) 선택 일괄삭제 참조 확인.
 * warehouseId를 참조하는 모든 FK(세부 로케이션/품목 기본창고/재고/입출고이력/WIP/완성품입고/출하)를 확인한다.
 */
export async function checkWarehouseReferencesForBulk(warehouseId: string, tenantId: string): Promise<ReferenceCheckResult> {
  const [
    location,
    defaultForItems,
    inventoryBalance,
    inventoryTxn,
    wipCurrent,
    wipMovement,
    finishedGoodsReceipt,
    shipment,
  ] = await Promise.all([
    prisma.location.count({ where: { warehouseId } }),
    prisma.item.count({ where: { defaultWarehouseId: warehouseId, tenantId } }),
    prisma.inventoryBalance.count({ where: { warehouseId, tenantId } }),
    prisma.inventoryTransaction.count({ where: { tenantId, OR: [{ fromLocationId: warehouseId }, { toLocationId: warehouseId }] } }),
    prisma.wipUnit.count({ where: { currentWarehouseId: warehouseId, tenantId } }),
    prisma.wipMovement.count({ where: { tenantId, OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] } }),
    prisma.finishedGoodsReceipt.count({ where: { warehouseId, tenantId } }),
    prisma.shipmentOrder.count({ where: { warehouseId, tenantId } }),
  ])

  const reasons: string[] = []
  if (location > 0) reasons.push(`세부 로케이션 ${location}건`)
  if (defaultForItems > 0) reasons.push(`기본 입고창고로 지정된 품목 ${defaultForItems}건`)
  if (inventoryBalance > 0) reasons.push(`재고 보유 ${inventoryBalance}건`)
  if (inventoryTxn > 0) reasons.push(`재고입출고 이력 ${inventoryTxn}건`)
  if (wipCurrent > 0) reasons.push(`WIP 현재위치 ${wipCurrent}건`)
  if (wipMovement > 0) reasons.push(`WIP 이동이력 ${wipMovement}건`)
  if (finishedGoodsReceipt > 0) reasons.push(`완성품입고 ${finishedGoodsReceipt}건`)
  if (shipment > 0) reasons.push(`출하 ${shipment}건`)

  return { canDelete: reasons.length === 0, reasons }
}


/**
 * 작업장(WorkCenter) 삭제 참조 확인.
 * 실제 FK lineage를 가진 라우팅 공정/설비/WIP 현재위치/WIP 이동이력을 확인한다.
 */
export async function checkWorkCenterReferencesForBulk(workCenterId: string, tenantId: string): Promise<ReferenceCheckResult> {
  const [routingOperation, equipment, wipCurrent, wipMovement] = await Promise.all([
    prisma.routingOperation.count({ where: { workCenterId } }),
    prisma.equipment.count({ where: { workCenterId, tenantId } }),
    prisma.wipUnit.count({ where: { currentWorkCenterId: workCenterId, tenantId } }),
    prisma.wipMovement.count({ where: { tenantId, OR: [{ fromWorkCenterId: workCenterId }, { toWorkCenterId: workCenterId }] } }),
  ])

  const reasons: string[] = []
  if (routingOperation > 0) reasons.push(`라우팅 공정 ${routingOperation}건`)
  if (equipment > 0) reasons.push(`설비 ${equipment}건`)
  if (wipCurrent > 0) reasons.push(`WIP 현재공정 ${wipCurrent}건`)
  if (wipMovement > 0) reasons.push(`WIP 이동이력 ${wipMovement}건`)

  return { canDelete: reasons.length === 0, reasons }
}
/** 불량관리(DefectCode) 선택 일괄삭제 참조 확인. */
export async function checkDefectCodeReferencesForBulk(defectCodeId: string): Promise<ReferenceCheckResult> {
  const defectRecord = await prisma.defectRecord.count({ where: { defectCodeId } })

  const reasons: string[] = []
  if (defectRecord > 0) reasons.push(`불량이력 ${defectRecord}건`)

  return { canDelete: reasons.length === 0, reasons }
}

/** 비가동사유관리(CommonCode, groupCode='DOWNTIME_REASON') 선택 일괄삭제 참조 확인. */
export async function checkDowntimeReasonReferencesForBulk(downtimeReasonId?: string): Promise<ReferenceCheckResult> {
  if (!downtimeReasonId) return { canDelete: true, reasons: [] }
  const downtime = await prisma.equipmentDowntime.count({ where: { reasonId: downtimeReasonId } })
  const reasons: string[] = []
  if (downtime > 0) reasons.push(`비가동 이력 ${downtime}건`)
  return { canDelete: reasons.length === 0, reasons }
}
/**
 * 금형/치공구관리(Equipment, equipmentType in TOOL/JIG/FIXTURE) 선택 일괄삭제 참조 확인.
 * 기존 단건삭제(deleteMold)보다 넓은 범위(설비-공정 매핑/작업지시 공정/설비연결/설비이벤트/
 * 수리요청/일상점검/작업배정)를 확인한다.
 */
export async function checkMoldReferencesForBulk(equipmentId: string, tenantId: string): Promise<ReferenceCheckResult> {
  const [
    operationMap,
    workOrderOperation,
    connection,
    event,
    repairRequest,
    dailyCheck,
    assignment,
  ] = await Promise.all([
    prisma.equipmentOperationMap.count({ where: { equipmentId } }),
    prisma.workOrderOperation.count({ where: { equipmentId } }),
    prisma.equipmentConnection.count({ where: { equipmentId } }),
    prisma.equipmentEvent.count({ where: { equipmentId } }),
    prisma.equipmentRepairRequest.count({ where: { equipmentId, tenantId } }),
    prisma.equipmentDailyCheck.count({ where: { equipmentId, tenantId } }),
    prisma.workOrderOperationAssignment.count({ where: { equipmentId, tenantId } }),
  ])

  const reasons: string[] = []
  if (operationMap > 0) reasons.push(`설비-공정 매핑 ${operationMap}건`)
  if (workOrderOperation > 0) reasons.push(`작업지시 공정 ${workOrderOperation}건`)
  if (connection > 0) reasons.push(`설비연결 설정 ${connection}건`)
  if (event > 0) reasons.push(`설비이벤트 ${event}건`)
  if (repairRequest > 0) reasons.push(`수리요청 ${repairRequest}건`)
  if (dailyCheck > 0) reasons.push(`일상점검 ${dailyCheck}건`)
  if (assignment > 0) reasons.push(`작업배정 ${assignment}건`)

  return { canDelete: reasons.length === 0, reasons }
}

/**
 * 품목분류관리(ItemCategory) 선택 일괄삭제 참조 확인.
 * 기존 단건삭제(deleteItemCategory)와 동일한 2개 참조(품목/품목군)를 확인한다.
 */
export async function checkItemCategoryReferencesForBulk(categoryId: string, tenantId: string): Promise<ReferenceCheckResult> {
  const [item, itemGroup] = await Promise.all([
    prisma.item.count({ where: { categoryId, tenantId } }),
    prisma.itemGroup.count({ where: { categoryId, tenantId } }),
  ])

  const reasons: string[] = []
  if (item > 0) reasons.push(`품목 ${item}건`)
  if (itemGroup > 0) reasons.push(`품목군 ${itemGroup}건`)

  return { canDelete: reasons.length === 0, reasons }
}

/**
 * 품목군관리(ItemGroup) 선택 일괄삭제 참조 확인.
 * 기존 단건삭제(deleteItemGroup)와 동일한 참조(품목)를 확인한다.
 */
export async function checkItemGroupReferencesForBulk(itemGroupId: string, tenantId: string): Promise<ReferenceCheckResult> {
  const item = await prisma.item.count({ where: { itemGroupId, tenantId } })

  const reasons: string[] = []
  if (item > 0) reasons.push(`품목 ${item}건`)

  return { canDelete: reasons.length === 0, reasons }
}
