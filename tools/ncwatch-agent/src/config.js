'use strict'
const fs = require('fs')
const path = require('path')

const AGENT_DIR = path.resolve(__dirname, '..')
const DEMO_KEYS = ['gw-api-key-demo-001']

/** .env 텍스트 파싱 (KEY=VALUE, # 주석, 따옴표 허용). 의존성 없는 최소 구현. */
function parseEnv(text) {
  const out = {}
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '').trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quoted = value.match(/^"([^"]*)"/) || value.match(/^'([^']*)'/)
    if (quoted) {
      value = quoted[1]
    } else {
      // 따옴표 없는 값의 뒤쪽 " #주석" 제거
      value = value.replace(/\s+#.*$/, '')
    }
    out[key] = value
  }
  return out
}

function resolveEnvFile(env = process.env) {
  return env.AGENT_ENV_FILE ? path.resolve(env.AGENT_ENV_FILE) : path.join(AGENT_DIR, '.env')
}

/** .env 값을 env 에 채운다. 이미 설정된 환경변수(시스템/프로세스)가 우선한다. */
function loadEnvFile(file = resolveEnvFile(), env = process.env) {
  if (!fs.existsSync(file)) return false
  const parsed = parseEnv(fs.readFileSync(file, 'utf8'))
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] === undefined) env[k] = v
  }
  return true
}

function readIntEnv(env, key, def, min, max) {
  const raw = env[key]
  if (raw === undefined || raw === '') return def
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n)) return def
  return Math.min(Math.max(n, min), max)
}

/** 테이블명에 그대로 들어가므로 따옴표/세미콜론 등을 허용하지 않는다. */
const MACHINE_NAME_RE = /^[\p{L}\p{N}_-]{1,50}$/u

function parseMachines(raw) {
  const seen = new Set()
  const names = []
  const invalid = []
  for (const part of String(raw || '').split(',')) {
    const name = part.trim()
    if (!name) continue
    if (!MACHINE_NAME_RE.test(name)) {
      invalid.push(name)
      continue
    }
    if (seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return { names, invalid }
}

function loadConfig(env = process.env) {
  const { names, invalid } = parseMachines(env.NCWATCH_MACHINES)
  const problems = []

  const mesApiUrl = String(env.MES_API_URL || '').trim().replace(/\/+$/, '')
  const agentKey = String(env.MES_AGENT_KEY || '').trim()
  const dbPassword = env.NCWATCH_DB_PASSWORD

  if (!mesApiUrl) problems.push('MES_API_URL 미설정')
  else {
    try {
      const u = new URL(mesApiUrl)
      if (u.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
        problems.push('MES_API_URL 은 https 여야 합니다 (로컬 테스트 제외)')
      }
    } catch {
      problems.push('MES_API_URL 형식 오류')
    }
  }
  if (!agentKey) problems.push('MES_AGENT_KEY 미설정')
  else if (DEMO_KEYS.includes(agentKey)) problems.push('MES_AGENT_KEY 가 데모 키입니다 — 운영용 키로 교체하세요')
  if (dbPassword === undefined || dbPassword === '') problems.push('NCWATCH_DB_PASSWORD 미설정 (코드에 기본 비밀번호를 두지 않습니다)')
  if (names.length === 0) problems.push('NCWATCH_MACHINES 미설정 또는 유효한 설비명 없음')
  for (const bad of invalid) problems.push(`NCWATCH_MACHINES 에 허용되지 않는 설비명: ${JSON.stringify(bad)}`)

  const config = {
    mesApiUrl,
    agentKey,
    machines: names,
    db: {
      host: env.NCWATCH_DB_HOST || 'localhost',
      port: readIntEnv(env, 'NCWATCH_DB_PORT', 5433, 1, 65535),
      database: env.NCWATCH_DB_NAME || 'ncwatch',
      user: env.NCWATCH_DB_USER || 'ncwatch',
      password: dbPassword,
      ssl: env.NCWATCH_DB_SSL === 'true',
    },
    statusIntervalMs: readIntEnv(env, 'STATUS_INTERVAL_MS', 10000, 1000, 600000),
    reportIntervalMs: readIntEnv(env, 'REPORT_INTERVAL_MS', 3600000, 60000, 24 * 3600000),
    heartbeatIntervalMs: readIntEnv(env, 'HEARTBEAT_INTERVAL_MS', 30000, 5000, 600000),
    // 변경이 없는 설비도 이 간격마다 한 번은 전송한다(마지막 수신시간 갱신). 0 이면 매 사이클 전부 전송.
    forceSendIntervalMs: readIntEnv(env, 'STATUS_FORCE_SEND_MS', 60000, 0, 3600000),
    requestTimeoutMs: readIntEnv(env, 'MES_REQUEST_TIMEOUT_MS', 15000, 1000, 120000),
    dbQueryTimeoutMs: readIntEnv(env, 'NCWATCH_DB_QUERY_TIMEOUT_MS', 10000, 1000, 120000),
    logDir: path.resolve(env.AGENT_LOG_DIR || path.join(AGENT_DIR, 'logs')),
    logRetentionDays: readIntEnv(env, 'AGENT_LOG_RETENTION_DAYS', 30, 1, 3650),
    stateFile: path.resolve(env.AGENT_STATE_FILE || path.join(AGENT_DIR, 'state', 'agent-status.json')),
    lockPort: readIntEnv(env, 'AGENT_LOCK_PORT', 47831, 1024, 65535),
    envFile: resolveEnvFile(env),
  }
  return { config, problems }
}

/** 로그 마스킹 대상 비밀값 목록 */
function collectSecrets(config) {
  return [config.agentKey, config.db && config.db.password].filter((v) => typeof v === 'string' && v.length >= 4)
}

/** 인증 실패 시 .env 에서 키를 다시 읽는다(키 교체 후 재시작 없이 반영). 읽지 못하면 null. */
function readAgentKeyFromEnvFile(file) {
  try {
    if (!fs.existsSync(file)) return null
    const parsed = parseEnv(fs.readFileSync(file, 'utf8'))
    const key = String(parsed.MES_AGENT_KEY || '').trim()
    return key || null
  } catch {
    return null
  }
}

module.exports = {
  AGENT_DIR,
  DEMO_KEYS,
  parseEnv,
  loadEnvFile,
  loadConfig,
  parseMachines,
  collectSecrets,
  readAgentKeyFromEnvFile,
  resolveEnvFile,
}
