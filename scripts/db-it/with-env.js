// 접속 환경(.env.local, 저장소 밖)을 프로세스 환경변수로 올린 뒤 명령을 실행한다. 값은 출력하지 않는다.
// 실제 화면 테스트용 Next 서버(build/start)를 대원정밀 테스트 DB 에 붙일 때만 쓴다.
// 사용: DAEWON_DB_IT_CONFIRM=<대원정밀 프로젝트 식별자> node scripts/db-it/with-env.js <명령> [인자...]
// env.ts 의 verifyTarget 과 같은 조건을 만족하지 않으면 명령을 실행하지 않는다.
const fs = require("fs")
const { spawn } = require("child_process")

const EXPECTED_PROJECT_REF = "aquqetajewvhyirmewfy"
const EXPECTED_DATABASE = "postgres"
const EXPECTED_TENANT = "daewon-001"

const file = process.env.DAEWON_ENV_FILE || "C:/Users/Mingrid/Documents/사업/MES/01_REPOS/DAEWON-MES/.env.local"
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

function refOf(url) {
  if (!url) return { database: "", projectRef: "" }
  const u = new URL(url)
  return { database: u.pathname.replace("/", ""), projectRef: decodeURIComponent(u.username).split(".")[1] || "" }
}
const main = refOf(process.env.DATABASE_URL)
const direct = refOf(process.env.DIRECT_URL)
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname : ""
const problems = []
if (process.env.DAEWON_DB_IT_CONFIRM !== EXPECTED_PROJECT_REF) problems.push("DAEWON_DB_IT_CONFIRM 이 대원정밀 프로젝트 식별자와 다름(실행 확인 없음)")
if (main.projectRef !== EXPECTED_PROJECT_REF) problems.push("DATABASE_URL 의 프로젝트가 기대값과 다름")
if (direct.projectRef !== EXPECTED_PROJECT_REF) problems.push("DIRECT_URL 의 프로젝트가 기대값과 다르거나 없음")
if (supabaseHost !== `${EXPECTED_PROJECT_REF}.supabase.co`) problems.push("NEXT_PUBLIC_SUPABASE_URL 이 기대 프로젝트가 아님")
if (main.database !== EXPECTED_DATABASE) problems.push("DB 이름이 기대값과 다름")
if (process.env.DEFAULT_TENANT_ID !== EXPECTED_TENANT) problems.push("DEFAULT_TENANT_ID 가 기대값과 다름")
if (problems.length > 0) {
  console.error("실행을 거부합니다: " + problems.join("; "))
  process.exit(2)
}

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error("실행할 명령이 없습니다.")
  process.exit(2)
}
const child = spawn(cmd, args, { stdio: "inherit", shell: true, env: process.env })
child.on("exit", (code) => process.exit(code ?? 1))
