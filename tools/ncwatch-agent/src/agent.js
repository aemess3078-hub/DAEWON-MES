'use strict'
// NCWatch → MES push 에이전트 핵심 로직 (v3).
//
// v2 대비 개선:
//  - 모든 MES 호출에 제한시간(abort) 적용, DB 질의에도 statement_timeout 적용
//  - setInterval 대신 "끝난 뒤 다음 실행 예약" 방식 + 실행 중 재진입 차단 → 이전 요청이 안 끝나면 겹쳐 실행되지 않음
//  - 인터넷/DB 장애에도 프로세스가 종료되지 않고, 실패 시 지수 백오프로 재시도, 복구 시 자동 재개
//  - 변경 감지: 값이 그대로인 설비는 STATUS_FORCE_SEND_MS(기본 60초)마다만 재전송 (변경은 다음 10초 사이클에 즉시 전송)
//  - REPORT_DAILY 날짜는 KST, 자정 직후에는 전날 최종치도 한 번 더 전송
//  - 로그/상태 파일에 비밀값 미기록, 반복 장애 로그는 간격 제한

const { MesError } = require('./mes-client')
const { describeError } = require('./errors')
const mapper = require('./mapper')
const { kstDateString, kstDateStringDaysAgo, kstHour } = require('./time')

const MIN = 60 * 1000

function tableName(machine, suffix) {
  return `"TBL_${machine}_${suffix}"`
}

