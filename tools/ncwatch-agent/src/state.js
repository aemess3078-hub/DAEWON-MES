'use strict'
const fs = require('fs')
const path = require('path')

/**
 * 에이전트 상태 파일(state/agent-status.json) — check-agent.ps1 이 읽는다.
 * 비밀값(키/비밀번호)은 절대 기록하지 않는다. 임시 파일에 쓴 뒤 이름을 바꿔 부분 기록을 피한다.
 */
function createStateWriter(file, initial) {
  const state = { ...initial }
  let lastWrite = 0
  let dirty = false

  function flush(force = false) {
    const now = Date.now()
    if (!force && now - lastWrite < 3000) {
      dirty = true
      return
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const tmp = file + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
      fs.renameSync(tmp, file)
      lastWrite = now
      dirty = false
    } catch {
      /* 상태 파일을 못 써도 수집은 계속한다 */
    }
  }

  return {
    state,
    set(patch) {
      Object.assign(state, patch)
      flush()
    },
    setMachine(name, patch) {
      state.machines = state.machines || {}
      state.machines[name] = { ...(state.machines[name] || {}), ...patch }
      flush()
    },
    flush: () => flush(true),
    isDirty: () => dirty,
  }
}

module.exports = { createStateWriter }
