'use strict'
// KST(Asia/Seoul, UTC+9, 서머타임 없음) 날짜/시간 유틸.
// 현장 PC 의 OS 타임존 설정과 무관하게 항상 한국시간으로 계산한다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function pad(n, len = 2) {
  return String(n).padStart(len, '0')
}

function kstParts(date) {
  const k = new Date(date.getTime() + KST_OFFSET_MS)
  return {
    year: k.getUTCFullYear(),
    month: k.getUTCMonth() + 1,
    day: k.getUTCDate(),
    hour: k.getUTCHours(),
    minute: k.getUTCMinutes(),
    second: k.getUTCSeconds(),
  }
}

/** "YYYY-MM-DD" (KST) */
function kstDateString(date) {
  const p = kstParts(date)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** "YYYY-MM-DD HH:mm:ss" (KST) — MES 서버가 타임존 없는 값을 KST 로 해석한다. */
function kstTimestampString(date) {
  const p = kstParts(date)
  return `${kstDateString(date)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}

function kstHour(date) {
  return kstParts(date).hour
}

/** KST 기준 n일 전 날짜 문자열 */
function kstDateStringDaysAgo(date, days) {
  return kstDateString(new Date(date.getTime() - days * 24 * 60 * 60 * 1000))
}

/**
 * NCWatch 행의 시각 값을 MES 로 보낼 문자열로 정규화한다.
 *  - Date 객체 → KST 문자열
 *  - 타임존(Z/+09:00)이 붙은 문자열 → KST 문자열
 *  - 타임존 없는 문자열("2026-10-18 11:39:21") → 그대로(서버가 KST 로 해석)
 */
function formatNcwatchTimestamp(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : kstTimestampString(value)
  }
  const text = String(value).trim()
  if (!text) return null
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(text) && /^\d{4}-\d{2}-\d{2}/.test(text)) {
    const d = new Date(text)
    if (!Number.isNaN(d.getTime())) return kstTimestampString(d)
  }
  return text
}

module.exports = {
  KST_OFFSET_MS,
  kstParts,
  kstDateString,
  kstTimestampString,
  kstHour,
  kstDateStringDaysAgo,
  formatNcwatchTimestamp,
}
