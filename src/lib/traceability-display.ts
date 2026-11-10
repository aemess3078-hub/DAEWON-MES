/**
 * 제조 이력추적 화면 표시용 순수 헬퍼 (DB/React 의존 없음).
 * - 외주·재공 이동 이력의 영문 코드를 업무 한글로 변환
 * - 생산실적(startedAt/endedAt) 기반 작업시작·완료시간 계산 및 표시
 * 저장된 데이터는 읽기만 하며, 기록이 없는 시간은 만들어내지 않는다.
 */

export const OUTSOURCING_INSPECTION_SOURCE = "OutsourcingInspection"

export type TraceabilityLabelTone = "cyan" | "emerald" | "red" | "orange" | "purple" | "rose" | "default"

export type MovementLabel = { label: string; tone: TraceabilityLabelTone }

/** 이동 이력 라벨 톤 → 배지 색상 (두 이력추적 화면 공통) */
export const MOVEMENT_TONE_CLASS: Record<TraceabilityLabelTone, string> = {
  cyan: "bg-cyan-100 text-cyan-700",
  emerald: "bg-emerald-100 text-emerald-700",
  red: "bg-red-100 text-red-700",
  orange: "bg-orange-100 text-orange-700",
  purple: "bg-purple-100 text-purple-700",
  rose: "bg-rose-100 text-rose-700",
  default: "bg-slate-100 text-slate-700",
}

// ─── 그 외 코드값 한글 표시(두 이력추적 화면 공통, 알 수 없는 값은 원문 유지) ─────────────────────
const lookup = (map: Record<string, string>, code: string | null | undefined, fallback = "-") =>
  code ? (map[code] ?? code) : fallback

const OPERATION_STATUS_LABEL: Record<string, string> = { PENDING: "대기", IN_PROGRESS: "진행중", COMPLETED: "완료", SKIPPED: "건너뜀", CANCELLED: "취소" }
export const getOperationStatusLabel = (code: string | null | undefined) => lookup(OPERATION_STATUS_LABEL, code)

const INSPECTION_STAGE_LABEL: Record<string, string> = { FIRST: "초물", MID: "중간", FINAL: "종물" }
export const getInspectionStageLabel = (code: string | null | undefined) => lookup(INSPECTION_STAGE_LABEL, code)

const INSPECTION_RESULT_LABEL: Record<string, string> = { PASS: "합격", FAIL: "불합격", CONDITIONAL: "조건부", PENDING: "대기" }
export const getInspectionResultLabel = (code: string | null | undefined) => lookup(INSPECTION_RESULT_LABEL, code, "미판정")

const LOT_RELATION_LABEL: Record<string, string> = { INPUT: "투입", OUTPUT: "산출", REWORK: "재작업" }
export const getLotRelationLabel = (code: string | null | undefined) => lookup(LOT_RELATION_LABEL, code)

const TX_TYPE_LABEL: Record<string, string> = {
  RECEIPT: "입고", ISSUE: "출고", TRANSFER: "이동", ADJUST: "조정", RETURN: "반품입고", SCRAP: "폐기", SUPPLIER_RETURN: "공급사 반품",
}
export const getTxTypeLabel = (code: string | null | undefined) => lookup(TX_TYPE_LABEL, code)

const ITEM_TYPE_LABEL: Record<string, string> = { RAW_MATERIAL: "원자재", SEMI_FINISHED: "반제품", FINISHED: "완제품", CONSUMABLE: "소모품" }
export const getItemTypeLabel = (code: string | null | undefined) => lookup(ITEM_TYPE_LABEL, code)

const ACTION_STATUS_LABEL: Record<string, string> = { OPEN: "등록", IN_PROGRESS: "진행", VERIFYING: "효과확인", COMPLETED: "완료" }
export const getActionStatusLabel = (code: string | null | undefined) => lookup(ACTION_STATUS_LABEL, code)

