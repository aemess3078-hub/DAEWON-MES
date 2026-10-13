export type OperationStatusValue = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED"
export type WorkOrderStatusValue = "DRAFT" | "RELEASED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
export type WipStatusValue =
  | "WAITING"
  | "IN_PROCESS"
  | "ON_HOLD"
  | "OUTSOURCED"
  | "IN_TRANSIT"
  | "RECEIVED"
  | "COMPLETED"
  | "SCRAPPED"
  | "REWORK"

export const OPERATION_RESULT_REQUIRED_MESSAGE =
  "생산실적을 등록해야 공정을 완료할 수 있습니다."
export const MATERIAL_NOT_ISSUED_MESSAGE =
  "자재출고 후 작업을 시작할 수 있습니다."
export const PREVIOUS_OPERATION_NOT_COMPLETED_MESSAGE =
  "선행공정이 완료되지 않아 작업을 시작할 수 없습니다."

type OperationStartInput = {
  operationStatus: OperationStatusValue
  workOrderStatus: WorkOrderStatusValue
  previousOperationStatuses: OperationStatusValue[]
  materialIssuanceReady: boolean
  wipStatus: WipStatusValue | null
}

export function assertOperationStartAllowed(input: OperationStartInput): void {
  if (!(["PENDING", "IN_PROGRESS"] as OperationStatusValue[]).includes(input.operationStatus)) {
    throw new Error("대기 또는 진행중 공정만 시작할 수 있습니다.")
  }
  if (!(["RELEASED", "IN_PROGRESS"] as WorkOrderStatusValue[]).includes(input.workOrderStatus)) {
    throw new Error("작업대기 또는 진행중 작업지시의 공정만 시작할 수 있습니다.")
  }
  if (!input.previousOperationStatuses.every((status) => status === "COMPLETED")) {
    throw new Error(PREVIOUS_OPERATION_NOT_COMPLETED_MESSAGE)
  }
  if (!input.materialIssuanceReady || input.wipStatus == null) {
    throw new Error(MATERIAL_NOT_ISSUED_MESSAGE)
  }
  if (input.wipStatus === "ON_HOLD") {
    throw new Error(
      "보류 중인 재공품입니다. 재작업/보류관리에서 보류를 해제한 후 작업을 시작해 주세요."
    )
  }
  if (!(input.wipStatus === "WAITING" || input.wipStatus === "IN_PROCESS")) {
    throw new Error("현재 재공 상태에서는 일반 공정을 시작할 수 없습니다.")
  }
}

export function assertOperationResultAllowed(input: {
  operationStatus: OperationStatusValue
  previousOperationStatuses: OperationStatusValue[]
  materialIssuanceReady: boolean
  wipStatus: WipStatusValue | null
}): void {
  if (input.operationStatus !== "IN_PROGRESS") {
    throw new Error("작업시작 후 실적을 등록해 주세요.")
  }
  if (!input.previousOperationStatuses.every((status) => status === "COMPLETED")) {
    throw new Error("이전 공정이 완료되지 않아 실적을 등록할 수 없습니다.")
  }
  if (!input.materialIssuanceReady || input.wipStatus == null) {
    throw new Error(MATERIAL_NOT_ISSUED_MESSAGE)
  }
  if (input.wipStatus === "ON_HOLD") {
    throw new Error(
      "보류 중인 재공품입니다. 재작업/보류관리에서 보류를 해제한 후 실적을 등록해 주세요."
    )
  }
  if (input.wipStatus !== "IN_PROCESS") {
    throw new Error("현재 재공 상태에서는 생산실적을 등록할 수 없습니다.")
  }
}

export function assertDirectOperationStatusRequestAllowed(
  currentStatus: OperationStatusValue,
  requestedStatus: OperationStatusValue
): void {
  if (requestedStatus === "COMPLETED") {
    throw new Error(OPERATION_RESULT_REQUIRED_MESSAGE)
  }
  if (requestedStatus !== "IN_PROGRESS") {
    throw new Error("지원하지 않는 공정 상태변경입니다.")
  }
  if (!(currentStatus === "PENDING" || currentStatus === "IN_PROGRESS")) {
    throw new Error("완료되거나 건너뛴 공정은 다시 시작할 수 없습니다.")
  }
}
