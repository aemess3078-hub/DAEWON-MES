/**
 * 소스 불변조건 검사 도우미 — Git 이력/커밋 상태와 무관하게 동작한다.
 *
 * 예전 테스트는 `git diff HEAD` 로 "이번 작업에서 이 파일들을 바꾸지 않았다"를 확인했다. 그 방식은 변경이 커밋되면
 * (HEAD 에 포함되면) 비교 대상이 사라져 실패하거나 의미를 잃고, .git 이 없는 격리 빌드 환경에서는 실행조차 못 한다.
 * 같은 목적을 다음 두 가지 "내용 기반" 검사로 대신한다.
 *
 *  1. 핵심 업무 로직 지문(fingerprint): 재고 차감 · 수량 검증 · 수불 기록 · WIP 생성/재사용 · 자재예약 갱신 코드 블록을
 *     주석·공백을 제거해 정규화한 뒤 해시한다. 상수로 박아 둔 값은 QR 작업 이전 코드(기준선)의 해시다.
 *     블록이 한 글자라도 바뀌면 실패하므로, 의도한 변경이면 이 상수를 함께 갱신해야 한다.
 *  2. 결합(coupling) 금지: QR/라벨/스캐너 모듈은 출하·POP·WIP 이동·재고·LOT 관리 같은 다른 업무 로직에 연결되지 않는다.
 *     (QR 은 선택적 편의기능이며 QR 전용 업무 처리 경로가 없다는 원칙을 소스에서 확인한다.)
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

/** 저장소 루트(= 테스트를 실행하는 작업 디렉터리) 기준 상대 경로의 소스를 읽는다. 줄바꿈은 LF 로 통일한다. */
export function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n")
}

/** 블록/줄 주석을 지운다(문자열 안의 // 를 구분하지 않는 단순 규칙 — 지문 계산과 같은 규칙을 양쪽에 쓰므로 일관된다). */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

/** 주석 제거 + 공백 압축한 코드 문자열. */
export function normalizeCode(source: string): string {
  return stripComments(source).replace(/\s+/g, " ").trim()
}

export function fingerprint(source: string): string {
  return createHash("sha256").update(normalizeCode(source)).digest("hex").slice(0, 16)
}

/** from 이 처음 나온 위치부터, 그 뒤에 처음 나오는 to 직전까지. 없으면 null. */
export function between(source: string, from: string, to: string): string | null {
  const i = source.indexOf(from)
  if (i < 0) return null
  const j = source.indexOf(to, i + from.length)
  return j < 0 ? null : source.slice(i, j)
}

// ─── 1. 자재출고 핵심 업무 로직 지문 ───────────────────────────────────────────────

/** issueMaterialsForWorkOrder 안에서 "QR/적격성/보안 작업이 건드리지 않아야 하는" 핵심 블록의 경계. */
export const CORE_ISSUE_BLOCKS: Record<string, [string, string]> = {
  wipReuse: ["let wipUnit: WipUnit | null = null", "let firstTxId"],
  qtyChecks: ["const resolvedWarehouseId = balance.warehouseId", "// ── 2. InventoryTransaction"],
  invTx: ["// ── 2. InventoryTransaction", "// ── 2-0. WipUnit"],
  wipCreate: ["if (!wipUnit && firstOperation && workOrder) {", "// ── 2-1. WorkOrderMaterialLot"],
  materialLot: ["// ── 2-1. WorkOrderMaterialLot", "// ── 3. InventoryBalance 차감"],
  decrement: ["// ── 3. InventoryBalance 차감", "// ── 4. MaterialReservation 갱신"],
  reservation: ["// ── 4. MaterialReservation 갱신", "await recordAuditLog(tx, {"],
}

/** 예약 갱신 블록에 4-1.7단계에서 추가한 "예약 소속 재확인" 가드(검증 추가분). 지문 계산에서만 제외한다. */
const RESERVATION_OWNERSHIP_GUARD =
  /if \(!res \|\| res\.workOrderId !== data\.workOrderId \|\| res\.itemId !== item\.itemId\) \{\s*throw new Error\(RESERVATION_MISMATCH_MESSAGE\)\s*\}/

export function coreIssueFingerprints(issueActionsSource: string): Record<string, string | null> {
  const result: Record<string, string | null> = {}
  for (const [name, [from, to]] of Object.entries(CORE_ISSUE_BLOCKS)) {
    let block = between(issueActionsSource, from, to)
    if (block && name === "reservation") block = block.replace(RESERVATION_OWNERSHIP_GUARD, "")
    result[name] = block ? fingerprint(block) : null
  }
  return result
}

/** QR 작업 이전(기준선) 코드의 지문. 재고 차감·수량 검증·수불·WIP 생성/재사용·자재LOT 연결·예약 갱신/생성. */
export const CORE_ISSUE_BASELINE_FINGERPRINTS: Record<string, string> = {
  wipReuse: "c5765009ceab20f2",
  qtyChecks: "015b60e1c7f0b59c",
  invTx: "1a888eb7a294c936",
  wipCreate: "6a0c10089a2c6438",
  materialLot: "09c9950f88e607b7",
  decrement: "41d5da4f5d2b3223",
  reservation: "0f33e934c9b2491d",
}

