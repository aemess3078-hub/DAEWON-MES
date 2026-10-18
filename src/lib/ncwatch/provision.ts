import type { PrismaClient, TagCategory, TagDataType } from "@prisma/client"
import { generateAgentKey, hashAgentKey } from "./agent-key"

// NCWatch 설비 매핑 시 자동 생성/재사용되는 Gateway 이름.
// Gateway 관리 화면에서 직접 만드는 NCWatch Agent Gateway 도 이 이름을 사용해야 동일 Gateway 로 취급된다.
export const NCWATCH_GATEWAY_NAME = "NCWatch Agent"

export type NcwatchDefaultTagDefinition = {
  tagCode: string
  displayName: string
  dataType: TagDataType
  unit: string | null
  category: TagCategory
  plcAddress: string
  isVisible: boolean
  isPrimary: boolean
  displayOrder: number
}

export const NCWATCH_DEFAULT_TAGS: NcwatchDefaultTagDefinition[] = [
  // ── 카드 요약(상위 6개) ──────────────────────────────────────────
  {
    tagCode: "STATUS",
    displayName: "운전 상태",
    dataType: "STRING",
    unit: null,
    category: "STATUS",
    plcAddress: "statusLabel",
    isVisible: true,
    isPrimary: true,
    displayOrder: 10,
  },
  {
    tagCode: "PROGRAM_NAME",
    displayName: "가공 프로그램",
    dataType: "STRING",
    unit: null,
    category: "PROCESS",
    plcAddress: "programName",
    isVisible: true,
    isPrimary: false,
    displayOrder: 20,
  },
  {
    tagCode: "MODE",
    displayName: "운전 모드",
    dataType: "STRING",
    unit: null,
    category: "STATUS",
    plcAddress: "modeCode",
    isVisible: true,
    isPrimary: false,
    displayOrder: 30,
  },
  {
    tagCode: "SPINDLE_SPEED",
    displayName: "주축 회전수",
    dataType: "INT",
    unit: "rpm",
    category: "PROCESS",
    plcAddress: "spindleSpeed",
    isVisible: true,
    isPrimary: false,
    displayOrder: 40,
  },
  {
    tagCode: "FEED_RATE",
    displayName: "이송 속도",
    dataType: "INT",
    unit: "mm/min",
    category: "PROCESS",
    plcAddress: "feedRate",
    isVisible: true,
    isPrimary: false,
    displayOrder: 50,
  },
  {
    tagCode: "PART_COUNT",
    displayName: "생산 수량",
    dataType: "INT",
    unit: "ea",
    category: "COUNTER",
    plcAddress: "partCount",
    isVisible: true,
    isPrimary: false,
    displayOrder: 60,
  },
  // ── 파라미터 상세(카드 외, 파라미터보기에서 노출) ────────────────
  {
    tagCode: "TOOL_NO",
    displayName: "공구 번호",
    dataType: "STRING",
    unit: null,
    category: "STATUS",
    plcAddress: "toolNo",
    isVisible: true,
    isPrimary: false,
    displayOrder: 70,
  },
  {
    tagCode: "RATIO",
    displayName: "진행률",
    dataType: "FLOAT",
    unit: "%",
    category: "PROCESS",
    plcAddress: "ratio",
    isVisible: true,
    isPrimary: false,
    displayOrder: 80,
  },
  {
    tagCode: "BLOCK_NUMBER",
    displayName: "블록 번호",
    dataType: "INT",
    unit: null,
    category: "PROCESS",
    plcAddress: "blockNumber",
    isVisible: true,
    isPrimary: false,
    displayOrder: 90,
  },
  {
    tagCode: "O_NUMBER",
    displayName: "프로젝트 번호",
    dataType: "STRING",
    unit: null,
    category: "PROCESS",
    plcAddress: "oNumber",
    isVisible: true,
    isPrimary: false,
    displayOrder: 100,
  },
  {
    tagCode: "ALARM_MESSAGE",
    displayName: "알람 메시지",
    dataType: "STRING",
    unit: null,
    category: "ALARM",
    plcAddress: "alarmMessage",
    isVisible: true,
    isPrimary: false,
    displayOrder: 110,
  },
  {
    tagCode: "POS_X",
    displayName: "X축 위치",
    dataType: "FLOAT",
    unit: "mm",
    category: "PROCESS",
    plcAddress: "positionX",
    isVisible: true,
    isPrimary: false,
    displayOrder: 120,
  },
  {
    tagCode: "POS_Y",
    displayName: "Y축 위치",
    dataType: "FLOAT",
    unit: "mm",
    category: "PROCESS",
    plcAddress: "positionY",
    isVisible: true,
    isPrimary: false,
    displayOrder: 130,
  },
  {
    tagCode: "POS_Z",
    displayName: "Z축 위치",
    dataType: "FLOAT",
    unit: "mm",
    category: "PROCESS",
    plcAddress: "positionZ",
    isVisible: true,
    isPrimary: false,
    displayOrder: 140,
  },
  {
    tagCode: "ALARM_CODE",
    displayName: "알람 코드",
    dataType: "STRING",
    unit: null,
    category: "ALARM",
    plcAddress: "alarmCode",
    isVisible: false,
    isPrimary: false,
    displayOrder: 150,
  },
]

/**
 * 사업장의 NCWatch Agent Gateway 를 재사용하고, 없을 때만 생성한다(중복 생성 금지).
 * 자동 생성분의 키는 추측 불가능한 난수의 해시로 저장해 아무도 평문을 모르는 상태로 둔다(구형 cuid 기본키 방지).
 * 실제 Agent 인증키는 Gateway 관리 화면의 발급 기능 또는 scripts/ncwatch-ops.ts 로 발급한다.
 */
export async function ensureNcwatchGateway(
  db: Pick<PrismaClient, "edgeGateway">,
  tenantId: string,
  siteId: string
): Promise<{ id: string }> {
  const existing = await db.edgeGateway.findFirst({
    where: { tenantId, siteId, name: NCWATCH_GATEWAY_NAME },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  if (existing) return existing
  return db.edgeGateway.create({
    data: {
      tenantId,
      siteId,
      name: NCWATCH_GATEWAY_NAME,
      description: "Virtual gateway for NCWatch Agent push integration",
      status: "OFFLINE",
      apiKey: hashAgentKey(generateAgentKey()),
    },
    select: { id: true },
  })
}

/** Agent 하트비트 주기(30초)의 여유 배수. 이 시간 이상 하트비트가 없으면 Gateway 를 오프라인으로 본다. */
export const GATEWAY_HEARTBEAT_STALE_MS = 3 * 60 * 1000

export function isGatewayHeartbeatStale(
  lastHeartbeat: Date | null,
  now: number = Date.now(),
  staleMs: number = GATEWAY_HEARTBEAT_STALE_MS
): boolean {
  if (!lastHeartbeat) return true
  return now - lastHeartbeat.getTime() > staleMs
}
