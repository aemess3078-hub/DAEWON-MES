'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createLogger } = require('../src/logger')
const { createStateWriter } = require('../src/state')

// 2026-10-18(일) 현장 실측: 4대 모두 전원 OFF (STATUS=4, RUN=0, MODE=0, MESSAGE=202)
const OFFLINE_ROWS = {
  'CNC-1': { STATUS: 4, RUN: 0, MODE: 0, MESSAGE: 202, FILENAME: 'O4596' },
  'CNC-8': { STATUS: 4, RUN: 0, MODE: 0, MESSAGE: 202, FILENAME: 'O4600' },
  'CNC-9': { STATUS: 4, RUN: 0, MODE: 0, MESSAGE: 202, FILENAME: 'O4600' },
  'MCT-6': { STATUS: 4, RUN: 0, MODE: 0, MESSAGE: 202, FILENAME: 'O4608' },
}

function makeRow(machine, extra = {}) {
  return {
    TIMESTAMP_S: '2026-10-18 11:39:21',
    MACHINE_NAME: machine,
    ...OFFLINE_ROWS[machine],
    SPINDLE: 0, FEED: 0, AXIS_X: '0.000', AXIS_Y: '0.000', AXIS_Z: '0.000',
    PARTCOUNT: 0, ALIVECOUNT: 1, ...extra,
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ncwatch-agent-test-'))
}

function makeConfig(overrides = {}) {
  return {
    mesApiUrl: 'http://127.0.0.1:1',
    agentKey: 'dwk_TESTKEY_TESTKEY_TESTKEY_0123456789',
    machines: ['CNC-1', 'CNC-8', 'CNC-9', 'MCT-6'],
    db: { host: 'localhost', port: 5433, database: 'ncwatch', user: 'ncwatch', password: 'dbpass-secret-1234', ssl: false },
    statusIntervalMs: 10000,
    reportIntervalMs: 3600000,
    heartbeatIntervalMs: 30000,
    forceSendIntervalMs: 60000,
    requestTimeoutMs: 15000,
    dbQueryTimeoutMs: 10000,
    ...overrides,
  }
}

function makeHarness({ config = makeConfig(), rows = {}, clock } = {}) {
  const dir = tmpDir()
  const logger = createLogger({
    dir, echo: false,
    getSecrets: () => [config.agentKey, config.db.password],
    now: () => (clock ? clock.now() : new Date()),
  })
  const state = createStateWriter(path.join(dir, 'state.json'), { machines: {} })
  const posts = []
  const dbCalls = []
  const h = {
    dir, logger, state, posts, dbCalls, config,
    rows: { ...rows }, // machine -> row | Error | null
    postImpl: async () => ({ ok: true, machines: [] }),
    db: {
      query: async (sql, params) => {
        dbCalls.push({ sql, params })
        const m = /"TBL_(.+?)_(STATUS|REPORT_DAILY)"/.exec(sql)
        const machine = m && m[1]
        const kind = m && m[2]
        if (kind === 'STATUS') {
          const v = h.rows[machine]
          if (v instanceof Error) throw v
          return { rows: v ? [v] : [] }
        }
        const rep = h.reportRows && h.reportRows[machine]
        if (rep instanceof Error) throw rep
        return { rows: rep || [] }
      },
    },
    post: async (endpoint, body) => {
      posts.push({ endpoint, body })
      return h.postImpl(endpoint, body)
    },
    clock,
    logText: () => {
      const files = fs.readdirSync(dir).filter((f) => f.startsWith('agent-'))
      return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n')
    },
  }
  return h
}

module.exports = { OFFLINE_ROWS, makeRow, makeConfig, makeHarness, tmpDir }
