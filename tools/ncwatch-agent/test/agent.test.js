'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const { createAgent } = require('../src/agent')
const { postJson, MesError } = require('../src/mes-client')
const { acquireInstanceLock } = require('../src/single-instance')
const { createLogger } = require('../src/logger')
const { makeRow, makeConfig, makeHarness, tmpDir } = require('./helpers')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function newAgent(h, extra = {}) {
  return createAgent({
    config: h.config, logger: h.logger, state: h.state, db: h.db, post: h.post,
    version: '3.0.0-test', now: () => (h.clock ? h.clock.now() : new Date()), ...extra,
  })
}
function allRows() {
  return Object.fromEntries(['CNC-1', 'CNC-8', 'CNC-9', 'MCT-6'].map((m) => [m, makeRow(m)]))
}
function okResponse(body) {
  return { ok: true, machines: body.machines.map((m) => ({ machineName: m.machineName, result: 'OK', equipmentId: 'eq-' + m.machineName })) }
}

// ─── mes-client ───────────────────────────────────────────────────────────────
function withServer(handler, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address()
      try { resolve(await fn(`http://127.0.0.1:${port}`)) } catch (e) { reject(e) } finally { server.closeAllConnections?.(); server.close() }
    })
  })
}

test('MES 응답이 없으면 제한시간 후 timeout 으로 끝난다(무한 대기 없음)', async () => {
  await withServer(() => { /* 응답하지 않음 */ }, async (base) => {
    const t0 = Date.now()
    await assert.rejects(
      postJson({ baseUrl: base, endpoint: '/x', key: 'k', body: {}, timeoutMs: 300 }),
      (e) => e instanceof MesError && e.kind === 'timeout'
    )
    assert.ok(Date.now() - t0 < 3000)
  })
})

test('401 → auth, 500 → http, 연결 거부 → network, 200 → JSON', async () => {
  await withServer((req, res) => {
    if (req.url === '/auth') { res.statusCode = 401; res.end('{"error":"Unauthorized"}'); return }
    if (req.url === '/boom') { res.statusCode = 500; res.end('oops'); return }
    res.setHeader('content-type', 'application/json'); res.end('{"ok":true,"key":"' + req.headers['x-agent-key'] + '"}')
  }, async (base) => {
    await assert.rejects(postJson({ baseUrl: base, endpoint: '/auth', key: 'k', body: {}, timeoutMs: 2000 }), (e) => e.kind === 'auth' && e.status === 401)
    await assert.rejects(postJson({ baseUrl: base, endpoint: '/boom', key: 'k', body: {}, timeoutMs: 2000 }), (e) => e.kind === 'http' && e.status === 500)
    const ok = await postJson({ baseUrl: base, endpoint: '/ok', key: 'abc', body: {}, timeoutMs: 2000 })
    assert.equal(ok.ok, true)
    assert.equal(ok.key, 'abc') // 헤더로는 전달된다
  })
  // 닫힌 포트
  const free = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
  await assert.rejects(
    postJson({ baseUrl: `http://127.0.0.1:${free}`, endpoint: '/x', key: 'secret-key-value', body: {}, timeoutMs: 2000 }),
    (e) => e.kind === 'network' && !e.message.includes('secret-key-value')
  )
})

