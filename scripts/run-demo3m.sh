#!/bin/bash
# 3개월 시연 데이터 seed 러너. 사용: scripts/run-demo3m.sh [test|manual] --dry-run|--apply|--verify [옵션]
# test = WSL 테스트 PG(54329/daewon_mes_manual_demo3m_test), manual = .env 의 로컬 매뉴얼 DB. 비밀값은 출력하지 않는다.
set -e
cd "$(dirname "$0")/.."
T="$1"; shift
set -a; eval "$(grep -E '^[A-Z_]+=' .env.local | grep -vE '^(DATABASE_URL|DIRECT_URL)=')"; set +a
if [ "$T" = "test" ]; then
  # 테스트 PG 비밀번호는 코드에 두지 않는다. 실행 전 DEMO3M_TEST_DB_PASSWORD 환경변수로 반드시 지정할 것.
  : "${DEMO3M_TEST_DB_PASSWORD:?DEMO3M_TEST_DB_PASSWORD 환경변수가 필요합니다 (테스트 PG 비밀번호)}"
  PW="$DEMO3M_TEST_DB_PASSWORD"
  export DATABASE_URL="postgresql://daewon_mes_test:${PW}@127.0.0.1:54329/daewon_mes_manual_demo3m_test?schema=public"
  export DIRECT_URL="$DATABASE_URL"; TARGETARG="--target=test"
else
  unset DATABASE_URL DIRECT_URL; TARGETARG="--target=manual"
fi
export TS_NODE_TRANSPILE_ONLY=1
exec npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node","target":"es2020"}' --project tsconfig.json prisma/seed-manual-3months.ts "$@" $TARGETARG