/** LOT 상태 변경 액션(updateLotStatus) 경계와 기준선 지문. */
export function lotStatusActionBlock(lotActionsSource: string): string | null {
  return between(lotActionsSource, "export async function updateLotStatus", "// ─── LOT 번호 자동 생성")
}
export const LOT_STATUS_ACTION_BASELINE_FINGERPRINT = "b87df475a915cfb6"

/** 입고 확정 트랜잭션 본문(재고·검수·발주 수량 갱신·감사 기록 직전까지)의 경계와 기준선 지문. */
export const RECEIVING_TX_BLOCK: [string, string] = [
  "await lockPurchaseOrderItemsForUpdate(tx, tenantId, [data.purchaseOrderItemId])",
  'menuName: "자재입고",',
]
// 갱신 이력: 24c0e3ce1ad6ab9b → b07151c9b9f5df40 — 예약(RESERVED) 모드에서 이미 존재하는 LOT 에 합치지 않고 중단하는 4줄 추가(LOT 번호 충돌 방지). 그 외 본문 변경 없음.
export const RECEIVING_TX_BASELINE_FINGERPRINT = "b07151c9b9f5df40"

// ─── 2. 결합 금지 ───────────────────────────────────────────────────────────────

/**
 * QR 작업에서 새로 생긴 모듈(QR 규격·스캐너·WIP 라벨 이력·출고 적격성)과 QR 문자열 규격. 다른 업무 로직 파일에는 나타나면 안 된다.
 * 기존 품목 바코드 공용 컴포넌트(common/barcode)와 lib/label 은 출하 화면 등이 원래부터 쓰므로 대상에서 제외한다.
 */
export const QR_FEATURE_COUPLING =
  /@\/lib\/(qr|material-issue)\/|@\/components\/common\/qr-scanner|wip-label|lot-eligibility|lot-read-access|qr-scan|DAEWON\|(LOT|WIP)\|/

/** 파일이면 [파일], 폴더면 하위 모든 파일(재귀)의 저장소 상대 경로. 없으면 빈 배열. */
export function listFiles(rel: string): string[] {
  const abs = join(process.cwd(), rel)
  if (!existsSync(abs)) return []
  if (!statSync(abs).isDirectory()) return [rel.replace(/\\/g, "/")]
  return readdirSync(abs).flatMap((name) => listFiles(`${rel.replace(/\/$/, "")}/${name}`))
}

/** 지정한 파일/폴더(재귀) 중 QR/라벨 기능에 결합된 소스 파일 목록. 비어 있어야 정상. */
export function qrCouplingViolations(rels: string[], allowedFiles: string[] = []): string[] {
  return rels
    .flatMap(listFiles)
    .filter((file) => /\.(ts|tsx)$/.test(file) && !allowedFiles.includes(file))
    .filter((file) => QR_FEATURE_COUPLING.test(stripComments(readSource(file))))
}

// ─── 3. DB 스키마 ───────────────────────────────────────────────────────────────

/**
 * QR/라벨 기능은 새 테이블·컬럼 없이 기존 스키마(AuditLog, Lot.status/expiryDate)만 쓴다.
 * 스키마에 라벨/QR 전용 모델이 생기지 않았고 출고 적격성이 의존하는 기존 필드가 그대로인지 확인한다. 위반 사유 목록(정상이면 빈 배열).
 */
export function schemaViolations(): string[] {
  const problems: string[] = []
  const schema = readSource("prisma/schema.prisma")
  const labelModels = Array.from(schema.matchAll(/^model\s+(\w+)\s*\{/gm)).map((m) => m[1]).filter((name) => /label|qr|scan/i.test(name))
  if (labelModels.length > 0) problems.push(`라벨/QR 전용 모델: ${labelModels.join(", ")}`)
  const lotStatus = /enum LotStatus\s*\{([^}]*)\}/.exec(schema)?.[1] ?? ""
  for (const value of ["ACTIVE", "QUARANTINE", "ON_HOLD", "CONSUMED", "EXPIRED"]) {
    if (!new RegExp(`\\b${value}\\b`).test(lotStatus)) problems.push(`LotStatus.${value} 없음`)
  }
  const lotModel = /model Lot\s*\{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? ""
  if (!/expiryDate\s+DateTime\?/.test(lotModel)) problems.push("Lot.expiryDate DateTime? 없음")
  if (!/status\s+LotStatus/.test(lotModel)) problems.push("Lot.status LotStatus 없음")
  const migrationsDir = join(process.cwd(), "prisma", "migrations")
  if (existsSync(migrationsDir)) {
    const labelMigrations = readdirSync(migrationsDir).filter((name) => /label|qr_/i.test(name))
    if (labelMigrations.length > 0) problems.push(`라벨/QR 관련 마이그레이션: ${labelMigrations.join(", ")}`)
  }
  return problems
}