// ─── 변경 감지 / 전송 ─────────────────────────────────────────────────────────
test('최초에는 4대 모두 전송, 값이 그대로면 재전송하지 않고, 강제 주기가 지나면 다시 전송', async () => {
  let t = Date.parse('2026-10-18T02:00:00Z')
  const h = makeHarness({ rows: allRows(), clock: { now: () => new Date(t) } })
  h.postImpl = async (_e, body) => okResponse(body)
  const agent = newAgent(h)

  assert.equal(await agent.pushStatus(), true)
  assert.equal(h.posts.length, 1)
  assert.equal(h.posts[0].endpoint, '/api/lms/ncwatch/status')
  assert.deepEqual(h.posts[0].body.machines.map((m) => m.machineName), ['CNC-1', 'CNC-8', 'CNC-9', 'MCT-6'])

  // 10초 뒤: ALIVECOUNT/시각만 변경 → 전송 없음
  t += 10000
  for (const m of Object.keys(h.rows)) h.rows[m] = makeRow(m, { ALIVECOUNT: 5, TIMESTAMP_S: '2026-10-18 11:39:31' })
  assert.equal(await agent.pushStatus(), true)
  assert.equal(h.posts.length, 1, '변경 없는 설비는 전송하지 않는다')

  // MCT-6 만 가동 시작 → 그 설비만 즉시 전송
  t += 10000
  h.rows['MCT-6'] = makeRow('MCT-6', { STATUS: 3, RUN: 3, SPINDLE: 3000, ALIVECOUNT: 6 })
  await agent.pushStatus()
  assert.equal(h.posts.length, 2)
  assert.deepEqual(h.posts[1].body.machines.map((m) => m.machineName), ['MCT-6'])
  assert.equal(h.posts[1].body.machines[0].statusCode, 3)

  // 60초 경과 → 전체 재전송(마지막 수신시간 갱신)
  t += 61000
  await agent.pushStatus()
  assert.equal(h.posts.length, 3)
  assert.equal(h.posts[2].body.machines.length, 4)
})

test('STATUS_FORCE_SEND_MS=0 이면 매 주기 전부 전송', async () => {
  const h = makeHarness({ config: makeConfig({ forceSendIntervalMs: 0 }), rows: allRows() })
  h.postImpl = async (_e, b) => okResponse(b)
  const agent = newAgent(h)
  await agent.pushStatus(); await agent.pushStatus()
  assert.equal(h.posts.length, 2)
})

test('MES 장애: 예외는 호출자에게 전달되고 lastSent 는 갱신되지 않아 복구 후 즉시 재전송', async () => {
  const h = makeHarness({ rows: allRows() })
  let down = true
  h.postImpl = async (_e, body) => {
    if (down) throw new MesError('network', '네트워크 오류 /api/lms/ncwatch/status: ENOTFOUND')
    return okResponse(body)
  }
  const agent = newAgent(h)
  await assert.rejects(agent.pushStatus(), (e) => e.kind === 'network')
  await assert.rejects(agent.pushStatus(), (e) => e.kind === 'network')
  assert.equal(agent._lastSent.size, 0)
  down = false
  assert.equal(await agent.pushStatus(), true)
  assert.equal(h.posts.at(-1).body.machines.length, 4)
  assert.ok(h.logText().includes('MES 통신 복구'))
  assert.ok(h.logText().includes('MES 연결 실패'))
})

test('인증 실패는 키 값을 로그에 남기지 않고, .env 의 새 키를 감지해 재시도한다', async () => {
  const h = makeHarness({ rows: allRows() })
  let reloaded = 0
  h.postImpl = async () => { throw new MesError('auth', 'HTTP 401 /api/lms/ncwatch/status — Unauthorized', 401) }
  const agent = newAgent(h, { reloadKey: () => { reloaded++; return reloaded === 1 } })
  await assert.rejects(agent.pushStatus(), (e) => e.kind === 'auth')
  const log = h.logText()
  assert.ok(log.includes('MES 인증 실패'))
  assert.ok(log.includes('키를 감지') || log.includes('변경을 감지'))
  assert.ok(!log.includes(h.config.agentKey))
  assert.ok(!log.includes(h.config.db.password))
})

test('NCWatch DB 전체 장애: 전송 시도 없이 false, 일부 설비 테이블 오류는 나머지를 계속 전송', async () => {
  const rows = allRows()
  rows['CNC-1'] = new Error('relation "TBL_CNC-1_STATUS" does not exist')
  const h = makeHarness({ rows })
  h.postImpl = async (_e, b) => okResponse(b)
  const agent = newAgent(h)
  assert.equal(await agent.pushStatus(), true)
  assert.deepEqual(h.posts[0].body.machines.map((m) => m.machineName), ['CNC-8', 'CNC-9', 'MCT-6'])

  const h2 = makeHarness({ rows: Object.fromEntries(['CNC-1', 'CNC-8', 'CNC-9', 'MCT-6'].map((m) => [m, new Error('connect ECONNREFUSED')])) })
  const agent2 = newAgent(h2)
  assert.equal(await agent2.pushStatus(), false)
  assert.equal(h2.posts.length, 0)
  assert.ok(h2.logText().includes('NCWatch DB 조회 실패'))
})

