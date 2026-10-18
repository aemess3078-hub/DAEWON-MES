'use strict'
const fs = require('fs')
const path = require('path')
const { kstDateString, kstTimestampString } = require('./time')

const KEY_PATTERN = /dwk_[A-Za-z0-9_-]{8,}/g
const URL_CRED_PATTERN = /(\w+:\/\/[^:\s/@]+:)[^@\s]+@/g

/**
 * 파일 + 콘솔 로거.
 *  - 일자별 파일(agent-YYYYMMDD.log, KST), 보관일 초과분 자동 삭제
 *  - API Key / DB 비밀번호 등 비밀값은 어떤 경로로도 기록되지 않도록 마스킹
 *  - throttle(): 같은 종류 메시지가 반복될 때 간격당 1회만 기록(장애 중 로그 폭주 방지)
 */
function createLogger({ dir, retentionDays = 30, getSecrets = () => [], echo = true, now = () => new Date() }) {
  let currentDate = null
  let dirReady = false
  const throttled = new Map()

  function redact(text) {
    let out = String(text)
    for (const secret of getSecrets()) {
      if (secret && secret.length >= 4) out = out.split(secret).join('***')
    }
    return out.replace(KEY_PATTERN, 'dwk_***').replace(URL_CRED_PATTERN, '$1***@')
  }

  function ensureDir() {
    if (dirReady) return true
    try {
      fs.mkdirSync(dir, { recursive: true })
      dirReady = true
    } catch {
      /* 로그 디렉터리를 만들 수 없어도 에이전트는 계속 동작한다 */
    }
    return dirReady
  }

  function purgeOld() {
    try {
      const cutoff = now().getTime() - retentionDays * 24 * 60 * 60 * 1000
      for (const name of fs.readdirSync(dir)) {
        if (!/^agent-\d{8}\.log$/.test(name)) continue
        const full = path.join(dir, name)
        if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full)
      }
    } catch {
      /* ignore */
    }
  }

  function write(level, message) {
    const date = now()
    const line = `${kstTimestampString(date)} [${level}] ${redact(message)}`
    if (echo) {
      const out = level === 'ERROR' || level === 'WARN' ? console.error : console.log
      out(line)
    }
    if (!ensureDir()) return
    const today = kstDateString(date)
    if (today !== currentDate) {
      currentDate = today
      purgeOld()
    }
    try {
      fs.appendFileSync(path.join(dir, `agent-${today.replace(/-/g, '')}.log`), line + '\n', 'utf8')
    } catch {
      /* ignore */
    }
  }

  const logger = {
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    redact,
    /** key 별로 everyMs 마다 최대 1회만 기록. 기록되었으면 true */
    throttle(key, level, message, everyMs) {
      const t = now().getTime()
      const last = throttled.get(key)
      if (last !== undefined && t - last < everyMs) return false
      throttled.set(key, t)
      write(level, message)
      return true
    },
    /** throttle 상태 초기화(복구 시 다음 장애를 즉시 기록하기 위해) */
    resetThrottle(prefix) {
      for (const k of Array.from(throttled.keys())) if (k.startsWith(prefix)) throttled.delete(k)
    },
  }
  return logger
}

module.exports = { createLogger }