function createAgent({ config, logger, state, db, post, version, reloadKey, now = () => new Date() }) {
  let stopped = false
  const timers = new Map()
  const inflight = new Map()
  const lastSent = new Map() // machine -> { sig, at }
  const lastStatusCode = new Map()
  let mesDownSince = null
  let dbDownSince = null
  let lastSummaryAt = 0
  const startedAtMs = Date.now()

  const iso = () => now().toISOString()
  const secs = (ms) => Math.round(ms / 1000)

  // ─── MES 호출 공통 처리 ────────────────────────────────────────────────────
  async function callMes(endpoint, body) {
    try {
      const json = await post(endpoint, body)
      if (mesDownSince !== null) {
        logger.info(`MES 통신 복구 (장애 지속 ${secs(Date.now() - mesDownSince)}초) — 전송을 재개합니다`)
        mesDownSince = null
        logger.resetThrottle('mes:')
      }
      state.set({ mesReachable: true, lastMesError: null })
      return json
    } catch (err) {
      if (mesDownSince === null) mesDownSince = Date.now()
      const kind = err instanceof MesError ? err.kind : 'unknown'
      const message = err instanceof Error ? err.message : String(err)
      state.set({ mesReachable: false, lastMesError: { at: iso(), kind, message } })
      if (kind === 'auth') {
        // 키가 교체되었을 수 있으니 .env 를 다시 읽어 본다(재시작 없이 반영).
        if (reloadKey && reloadKey()) logger.info('MES_AGENT_KEY 변경을 감지했습니다 — 새 키로 재시도합니다')
        logger.throttle(
          'mes:auth', 'ERROR',
          `MES 인증 실패 — MES_AGENT_KEY 를 확인하세요 (${message}). 자동으로 재시도합니다. (키 값은 로그에 기록하지 않습니다)`,
          5 * MIN
        )
      } else if (kind === 'timeout' || kind === 'network') {
        logger.throttle(
          'mes:net', 'WARN',
          `MES 연결 실패 [${kind}]: ${message} — 인터넷/서버 상태를 확인하세요. 복구될 때까지 자동 재시도합니다`,
          2 * MIN
        )
      } else {
        logger.throttle('mes:http', 'ERROR', `MES 응답 오류: ${message}`, 2 * MIN)
      }
      throw err
    }
  }

  // ─── NCWatch DB 조회 공통 처리 ─────────────────────────────────────────────
  async function queryMachine(machine, sql, params) {
    try {
      const result = await db.query(sql, params)
      if (dbDownSince !== null) {
        logger.info(`NCWatch DB 조회 복구 (장애 지속 ${secs(Date.now() - dbDownSince)}초)`)
        dbDownSince = null
        logger.resetThrottle('db:')
      }
      return result
    } catch (err) {
      const message = describeError(err)
      logger.throttle(`db:${machine}:${sql.slice(0, 40)}`, 'ERROR', `NCWatch DB 조회 실패 (${machine} ${(/_(STATUS|REPORT_DAILY)"/.exec(sql) || [])[1] || ''}): ${message}`, 5 * MIN)
      throw err
    }
  }

  // ─── STATUS ────────────────────────────────────────────────────────────────
  async function pushStatus() {
    const t = now()
    const nowMs = t.getTime()
    const items = []
    let dbOk = 0

    for (const machine of config.machines) {
      let rows
      try {
        ;({ rows } = await queryMachine(machine, `SELECT * FROM ${tableName(machine, 'STATUS')} LIMIT 1`))
        dbOk++
      } catch {
        state.setMachine(machine, { dbOk: false })
        continue
      }
      if (!rows.length) {
        logger.throttle(`norow:${machine}`, 'WARN', `${machine}: STATUS 테이블에 행이 없습니다`, 10 * MIN)
        state.setMachine(machine, { dbOk: true, hasRow: false })
        continue
      }
      const normalized = mapper.normalizeStatusRow(rows[0], machine)
      const payload = mapper.toStatusPayload(normalized)
      items.push({ machine, payload, sig: mapper.payloadSignature(payload), normalized })
      state.setMachine(machine, {
        dbOk: true,
        hasRow: true,
        statusCode: normalized.statusCode,
        statusLabel: normalized.statusLabel,
        rowTimestamp: normalized.timestamp,
        aliveCount: normalized.aliveCount,
      })
    }

    if (dbOk === 0) {
      state.set({ dbReachable: false })
      if (dbDownSince === null) dbDownSince = Date.now()
      return false
    }
    state.set({ dbReachable: true })

    const due = items.filter((it) => {
      const prev = lastSent.get(it.machine)
      if (!prev || config.forceSendIntervalMs === 0) return true
      return prev.sig !== it.sig || nowMs - prev.at >= config.forceSendIntervalMs
    })
    state.set({ lastStatusCheckAt: iso() })
    if (due.length === 0) return true

    const res = await callMes('/api/lms/ncwatch/status', { machines: due.map((d) => d.payload) })
    const byName = new Map(((res && res.machines) || []).map((m) => [m.machineName, m]))

    for (const d of due) {
      const r = byName.get(d.machine)
      const result = r ? r.result : 'OK'
      if (result === 'ERROR') {
        // 서버가 처리하지 못한 설비는 lastSent 를 갱신하지 않아 다음 사이클에 재전송된다.
        logger.throttle(`srv-err:${d.machine}`, 'ERROR', `${d.machine}: MES 처리 오류 — ${(r && r.message) || '알 수 없음'}`, 5 * MIN)
        state.setMachine(d.machine, { lastResult: 'ERROR', lastResultMessage: (r && r.message) || null })
        continue
      }
      lastSent.set(d.machine, { sig: d.sig, at: nowMs })
      state.setMachine(d.machine, { lastResult: result, lastSentAt: iso(), lastResultMessage: null })
      if (result === 'UNMAPPED') {
        logger.throttle(
          `unmapped:${d.machine}`, 'WARN',
          `${d.machine}: MES 설비 매핑이 없습니다 (수신 데이터는 임시 저장됨) — 설비연결설정 > NCWatch Agent 매핑에서 연결하세요`,
          30 * MIN
        )
      }
      const prevCode = lastStatusCode.get(d.machine)
      if (prevCode === undefined || prevCode !== d.normalized.statusCode) {
        logger.info(
          `${d.machine}: 상태 ${prevCode === undefined ? '최초 수신' : '변경'} → ${d.normalized.statusLabel}` +
          `(STATUS=${d.normalized.statusCode}) 프로그램=${d.normalized.program || '-'} MES결과=${result}`
        )
        lastStatusCode.set(d.machine, d.normalized.statusCode)
      }
    }

    state.set({ lastStatusOkAt: iso(), consecutiveStatusFailures: 0 })
    if (nowMs - lastSummaryAt >= 10 * MIN) {
      lastSummaryAt = nowMs
      logger.info(`STATUS 전송 정상 — ${items.length}/${config.machines.length}대 조회, 이번 전송 ${due.length}대, 마지막 정상 전송 ${iso()}`)
    }
    return true
  }

  // ─── REPORT_DAILY ──────────────────────────────────────────────────────────
  async function pushDailyReport() {
    const t = now()
    // NCWatch DB 는 KST 날짜 기준이므로 KST 로 계산한다. 자정 직후(0~1시)에는 전날 최종치도 함께 보낸다.
    const dates = [kstDateString(t)]
    if (kstHour(t) < 2) dates.unshift(kstDateStringDaysAgo(t, 1))

    const payloads = []
    for (const date of dates) {
      for (const machine of config.machines) {
        try {
          const { rows } = await queryMachine(
            machine,
            `SELECT * FROM ${tableName(machine, 'REPORT_DAILY')} WHERE "REPORT_START"::text LIKE $1 ORDER BY "REPORT_START" DESC LIMIT 5`,
            [date + '%']
          )
          const summary = mapper.pickDailySummary(rows)
          if (summary) payloads.push(mapper.toDailyReportPayload(machine, date, summary))
        } catch {
          /* queryMachine 에서 기록됨 — 다른 설비는 계속 진행 */
        }
      }
    }
    if (payloads.length === 0) return true

    await callMes('/api/lms/ncwatch/report-daily', { machines: payloads })
    state.set({ lastReportOkAt: iso() })
    logger.info(`REPORT_DAILY 전송 완료 (${dates.join(', ')}, ${payloads.length}건)`)
    return true
  }

  // ─── HEARTBEAT ─────────────────────────────────────────────────────────────
  async function pushHeartbeat() {
    await callMes('/api/lms/ncwatch/heartbeat', {
      agentVersion: version,
      machineCount: config.machines.length,
      uptime: Math.round((Date.now() - startedAtMs) / 1000),
    })
    state.set({ lastHeartbeatOkAt: iso() })
    return true
  }

  // ─── 스케줄러 ──────────────────────────────────────────────────────────────
  function schedule(name, fn, { intervalMs, retryBaseMs, maxDelayMs, runTimeoutMs, initialDelayMs = 0 }) {
    let failures = 0

    async function run() {
      if (stopped) return
      const startedAt = Date.now()

      // 이전 실행이 아직 끝나지 않았다면(응답 지연 등) 겹쳐 실행하지 않고 다음으로 미룬다.
      if (inflight.has(name)) {
        logger.throttle(`busy:${name}`, 'WARN', `${name}: 이전 실행이 아직 끝나지 않아 이번 주기를 건너뜁니다`, 5 * MIN)
        timers.set(name, setTimeout(run, intervalMs))
        return
      }

      let ok = false
      const work = Promise.resolve()
        .then(fn)
        .then((r) => r !== false)
        .catch((err) => {
          if (!(err instanceof MesError)) {
            const message = err instanceof Error ? err.stack || err.message : String(err)
            logger.throttle(`unexpected:${name}`, 'ERROR', `${name}: 예기치 않은 오류 — ${message}`, MIN)
          }
          return false
        })
      inflight.set(name, work)
      work.finally(() => {
        if (inflight.get(name) === work) inflight.delete(name)
      })

      let timeoutHandle
      const timeout = new Promise((resolve) => {
        timeoutHandle = setTimeout(() => resolve('timeout'), runTimeoutMs)
      })
      const outcome = await Promise.race([work, timeout])
      clearTimeout(timeoutHandle)
      if (outcome === 'timeout') {
        logger.throttle(`stuck:${name}`, 'ERROR', `${name}: ${secs(runTimeoutMs)}초 안에 끝나지 않았습니다 (다음 주기에 재시도)`, 5 * MIN)
        ok = false
      } else {
        ok = outcome === true
      }

      failures = ok ? 0 : failures + 1
      if (name === 'status') state.set({ consecutiveStatusFailures: failures })

      let delay
      if (ok) {
        delay = Math.max(0, intervalMs - (Date.now() - startedAt))
      } else {
        const base = Math.min(intervalMs, retryBaseMs)
        delay = Math.min(base * 2 ** Math.min(failures - 1, 5), maxDelayMs)
      }
      if (!stopped) timers.set(name, setTimeout(run, delay))
    }

    timers.set(name, setTimeout(run, initialDelayMs))
  }

  function start() {
    stopped = false
    schedule('heartbeat', pushHeartbeat, {
      intervalMs: config.heartbeatIntervalMs,
      retryBaseMs: config.heartbeatIntervalMs,
      maxDelayMs: Math.max(config.heartbeatIntervalMs, 60 * 1000),
      runTimeoutMs: config.requestTimeoutMs + 5000,
    })
    schedule('status', pushStatus, {
      intervalMs: config.statusIntervalMs,
      retryBaseMs: config.statusIntervalMs,
      maxDelayMs: Math.max(config.statusIntervalMs, 60 * 1000),
      runTimeoutMs: config.requestTimeoutMs + config.dbQueryTimeoutMs + 10000,
      initialDelayMs: 500,
    })
    schedule('report', pushDailyReport, {
      intervalMs: config.reportIntervalMs,
      retryBaseMs: 60 * 1000,
      maxDelayMs: 10 * MIN,
      runTimeoutMs: config.requestTimeoutMs + config.dbQueryTimeoutMs * config.machines.length + 10000,
      initialDelayMs: 5000,
    })
  }

  async function stop() {
    stopped = true
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    // 진행 중인 전송이 있으면 잠시 기다린다(최대 5초).
    const pending = Array.from(inflight.values())
    if (pending.length) {
      await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, 5000))])
    }
  }

  return { start, stop, pushStatus, pushDailyReport, pushHeartbeat, _lastSent: lastSent }
}

module.exports = { createAgent }
