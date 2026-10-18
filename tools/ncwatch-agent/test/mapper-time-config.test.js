'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const mapper = require('../src/mapper')
const time = require('../src/time')
const config = require('../src/config')
const { makeRow } = require('./helpers')

test('OFFLINE 실측 행(STATUS=4,RUN=0,MESSAGE=202)이 OFFLINE 으로 일관되게 변환된다', () => {
  for (const name of ['CNC-1', 'CNC-8', 'CNC-9', 'MCT-6']) {
    const n = mapper.normalizeStatusRow(makeRow(name), name)
    assert.equal(n.statusCode, 4)
    assert.equal(n.statusLabel, 'OFFLINE')
    assert.equal(n.runLabel, 'OFFLINE')
    assert.equal(n.messageLabel, 'OFFLINE')
    const p = mapper.toStatusPayload(n)
    assert.equal(p.machineName, name)
    assert.equal(p.statusCode, 4)
    assert.equal(p.alarmMessage, null)
    assert.equal(p.ncwatchTs, '2026-10-18 11:39:21')
  }
})

test('STATUS 컬럼이 비어 있으면 READY 로 간주하지 않고 UNKNOWN(null)', () => {
  const n = mapper.normalizeStatusRow({ STATUS: null, RUN: 1 }, 'CNC-8')
  assert.equal(n.statusCode, null)
  assert.equal(n.statusLabel, 'UNKNOWN')
  assert.equal(mapper.toStatusPayload(n).statusCode, null)
})

test('컬럼명 대소문자가 달라도 읽는다', () => {
  const n = mapper.normalizeStatusRow({ status: 3, filename: 'O1', partcount: '7' }, 'MCT-6')
  assert.equal(n.statusCode, 3)
  assert.equal(n.program, 'O1')
  assert.equal(n.partsDone, 7)
})

test('알람 메시지가 있으면 alarmCode/alarmMessage 가 채워진다', () => {
  const n = mapper.normalizeStatusRow(makeRow('CNC-8', { STATUS: 5, ALARM: 1234, ALARMMSG: 'SERVO ALARM' }), 'CNC-8')
  const p = mapper.toStatusPayload(n)
  assert.equal(p.alarmCode, '1234')
  assert.equal(p.alarmMessage, 'SERVO ALARM')
})

test('변경 감지 서명은 aliveCount/ncwatchTs 만 바뀌면 동일, 다른 값이 바뀌면 달라진다', () => {
  const a = mapper.toStatusPayload(mapper.normalizeStatusRow(makeRow('CNC-8'), 'CNC-8'))
  const b = mapper.toStatusPayload(mapper.normalizeStatusRow(makeRow('CNC-8', { ALIVECOUNT: 99, TIMESTAMP_S: '2026-10-18 11:39:31' }), 'CNC-8'))
  const c = mapper.toStatusPayload(mapper.normalizeStatusRow(makeRow('CNC-8', { PARTCOUNT: 1 }), 'CNC-8'))
  assert.equal(mapper.payloadSignature(a), mapper.payloadSignature(b))
  assert.notEqual(mapper.payloadSignature(a), mapper.payloadSignature(c))
})

test('KST 날짜: 서버/PC 타임존과 무관하게 UTC+9 로 계산', () => {
  // UTC 15:00 = KST 다음날 00:00
  assert.equal(time.kstDateString(new Date('2026-10-17T14:59:59Z')), '2026-10-17')
  assert.equal(time.kstDateString(new Date('2026-10-17T15:00:00Z')), '2026-10-18')
  assert.equal(time.kstTimestampString(new Date('2026-10-17T15:00:00Z')), '2026-10-18 00:00:00')
  assert.equal(time.kstDateStringDaysAgo(new Date('2026-10-17T15:00:00Z'), 1), '2026-10-17')
  assert.equal(time.kstHour(new Date('2026-10-17T16:30:00Z')), 1)
})

