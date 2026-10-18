'use strict'
// NCWatch DB 에 실제로 존재하는 설비명을 찾아 NCWATCH_MACHINES 한 줄로 출력한다. (읽기 전용)
// 사용: npm run machines

const { loadEnvFile, loadConfig, resolveEnvFile } = require('./src/config')
const { createDb } = require('./src/db')
const { describeError } = require('./src/errors')

;(async () => {
  loadEnvFile(resolveEnvFile())
  const { config } = loadConfig(process.env) // 문제 목록은 무시하고 DB 접속 값만 사용
  if (!config.db.password) {
    console.error('NCWATCH_DB_PASSWORD 가 .env 에 없습니다.')
    process.exit(2)
  }
  const db = createDb(config.db, { queryTimeoutMs: config.dbQueryTimeoutMs })
  try {
    const { rows } = await db.query(
      `SELECT table_name FROM information_schema.tables WHERE table_name ILIKE 'TBL_%_STATUS' ORDER BY table_name`
    )
    const names = []
    console.log('발견된 STATUS 테이블:')
    for (const r of rows) {
      const m = r.table_name.match(/^TBL_(.+)_STATUS$/i)
      if (m) {
        names.push(m[1])
        console.log(`  - ${m[1]}   (테이블: ${r.table_name})`)
      }
    }
    if (!names.length) console.log('  (없음) DB/권한을 확인하세요.')
    else console.log('\n.env 에 붙여넣기 ↓\nNCWATCH_MACHINES=' + names.join(','))
  } catch (err) {
    console.error('조회 실패:', describeError(err))
    process.exitCode = 1
  } finally {
    await db.end()
  }
})()
