'use strict'
// NCWatch STATUS 테이블 1행 → MES 수신 API payload 변환.
//
// ── 코드값 근거 ─────────────────────────────────────────────────────────────
//  확인됨(2026-10-18, 대원정밀 현장 4대 전원 OFF 상태 실측):
//    STATUS=4 · RUN=0 · MODE=0 · MESSAGE=202  ⇔  OFFLINE
//    (STATUS_MAP[4]='OFFLINE', RUN_MAP[0]='OFFLINE', MESSAGE_MAP[202]='OFFLINE' 세 매핑이 서로 일치)
//  미검증(설비 가동 중 실측 필요): STATUS 0·1·2·3·5·6, RUN 1~7, MODE 값, MESSAGE 100~104/200/201/203.
//    → 아래 표는 NCWatch 기본 문서/기존 mapper 추정이며, 설비 가동 후 샘플로 확정해야 한다.
//    → 서버 변환(transform.ts)은 3=가동(RUN), 5=알람(ALARM), 그 외=정지(STOP) 로만 사용한다.

const { formatNcwatchTimestamp } = require('./time')

const STATUS_MAP = { 0: 'READY', 1: 'STOP', 2: 'PAUSE', 3: 'START', 4: 'OFFLINE', 5: 'ALARM', 6: 'MANUAL' }
const RUN_MAP = { 0: 'OFFLINE', 1: 'ONLINE', 2: 'ALARM', 3: 'START', 4: 'HOLD', 5: 'STOP', 6: 'RESET', 7: 'SMS' }
const MODE_MAP = { 0: 'MDI', 1: 'MEM', 3: 'EDIT', 4: 'HND', 5: 'JOG', 9: 'REG', 10: 'REMOTE' }
const MESSAGE_MAP = {
  100: 'DEFAULT/RUN', 101: '가공완료', 102: '가공중알람', 104: '모든알람',
  200: '비가동', 201: 'ALARM', 202: 'OFFLINE', 203: 'MANUAL MODE',
}

/** 컬럼명 대소문자 차이에 대비한 조회기 (NCWatch 는 대문자 컬럼) */
function makeColumnReader(row) {
  const upper = new Map()
  for (const key of Object.keys(row || {})) upper.set(key.toUpperCase(), row[key])
  return (name) => upper.get(String(name).toUpperCase())
}

function toInt(value) {
  if (value == null || value === '') return null
  const n = Number.parseInt(String(value), 10)
  return Number.isFinite(n) ? n : null
}

function toFloat(value) {
  if (value == null || value === '') return null
  const n = Number.parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}

function toText(value) {
  if (value == null) return ''
  return String(value).trim()
}

/**
 * STATUS 행 → 정규화 객체.
 * STATUS 컬럼이 비어 있거나 숫자가 아니면 임의로 READY(0) 로 보지 않고 statusCode=null(UNKNOWN) 로 둔다.
 */
function normalizeStatusRow(row, machineName) {
  const col = makeColumnReader(row)
  const statusCode = toInt(col('STATUS'))
  const runCode = toInt(col('RUN'))
  const modeCode = toInt(col('MODE'))
  const messageCode = toInt(col('MESSAGE'))
  const alarmNo = toInt(col('ALARM'))
  const alarmMsg = toText(col('ALARMMSG'))

  return {
    name: machineName,
    statusCode,
    statusLabel: statusCode == null ? 'UNKNOWN' : (STATUS_MAP[statusCode] ?? 'UNKNOWN'),
    run: runCode,
    runLabel: runCode == null ? 'UNKNOWN' : (RUN_MAP[runCode] ?? 'UNKNOWN'),
    mode: modeCode,
    modeLabel: modeCode == null ? 'UNKNOWN' : (MODE_MAP[modeCode] ?? 'UNKNOWN'),
    message: messageCode,
    messageLabel: messageCode == null ? 'UNKNOWN' : (MESSAGE_MAP[messageCode] ?? `CODE_${messageCode}`),
    program: toText(col('FILENAME')),
    oNumber: toText(col('ONUM')),
    spindleSpeed: toInt(col('SPINDLE')) ?? 0,
    feedRate: toInt(col('FEED')) ?? 0,
    posX: toFloat(col('AXIS_X')) ?? 0,
    posY: toFloat(col('AXIS_Y')) ?? 0,
    posZ: toFloat(col('AXIS_Z')) ?? 0,
    toolNo: toText(col('TOOL_NUMBER')) || null,
    partsDone: toInt(col('PARTCOUNT')) ?? 0,
    blockNo: toInt(col('BLOCKNUMBER')) ?? 0,
    blockTot: toInt(col('BLOCKTOT')) ?? 0,
    ratio: toFloat(col('RATIO')) ?? 0,
    aliveCount: toInt(col('ALIVECOUNT')),
    alarms: alarmMsg
      ? [{ code: alarmNo ? String(alarmNo) : '', msg: alarmMsg }]
      : [],
    timestamp: formatNcwatchTimestamp(col('TIMESTAMP_S') ?? col('TIMESTAMP')),
  }
}

