'use strict'

/**
 * MES 수신 API 호출 오류. kind:
 *   timeout  — 응답 제한시간 초과
 *   network  — DNS/연결/소켓 오류(인터넷 단절 등)
 *   auth     — 401/403 (인증키 문제)
 *   http     — 그 외 HTTP 오류(4xx/5xx)
 */
class MesError extends Error {
  constructor(kind, message, status) {
    super(message)
    this.name = 'MesError'
    this.kind = kind
    this.status = status
  }
}

/**
 * POST JSON. 제한시간을 넘기면 요청을 중단(abort)하므로 서버가 응답하지 않아도 무한 대기하지 않는다.
 * 오류 메시지에는 요청 헤더/키를 포함하지 않는다.
 */
async function postJson({ baseUrl, endpoint, key, body, timeoutMs, fetchImpl = globalThis.fetch }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res
  let text
  try {
    res = await fetchImpl(baseUrl + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Key': key },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    text = await res.text()
  } catch (err) {
    if (controller.signal.aborted || (err && err.name === 'AbortError')) {
      throw new MesError('timeout', `응답 제한시간 초과 (${Math.round(timeoutMs / 1000)}초) ${endpoint}`)
    }
    const code = (err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message) || 'unknown'
    throw new MesError('network', `네트워크 오류 ${endpoint}: ${code}`)
  } finally {
    clearTimeout(timer)
  }

  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 비-JSON 응답 */
  }

  if (!res.ok) {
    const detail = (json && (json.error || json.message)) || String(text || '').slice(0, 200) || ''
    const kind = res.status === 401 || res.status === 403 ? 'auth' : 'http'
    throw new MesError(kind, `HTTP ${res.status} ${endpoint}${detail ? ' — ' + detail : ''}`, res.status)
  }
  return json
}

module.exports = { MesError, postJson }
