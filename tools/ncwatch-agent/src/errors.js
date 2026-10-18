'use strict'

/** pg 의 AggregateError(ECONNREFUSED 등)처럼 message 가 비어 있는 오류도 원인을 읽을 수 있게 설명한다. */
function describeError(err) {
  if (!err) return '알 수 없는 오류'
  const parts = []
  if (err.message) parts.push(String(err.message))
  if (err.code && !parts.join(' ').includes(err.code)) parts.push(String(err.code))
  if (Array.isArray(err.errors)) {
    for (const e of err.errors) {
      const d = e && (e.code || e.message)
      if (d && !parts.join(' ').includes(d)) parts.push(String(d))
    }
  }
  return parts.join(' ') || err.name || '알 수 없는 오류'
}

module.exports = { describeError }