const BASE_MOVEMENT_LABEL: Record<string, MovementLabel> = {
  CREATED: { label: "재공품 생성", tone: "default" },
  STARTED: { label: "작업시작", tone: "default" },
  MOVED: { label: "공정이동", tone: "default" },
  HOLD: { label: "보류", tone: "default" },
  RELEASED: { label: "보류해제", tone: "emerald" },
  SPLIT: { label: "수량 분리", tone: "purple" },
  MERGE: { label: "병합", tone: "purple" },
  DEFECT: { label: "불량 발생", tone: "red" },
  REWORK: { label: "재작업", tone: "orange" },
  SCRAP: { label: "폐기", tone: "rose" },
  OUTSOURCED: { label: "외주 반출", tone: "cyan" },
  RETURNED: { label: "외주 입고", tone: "cyan" },
  COMPLETED: { label: "완료", tone: "default" },
  ADJUSTED: { label: "조정", tone: "default" },
}

/** 외주 입고검사(OutsourcingInspection)에서 발생한 재공 이동의 업무 명칭 */
const OUTSOURCING_INSPECTION_LABEL: Record<string, MovementLabel> = {
  RELEASED: { label: "외주 검사완료", tone: "emerald" },
  DEFECT: { label: "외주 검사 불량", tone: "red" },
  SCRAP: { label: "외주 불량 폐기", tone: "rose" },
  REWORK: { label: "재외주", tone: "orange" },
  SPLIT: { label: "외주 수량 분리", tone: "purple" },
}

/** 같은 RELEASED라도 외주 입고검사에서 발생한 것은 보류해제가 아니라 외주 검사완료다. */
export function getWipMovementLabel(movementType: string, sourceType?: string | null): MovementLabel {
  if (sourceType === OUTSOURCING_INSPECTION_SOURCE) {
    const inspection = OUTSOURCING_INSPECTION_LABEL[movementType]
    if (inspection) return inspection
  }
  return BASE_MOVEMENT_LABEL[movementType] ?? { label: movementType, tone: "default" }
}

export function isOutsourcingMovement(movement: { movementType: string; sourceType?: string | null }): boolean {
  return (
    movement.movementType === "OUTSOURCED" ||
    movement.movementType === "RETURNED" ||
    movement.sourceType === OUTSOURCING_INSPECTION_SOURCE
  )
}

const SOURCE_TYPE_LABEL: Record<string, string> = {
  PurchaseOrderItem: "외주 발주",
  [OUTSOURCING_INSPECTION_SOURCE]: "외주 입고검사",
}

export function getSourceTypeLabel(sourceType: string | null | undefined): string {
  if (!sourceType) return "-"
  return SOURCE_TYPE_LABEL[sourceType] ?? sourceType
}

// ─── 일시 표시 ────────────────────────────────────────────────────────────────

const KST_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
})

/** YYYY-MM-DD HH:mm:ss (한국 표준시). 값이 없거나 해석 불가면 "-". */
export function formatTraceDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const parts: Record<string, string> = {}
  for (const part of KST_FORMATTER.formatToParts(date)) parts[part.type] = part.value
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

// ─── 작업시작·완료시간 ────────────────────────────────────────────────────────

export type ResultTimeInput = { startedAt: Date | string | null; endedAt: Date | string | null }

function toMs(value: Date | string | null | undefined): number | null {
  if (!value) return null
  const ms = (value instanceof Date ? value : new Date(value)).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * 생산실적 목록에서 작업시작·완료시간을 구한다.
 * - 시작: 기록된 startedAt 중 가장 이른 값
 * - 완료: 진행이 끝난 경우(isFinished)에만, 기록된 endedAt 중 가장 늦은 값
 * 진행 중이거나 기록이 없으면 null (임의 생성 금지).
 */
export function summarizeResultTimes(
  results: ResultTimeInput[],
  isFinished: boolean,
): { startedAt: string | null; completedAt: string | null } {
  const starts = results.map((r) => toMs(r.startedAt)).filter((v): v is number => v !== null)
  const ends = results.map((r) => toMs(r.endedAt)).filter((v): v is number => v !== null)
  return {
    startedAt: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    completedAt: isFinished && ends.length ? new Date(Math.max(...ends)).toISOString() : null,
  }
}