test('서버가 설비 처리 오류를 돌려주면 다음 주기에 그 설비만 재전송', async () => {
  const h = makeHarness({ rows: allRows() })
  let first = true
  h.postImpl = async (_e, body) => ({
    ok: true,
    machines: body.machines.map((m) => ({ machineName: m.machineName, result: first && m.machineName === 'CNC-9' ? 'ERROR' : 'OK', message: 'INVALID_MAPPING' })),
  })
  const agent = newAgent(h)
  await agent.pushStatus()
  first = false
  await agent.pushStatus()
  assert.equal(h.posts.length, 2)
  assert.deepEqual(h.posts[1].body.machines.map((m) => m.machineName), ['CNC-9'])
})

test('미매핑(UNMAPPED)은 오류로 취급하지 않고 경고만 남기며 재전송 폭주가 없다', async () => {
  const h = makeHarness({ rows: allRows() })
  h.postImpl = async (_e, body) => ({ ok: true, machines: body.machines.map((m) => ({ machineName: m.machineName, result: 'UNMAPPED' })) })
  const agent = newAgent(h)
  await agent.pushStatus(); await agent.pushStatus()
  assert.equal(h.posts.length, 1)
  assert.ok(h.logText().includes('매핑이 없습니다'))
})

test('CNC-1 처럼 OFFLINE 인 설비도 수집 대상에서 제외하지 않고 장애 경고도 남기지 않는다', async () => {
  const h = makeHarness({ rows: allRows() })
  h.postImpl = async (_e, b) => okResponse(b)
  const agent = newAgent(h)
  await agent.pushStatus()
  assert.ok(h.posts[0].body.machines.some((m) => m.machineName === 'CNC-1' && m.statusCode === 4))
  assert.ok(!/\[(WARN|ERROR)\]/.test(h.logText()))
})

// ─── REPORT_DAILY (KST) ───────────────────────────────────────────────────────
test('REPORT_DAILY: KST 날짜로 조회, 자정 직후(KST 0~1시)에는 전날도 함께 전송', async () => {
  // UTC 2026-10-17 16:30 = KST 2026-10-18 01:30
  const h = makeHarness({ clock: { now: () => new Date('2026-10-17T16:30:00Z') } })
  h.reportRows = { 'CNC-8': [{ REPORT_START: '2026-10-18 00:00:00', DATA_1: 'CNC-8', DATA_2: '01:00', DATA_3: '50', DATA_4: '12' }] }
  h.postImpl = async () => ({ ok: true })
  const agent = newAgent(h)
  await agent.pushDailyReport()
  const params = h.dbCalls.filter((c) => c.sql.includes('REPORT_DAILY')).map((c) => c.params[0])
  assert.ok(params.includes('2026-10-17%') && params.includes('2026-10-18%'))
  assert.ok(!params.includes('2026-10-16%'))
  const body = h.posts[0].body.machines
  assert.deepEqual(body.map((b) => b.reportDate).sort(), ['2026-10-17', '2026-10-18'])
  assert.equal(body.find((b) => b.reportDate === '2026-10-18').partCount, 12)

  // 정오 KST 에는 오늘 것만
  const h2 = makeHarness({ clock: { now: () => new Date('2026-10-18T03:00:00Z') } })
  const agent2 = newAgent(h2)
  await agent2.pushDailyReport()
  const p2 = h2.dbCalls.map((c) => c.params[0])
  assert.ok(p2.every((p) => p === '2026-10-18%'))
})

