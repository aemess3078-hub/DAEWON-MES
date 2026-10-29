/**
 * MES 화면 → 라벨 전용 인쇄 페이지(/label-print) 로 라벨 데이터를 넘기는 작업(job) 저장소.
 *
 * 왜 별도 페이지인가
 *  - 안드로이드 Chrome 은 숨은 iframe(react-to-print 방식)에서 print() 를 호출하면 iframe 이 아니라
 *    "현재 페이지 전체(MES 메뉴·발주번호·팝업 제목·버튼)"를 인쇄하는 문제가 있다.
 *  - 라벨만 담긴 독립 페이지를 새 탭으로 열어 그 페이지 자체를 인쇄하면 라벨 외 화면 요소가 들어갈 수 없다.
 *
 * 데이터는 같은 브라우저의 localStorage 로만 전달한다(서버 경유·URL 노출 없음). 일정 시간이 지나면 폐기한다.
 * 파싱은 신뢰하지 않는 입력으로 취급해 길이/개수/타입을 검증한다.
 */
import { LABEL_TYPE_META, isValidTestLotNo, type LabelData, type LabelType } from "@/lib/label/label-spec"

export const LABEL_JOB_PREFIX = "daewon:label-job:"
export const LABEL_JOB_TTL_MS = 30 * 60 * 1000
export const LABEL_JOB_MAX_LABELS = 100
export const LABEL_PRINT_PATH = "/label-print"

export type LabelPrintJob = {
  v: 1
  createdAt: number
  reprint: boolean
  labels: LabelData[]
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : ""
}

/** 알 수 없는 입력을 검증해 안전한 LabelData 로 만든다. 형식이 틀리면 null. */
export function sanitizeLabel(raw: unknown): LabelData | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const kind = r.kind === "LOT_QR" || r.kind === "WIP_QR" || r.kind === "ITEM_BARCODE" ? r.kind : null
  if (!kind) return null
  const itemCode = str(r.itemCode, 80).trim()
  const itemName = str(r.itemName, 200).trim()
  if (!itemCode || !itemName) return null
  const lotNo = str(r.lotNo, 128).trim() || null
  if (kind === "LOT_QR" && !lotNo) return null
  const wipId = str(r.wipId, 128).trim() || null
  if (kind === "WIP_QR" && !wipId) return null
  const labelType: LabelType | null =
    r.labelType === "RAW_LOT" || r.labelType === "WIP" || r.labelType === "FG_LOT" ? r.labelType : null
  // 라벨 유형과 QR 종류가 어긋난 job 은 거부한다(WIP 라벨에 LOT QR 등).
  if (labelType && LABEL_TYPE_META[labelType].kind !== kind) return null
  // 시험용 라벨은 TEST- 임시 번호만 허용한다(실제 LOT 번호로 "시험용" 표시를 단 라벨을 만들 수 없다).
  const test = r.test === true
  if (test && kind === "ITEM_BARCODE") return null
  if (test && kind === "LOT_QR" && !isValidTestLotNo(lotNo)) return null
  if (test && kind === "WIP_QR" && !isValidTestLotNo(wipId)) return null
  const quantity = typeof r.quantity === "number" && Number.isFinite(r.quantity) ? r.quantity : null
  return {
    kind,
    itemCode,
    itemName,
    lotNo,
    lotId: str(r.lotId, 128).trim() || null,
    quantity,
    uom: str(r.uom, 20).trim() || null,
    date: str(r.date, 20),
    dateLabel: str(r.dateLabel, 10) || "일자",
    ...(test ? { test: true } : {}),
    ...(labelType ? { labelType } : {}),
    ...(kind === "WIP_QR"
      ? {
          wipId,
          manufacturingNo: str(r.manufacturingNo, 80).trim() || null,
          workOrderNo: str(r.workOrderNo, 80).trim() || null,
        }
      : {}),
    ...(str(r.spec, 100).trim() ? { spec: str(r.spec, 100).trim() } : {}),
  }
}

export function parseLabelJob(json: string | null, now: number = Date.now()): LabelPrintJob | null {
  if (!json) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  if (r.v !== 1 || typeof r.createdAt !== "number" || !Array.isArray(r.labels)) return null
  if (now - r.createdAt > LABEL_JOB_TTL_MS || r.createdAt > now + 60_000) return null
  if (r.labels.length === 0 || r.labels.length > LABEL_JOB_MAX_LABELS) return null
  const labels: LabelData[] = []
  for (const item of r.labels) {
    const label = sanitizeLabel(item)
    if (!label) return null
    labels.push(label)
  }
  return { v: 1, createdAt: r.createdAt, reprint: r.reprint === true, labels }
}

export function newLabelJobId(): string {
  const bytes = new Uint8Array(12)
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function isValidLabelJobId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^[0-9a-f]{24}$/.test(id)
}

export function pruneExpiredLabelJobs(storage: StorageLike, now: number = Date.now()): void {
  const stale: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key || !key.startsWith(LABEL_JOB_PREFIX)) continue
    if (!parseLabelJob(storage.getItem(key), now)) stale.push(key)
  }
  stale.forEach((key) => storage.removeItem(key))
}

/** 저장 후 job id 를 돌려준다. 저장소를 못 쓰면(비공개 모드 등) null. */
export function saveLabelJob(storage: StorageLike, labels: LabelData[], reprint: boolean, now: number = Date.now()): string | null {
  try {
    pruneExpiredLabelJobs(storage, now)
    const job: LabelPrintJob = { v: 1, createdAt: now, reprint, labels }
    const id = newLabelJobId()
    storage.setItem(LABEL_JOB_PREFIX + id, JSON.stringify(job))
    return id
  } catch {
    return null
  }
}

export function loadLabelJob(storage: StorageLike, id: string, now: number = Date.now()): LabelPrintJob | null {
  if (!isValidLabelJobId(id)) return null
  try {
    return parseLabelJob(storage.getItem(LABEL_JOB_PREFIX + id), now)
  } catch {
    return null
  }
}

export function labelPrintUrl(id: string, opts: { rotate?: boolean } = {}): string {
  const params = new URLSearchParams({ job: id })
  if (opts.rotate) params.set("rot", "1")
  return `${LABEL_PRINT_PATH}?${params.toString()}`
}
