'use strict'
// 설치 후 연결 점검 (비밀값은 출력하지 않는다).
//   1) 설정 검증  2) NCWatch DB: 설비별 STATUS 조회  3) MES: 하트비트 인증 테스트
// 사용: npm run check            (하트비트 1회 전송 — Gateway 가 ONLINE 으로 갱신됩니다)
//       npm run check -- --no-mes (MES 호출 없이 DB 만 점검)

const { loadEnvFile, loadConfig, resolveEnvFile } = require('./src/config')
const { createDb } = require('./src/db')
const { postJson, MesError } = require('./src/mes-client')
const mapper = require('./src/mapper')
const { describeError } = require('./src/errors')
const pkg = require('./package.json')

const skipMes = process.argv.includes('--no-mes')
const configOnly = process.argv.includes('--config-only')
let failed = 0
const pass = (m) => console.log(`  [PASS] ${m}`)
const fail = (m) => { failed++; console.log(`  [FAIL] ${m}`) }
const note = (m) => console.log(`  [참고] ${m}`)

;(async () => {
  loadEnvFile(resolveEnvFile())
  const { config, problems } = loadConfig(process.env)

  console.log('1) 설정')
  if (problems.length) problems.forEach(fail)
  else pass(`MES_API_URL=${config.mesApiUrl}, 설비 ${config.machines.length}대 (${config.machines.join(', ')})`)

  if (configOnly) {
    // 설치 전 사전 점검용: 설정만 검증하고 값은 출력하지 않는다.
    process.exit(problems.length ? 1 : 0)
  }

  console.log('2) NCWatch DB 조회 (읽기 전용)')
  const db = createDb(config.db, { queryTimeoutMs: config.dbQueryTimeoutMs })
  try {
    for (const machine of config.machines) {
      try {
        const { rows } = await db.query(`SELECT * FROM "TBL_${machine}_STATUS" LIMIT 1`)
        if (!rows.length) { fail(`${machine}: STATUS 행 없음`); continue }
        const n = mapper.normalizeStatusRow(rows[0], machine)
        pass(`${machine}: STATUS=${n.statusCode}(${n.statusLabel}) RUN=${n.run} MODE=${n.mode} MESSAGE=${n.message} 프로그램=${n.program || '-'} 행시각=${n.timestamp || '-'}`)
        if (n.statusCode === 4) note(`${machine}: OFFLINE — 설비 전원 꺼짐/미연결이면 정상입니다 (DB 조회 성공 ≠ 설비 통신 정상)`)
      } catch (err) {
        fail(`${machine}: ${describeError(err)}`)
      }
    }
  } finally {
    await db.end()
  }

  console.log('3) MES 인증 (하트비트)')
  if (skipMes) note('--no-mes: 건너뜀')
  else if (problems.length) fail('설정 오류로 건너뜀')
  else {
    try {
      const res = await postJson({
        baseUrl: config.mesApiUrl, endpoint: '/api/lms/ncwatch/heartbeat', key: config.agentKey,
        body: { agentVersion: pkg.version + '-check', machineCount: config.machines.length, uptime: 0 },
        timeoutMs: config.requestTimeoutMs,
      })
      pass(`하트비트 인증 성공 (서버시각 ${res && res.serverTime})`)
    } catch (err) {
      fail(err instanceof MesError ? `[${err.kind}] ${err.message}` : err.message)
    }
  }

  console.log(failed ? `\n결과: 실패 ${failed}건` : '\n결과: 모두 통과')
  process.exit(failed ? 1 : 0)
})()
