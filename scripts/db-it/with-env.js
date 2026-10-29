// 로컬 테스트 DB 전용 실행 래퍼: 로컬 테스트 DB 조건(scripts/helpers/local-test-db-guard.ts)을 확인한 뒤에만 명령을 실행한다.
//  - .env / .env.local 을 읽지 않는다(이전에는 .env.local 의 운영 DB 정보를 환경변수로 올려 임의 명령을 실행했다).
//  - 조건을 만족하지 않으면 명령을 실행하지 않고 종료한다(exit 2).
// 사용: DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB DATABASE_URL=postgresql://…@127.0.0.1:포트/<이름>_test DEFAULT_TENANT_ID=<테넌트> \
//       node scripts/db-it/with-env.js <명령> [인자...]      예) 로컬 테스트 DB 에 붙인 Next 서버 기동
const { spawn } = require("child_process")
const path = require("path")

// 가드는 TypeScript 모듈 하나만 유지하고(중복 정의 금지) 여기서는 transpile-only 로 불러온다.
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", target: "es2019" } })
const { assertLocalTestDbOrExit } = require(path.join(__dirname, "..", "helpers", "local-test-db-guard.ts"))

assertLocalTestDbOrExit("db-it/with-env", process.env, { baseUrlVar: "UI_BASE", defaultBaseUrl: "http://localhost:3130" })
if (!process.env.DEFAULT_TENANT_ID) {
  console.error("ABORT [db-it/with-env]: DEFAULT_TENANT_ID 가 지정되지 않았습니다.")
  process.exit(2)
}

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error("실행할 명령이 없습니다.")
  process.exit(2)
}
const child = spawn(cmd, args, { stdio: "inherit", shell: true, env: process.env })
child.on("exit", (code) => process.exit(code ?? 1))
