'use strict'
// NCWatch → MES 브리지 에이전트 진입점 (현장 PC, 24시간 운영)
//
// 종료 코드(run-agent.ps1 이 해석):
//   0  정상 종료(중지 요청)            → 재시작하지 않음
//   2  설정 오류(.env)                 → 60초 후 재시도 (.env 수정하면 자동 반영)
//   3  이미 다른 에이전트가 실행 중     → 재시작하지 않음
//   그 외(예기치 않은 오류)             → 10초 후 재시작

const { AGENT_DIR, loadEnvFile, loadConfig, collectSecrets, readAgentKeyFromEnvFile, resolveEnvFile } = require('./src/config')
const { createLogger } = require('./src/logger')
const { createStateWriter } = require('./src/state')
const { postJson } = require('./src/mes-client')
const { acquireInstanceLock } = require('./src/single-instance')
const { createAgent } = require('./src/agent')
const { createDb } = require('./src/db')
const { describeError } = require('./src/errors')
const pkg = require('./package.json')

async function main() {
  loadEnvFile(resolveEnvFile())
  const { config, problems } = loadConfig(process.env)

  // 설정이 잘못되어도 로그 파일에는 남긴다(비밀값 없음).
  const secrets = () => collectSecrets(config)
  const logger = createLogger({ dir: config.logDir, retentionDays: config.logRetentionDays, getSecrets: secrets, echo: Boolean(process.stdout.isTTY) })

  logger.info('='.repeat(60))
  logger.info(`NCWatch → MES Bridge Agent v${pkg.version} 시작 (pid=${process.pid}, node=${process.version})`)

  if (typeof fetch !== 'function') {
    logger.error(`Node.js 18 이상이 필요합니다 (현재 ${process.version})`)
    process.exit(2)
  }
  if (problems.length) {
    for (const p of problems) logger.error(`설정 오류: ${p}`)
    logger.error(`${config.envFile} 를 확인하세요. 60초 후 다시 시도합니다.`)
    process.exit(2)
  }

  const lock = await acquireInstanceLock(config.lockPort)
  if (!lock.acquired) {
    logger.error(`이미 에이전트가 실행 중입니다 (127.0.0.1:${config.lockPort} 사용 중: ${lock.error}). 이 프로세스는 종료합니다.`)
    process.exit(3)
  }

  logger.info(`대상 MES  : ${config.mesApiUrl}`)
  logger.info(`대상 설비 : ${config.machines.join(', ')} (${config.machines.length}대)`)
  logger.info(
    `주기      : STATUS ${config.statusIntervalMs / 1000}초 / REPORT ${config.reportIntervalMs / 60000}분 / ` +
    `HEARTBEAT ${config.heartbeatIntervalMs / 1000}초 / 변경 없는 설비 강제 전송 ${config.forceSendIntervalMs / 1000}초`
  )
  logger.info(`NCWatch DB: ${config.db.host}:${config.db.port}/${config.db.database} (user=${config.db.user})`)

  const state = createStateWriter(config.stateFile, {
    pid: process.pid,
    version: pkg.version,
    startedAt: new Date().toISOString(),
    machineNames: config.machines,
    mesApiUrl: config.mesApiUrl,
    machines: {},
  })
  state.flush()

  const db = createDb(config.db, {
    queryTimeoutMs: config.dbQueryTimeoutMs,
    onPoolError: (err) => logger.throttle('db:pool', 'WARN', `NCWatch DB 연결 오류(자동 재연결 예정): ${describeError(err)}`, 60 * 1000),
  })

  // 시작 시 DB 연결을 한 번 확인하되, 실패해도 종료하지 않는다(DB 가 늦게 올라오는 부팅 직후 대비).
  try {
    await db.query('SELECT 1')
    logger.info('NCWatch DB 연결 성공')
  } catch (err) {
    logger.warn(`NCWatch DB 연결 실패: ${describeError(err)} — 종료하지 않고 계속 재시도합니다`)
  }

  const keyHolder = { key: config.agentKey }
  const agent = createAgent({
    config,
    logger,
    state,
    db,
    version: pkg.version,
    post: (endpoint, body) =>
      postJson({ baseUrl: config.mesApiUrl, endpoint, key: keyHolder.key, body, timeoutMs: config.requestTimeoutMs }),
    reloadKey: () => {
      const fresh = readAgentKeyFromEnvFile(config.envFile)
      if (fresh && fresh !== keyHolder.key) {
        keyHolder.key = fresh
        config.agentKey = fresh // 로그 마스킹 대상에도 새 키 반영
        return true
      }
      return false
    },
  })

  let shuttingDown = false
  async function shutdown(reason, code = 0) {
    if (shuttingDown) return
    shuttingDown = true
    logger.info(`에이전트 종료 시작 (${reason})`)
    try {
      await agent.stop()
      await db.end()
      await lock.release()
      state.set({ stoppedAt: new Date().toISOString(), running: false })
      state.flush()
    } catch (err) {
      logger.error(`종료 처리 중 오류: ${err.message}`)
    }
    logger.info('에이전트 종료 완료')
    process.exit(code)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGBREAK', () => shutdown('SIGBREAK'))
  // 네트워크/DB 장애로 인한 비동기 오류는 프로세스를 죽이지 않는다.
  process.on('unhandledRejection', (reason) => {
    logger.throttle('unhandled', 'ERROR', `처리되지 않은 Promise 오류: ${reason && reason.stack ? reason.stack : reason}`, 60 * 1000)
  })
  // 상태를 알 수 없는 동기 예외는 종료 후 래퍼(run-agent.ps1)가 재시작한다.
  process.on('uncaughtException', (err) => {
    logger.error(`치명적 오류, 재시작을 위해 종료합니다: ${err && err.stack ? err.stack : err}`)
    process.exit(1)
  })

  state.set({ running: true })
  agent.start()
  logger.info('수집을 시작했습니다')
}

main().catch((err) => {
  console.error('[Agent] 시작 실패:', err && err.message)
  process.exit(1)
})

void AGENT_DIR