// ─── 스케줄러: 중복 실행 방지 / 자동 복구 ─────────────────────────────────────
test('이전 요청이 끝나지 않으면 STATUS 가 겹쳐 실행되지 않는다', async () => {
  const cfg = makeConfig({ statusIntervalMs: 1000, forceSendIntervalMs: 0, heartbeatIntervalMs: 600000, reportIntervalMs: 86400000, requestTimeoutMs: 1000, dbQueryTimeoutMs: 1000 })
  const h = makeHarness({ config: cfg, rows: allRows() })
  let active = 0, maxActive = 0
  h.postImpl = async (endpoint, body) => {
    if (endpoint.includes('status')) {
      active++; maxActive = Math.max(maxActive, active)
      await sleep(2500) // 주기(1초)보다 느린 서버
      active--
    }
    return okResponse(body)
  }
  // 테스트 가속: 주기 최소값 제한이 없는 내부 스케줄 직접 사용
  const agent = newAgent(h)
  agent.start()
  await sleep(3200)
  await agent.stop()
  assert.equal(maxActive, 1, '동시 실행 없음')
})

test('인터넷 단절 → 복구: 프로세스 예외 없이 계속 시도하고 복구되면 전송 재개', async () => {
  const cfg = makeConfig({ statusIntervalMs: 1000, forceSendIntervalMs: 0, heartbeatIntervalMs: 600000, reportIntervalMs: 86400000 })
  const h = makeHarness({ config: cfg, rows: allRows() })
  let down = true
  let attempts = 0
  h.postImpl = async (endpoint, body) => {
    if (!endpoint.includes('status')) return { ok: true }
    attempts++
    if (down) throw new MesError('network', '네트워크 오류: ENOTFOUND')
    return okResponse(body)
  }
  const agent = newAgent(h)
  agent.start()
  await sleep(1800)
  assert.ok(attempts >= 1)
  down = false
  await sleep(3500) // 백오프(1s→2s) 이후에도 재개되어야 함
  await agent.stop()
  assert.ok(h.posts.some((p) => p.endpoint.includes('status')))
  assert.ok(h.logText().includes('MES 통신 복구'))
})

// ─── 중복 실행 방지(잠금) / 로그 보안 ─────────────────────────────────────────
test('중복 실행 방지: 같은 포트를 두 번째로 잡으면 실패, 해제 후에는 다시 가능', async () => {
  const port = await new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
  const a = await acquireInstanceLock(port)
  assert.equal(a.acquired, true)
  const b = await acquireInstanceLock(port)
  assert.equal(b.acquired, false)
  await a.release()
  const c = await acquireInstanceLock(port)
  assert.equal(c.acquired, true)
  await c.release()
})

test('로그: API Key / DB 비밀번호 / 접속문자열 비밀번호가 마스킹되고 파일에도 남지 않는다', () => {
  const dir = tmpDir()
  const logger = createLogger({ dir, echo: false, getSecrets: () => ['my-db-password-77', 'dwk_SECRETSECRETSECRET1234'] })
  logger.error('fail my-db-password-77 key=dwk_SECRETSECRETSECRET1234 other=dwk_ABCDEFGHIJKLMNOP postgres://u:pw123@host/db')
  const text = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('')
  assert.ok(!text.includes('my-db-password-77'))
  assert.ok(!text.includes('SECRETSECRET'))
  assert.ok(!text.includes('ABCDEFGHIJKLMNOP'))
  assert.ok(!text.includes('pw123'))
  assert.match(text, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[ERROR\]/)
})

test('로그 반복 억제: 같은 장애는 간격 내 1회만 기록', () => {
  const dir = tmpDir()
  let t = 0
  const logger = createLogger({ dir, echo: false, now: () => new Date(Date.UTC(2026, 9, 18, 0, 0, 0) + t) })
  assert.equal(logger.throttle('k', 'WARN', 'a', 1000), true)
  t = 500
  assert.equal(logger.throttle('k', 'WARN', 'a', 1000), false)
  t = 1500
  assert.equal(logger.throttle('k', 'WARN', 'a', 1000), true)
})