/** 정규화 객체 → MES `/api/lms/ncwatch/status` machines[] 원소 */
function toStatusPayload(n) {
  return {
    machineName: n.name,
    statusCode: n.statusCode,
    statusLabel: n.statusLabel,
    runCode: n.run,
    modeCode: n.mode,
    messageCode: n.message,
    programName: n.program || null,
    oNumber: n.oNumber || null,
    spindleSpeed: n.spindleSpeed,
    feedRate: n.feedRate,
    positionX: n.posX,
    positionY: n.posY,
    positionZ: n.posZ,
    toolNo: n.toolNo && n.toolNo !== '-' ? String(n.toolNo) : null,
    partCount: n.partsDone,
    blockNumber: n.blockNo,
    blockTot: n.blockTot,
    ratio: n.ratio,
    alarmCode: n.alarms[0]?.code || null,
    alarmMessage: n.alarms[0]?.msg || null,
    aliveCount: n.aliveCount,
    ncwatchTs: n.timestamp || null,
  }
}

/**
 * 변경 감지용 서명. 매 사이클 값이 달라지는 aliveCount / ncwatchTs 는 제외한다.
 * (이 두 값만 바뀐 경우는 강제 전송 주기마다 한 번만 전송한다)
 */
function payloadSignature(payload) {
  const { aliveCount, ncwatchTs, ...rest } = payload
  void aliveCount
  void ncwatchTs
  return JSON.stringify(rest)
}

/**
 * 일간 리포트(REPORT_DAILY) summary 행 → payload.
 * 주의(미검증): DATA_1~12 의 의미는 기존 agent 가정(DATA_2=가동시간, DATA_3=가동률% ...)을 그대로 사용한다.
 * 가동 실측 데이터로 확인 전까지 가동률/수량 해석에 신뢰하지 말 것.
 */
function toDailyReportPayload(machine, reportDate, summary) {
  const col = makeColumnReader(summary)
  return {
    machineName: machine,
    reportDate,
    runTime: toText(col('DATA_2')) || null,
    runPct: toFloat(col('DATA_3')) ?? 0,
    partCount: toInt(col('DATA_4')) ?? 0,
    stopTime: toText(col('DATA_5')) || null,
    stopPct: toFloat(col('DATA_6')) ?? 0,
    manualPct: toFloat(col('DATA_7')) ?? 0,
    alarmPct: toFloat(col('DATA_8')) ?? 0,
    offlinePct: toFloat(col('DATA_9')) ?? 0,
    manualTime: toText(col('DATA_10')) || null,
    alarmTime: toText(col('DATA_11')) || null,
    offlineTime: toText(col('DATA_12')) || null,
  }
}

/** 여러 행 중 summary 행 선택 (DATA_1 이 있고 'O' 로 시작하지 않는 행, 없으면 첫 행) */
function pickDailySummary(rows) {
  if (!rows || rows.length === 0) return null
  const found = rows.find((r) => {
    const v = makeColumnReader(r)('DATA_1')
    return v && !String(v).startsWith('O')
  })
  return found || rows[0]
}

module.exports = {
  STATUS_MAP,
  RUN_MAP,
  MODE_MAP,
  MESSAGE_MAP,
  normalizeStatusRow,
  toStatusPayload,
  payloadSignature,
  toDailyReportPayload,
  pickDailySummary,
}