test('시각 정규화: Date/타임존 문자열은 KST 문자열, 타임존 없는 값은 그대로', () => {
  assert.equal(time.formatNcwatchTimestamp(new Date('2026-10-18T02:39:21Z')), '2026-10-18 11:39:21')
  assert.equal(time.formatNcwatchTimestamp('2026-10-18T02:39:21.000Z'), '2026-10-18 11:39:21')
  assert.equal(time.formatNcwatchTimestamp('2026-10-18 11:39:21'), '2026-10-18 11:39:21')
  assert.equal(time.formatNcwatchTimestamp(null), null)
  assert.equal(time.formatNcwatchTimestamp(new Date('invalid')), null)
})

const goodEnv = () => ({
  MES_API_URL: 'https://daewon-mes.vercel.app/',
  MES_AGENT_KEY: 'dwk_abcdefghijklmnopqrstuvwxyz0123456789',
  NCWATCH_DB_PASSWORD: 'x-secret',
  NCWATCH_MACHINES: 'CNC-1, CNC-8,CNC-9,MCT-6,CNC-8',
})

test('설정: 정상 값은 문제 없음, URL 끝 슬래시 제거, 설비명 중복 제거, 기본 주기', () => {
  const { config: c, problems } = config.loadConfig(goodEnv())
  assert.deepEqual(problems, [])
  assert.equal(c.mesApiUrl, 'https://daewon-mes.vercel.app')
  assert.deepEqual(c.machines, ['CNC-1', 'CNC-8', 'CNC-9', 'MCT-6'])
  assert.equal(c.statusIntervalMs, 10000)
  assert.equal(c.reportIntervalMs, 3600000)
  assert.equal(c.heartbeatIntervalMs, 30000)
})

test('설정: DB 비밀번호 기본값이 없다 / 데모 키 거부 / 비 https 거부 / SQL 주입성 설비명 거부', () => {
  const e1 = goodEnv(); delete e1.NCWATCH_DB_PASSWORD
  assert.ok(config.loadConfig(e1).problems.some((p) => p.includes('NCWATCH_DB_PASSWORD')))
  assert.equal(config.loadConfig(e1).config.db.password, undefined)

  const e2 = { ...goodEnv(), MES_AGENT_KEY: 'gw-api-key-demo-001' }
  assert.ok(config.loadConfig(e2).problems.some((p) => p.includes('데모')))

  const e3 = { ...goodEnv(), MES_API_URL: 'http://daewon-mes.vercel.app' }
  assert.ok(config.loadConfig(e3).problems.some((p) => p.includes('https')))
  assert.deepEqual(config.loadConfig({ ...goodEnv(), MES_API_URL: 'http://localhost:3000' }).problems, [])

  const e4 = { ...goodEnv(), NCWATCH_MACHINES: 'CNC-1,x";DROP TABLE a;--' }
  const r4 = config.loadConfig(e4)
  assert.deepEqual(r4.config.machines, ['CNC-1'])
  assert.ok(r4.problems.some((p) => p.includes('허용되지 않는')))
})

test('설정: .env 파싱(주석/따옴표/BOM/CRLF)', () => {
  const env = config.parseEnv('﻿# c\r\nA=1\r\nB="two words" # x\r\nC=3 # tail\r\n=bad\r\nD=\r\n')
  assert.equal(env.A, '1'); assert.equal(env.B, 'two words'); assert.equal(env.C, '3'); assert.equal(env.D, '')
})

test('소스에 하드코딩된 키/비밀번호/데모 URL 이 없다', () => {
  const fs = require('fs'); const path = require('path')
  const root = path.join(__dirname, '..')
  const files = ['index.js', 'check-connection.js', 'list-machines.js', ...fs.readdirSync(path.join(root, 'src')).map((f) => 'src/' + f)]
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8')
    assert.ok(!/ncwatch!/.test(text), `${f}: 기본 DB 비밀번호`)
    assert.ok(!/newmes\.vercel\.app/.test(text), `${f}: 데모 MES URL`)
    assert.ok(!/dwk_[A-Za-z0-9_-]{16,}/.test(text), `${f}: 키 형태 문자열`)
  }
})
