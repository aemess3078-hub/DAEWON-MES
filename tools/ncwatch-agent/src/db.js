'use strict'
// NCWatch PostgreSQL 연결 (읽기 전용 조회). pg 는 실제로 DB 를 쓸 때만 불러온다(테스트에서 주입 가능).

function createDb(dbConfig, { queryTimeoutMs = 10000, onPoolError = () => {} } = {}) {
  const pg = require('pg')
  // 타임존 없는 timestamp(1114)/date(1082)는 문자열 그대로 받는다.
  // (PC 의 OS 타임존에 따라 Date 로 변환되며 시각이 어긋나는 것을 방지 — 서버가 타임존 없는 값을 KST 로 해석)
  pg.types.setTypeParser(1114, (v) => v)
  pg.types.setTypeParser(1082, (v) => v)

  let pool = null
  function getPool() {
    if (!pool) {
      pool = new pg.Pool({
        host: dbConfig.host,
        port: dbConfig.port,
        database: dbConfig.database,
        user: dbConfig.user,
        password: dbConfig.password,
        ssl: dbConfig.ssl ? { rejectUnauthorized: false } : false,
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
        statement_timeout: queryTimeoutMs,
        query_timeout: queryTimeoutMs + 2000,
        keepAlive: true,
      })
      // 유휴 연결이 DB 재시작 등으로 끊겨도 프로세스가 죽지 않는다. 풀이 해당 연결을 버리고 다음 질의 때 새로 연결한다.
      pool.on('error', (err) => onPoolError(err))
    }
    return pool
  }

  return {
    query: (sql, params = []) => getPool().query(sql, params),
    async end() {
      if (pool) {
        const p = pool
        pool = null
        await p.end().catch(() => {})
      }
    },
  }
}

module.exports = { createDb }
