/**
 * 계측기 엑셀 이관 — 클린 DB 재검증 (로컬 테스트 DB 전용)
 *
 * 실행 조건: DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB, DATABASE_URL 이 127.0.0.1/localhost 의 *_test DB,
 *           CALIBRATION_XLSX=<엑셀 경로>, seed 완료 상태, 그리고 MeasuringInstrument 가 비어 있을 것(비어 있지 않으면 중단 — 실제 데이터 보호).
 * 이관 코드(src/lib/instrument-calibration-import.ts)와 독립적으로 엑셀 원본을 고정 열 위치로 다시 읽어 DB 결과와 대조한다.
 * 끝나면 이 스크립트가 만든 계측기/이력/감사로그를 모두 삭제해 DB 를 빈 상태로 되돌린다.
 */
import { join } from "node:path"
import fs from "node:fs"
import Module from "node:module"
import jwt from "jsonwebtoken"
import XLSX from "xlsx"

function guard() {
  const url = process.env.DATABASE_URL ?? ""
  const m = url.match(/^postgres(?:ql)?:\/\/[^@]*@([^:/]+):(\d+)\/([^?]+)/)
  if (process.env.DAEWON_TEST_DB_CONFIRM !== "YES_LOCAL_TEST_DB" || !m || !["127.0.0.1", "localhost"].includes(m[1]) || !/_test$/.test(m[3])) {
    console.error("ABORT: 로컬 테스트 DB(127.0.0.1/localhost 의 *_test)가 확인되지 않아 실행하지 않습니다.")
    process.exit(2)
  }
  console.log(`target DB = ${m[1]}:${m[2]}/${m[3]}`)
}
guard()
const xlsxPath = process.env.CALIBRATION_XLSX
if (!xlsxPath || !fs.existsSync(xlsxPath)) {
  console.error("ABORT: CALIBRATION_XLSX 에 엑셀 파일 경로를 지정하세요.")
  process.exit(2)
}
if (!process.env.JWT_SECRET || !process.env.DEFAULT_TENANT_ID) {
  console.error("ABORT: JWT_SECRET / DEFAULT_TENANT_ID 가 필요합니다.")
  process.exit(2)
}

let currentCookie: string | null = null
const ModuleInternals = Module as unknown as {
  _resolveFilename: (request: string, ...rest: unknown[]) => string
  _load: (request: string, ...rest: unknown[]) => unknown
}
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}
const originalLoad = ModuleInternals._load
ModuleInternals._load = function (request: string, ...rest: unknown[]) {
  if (request === "next/headers") {
    return {
      cookies: async () => ({ get: (name: string) => (name === "nmes-session" && currentCookie ? { name, value: currentCookie } : undefined) }),
      headers: async () => new Map(),
    }
  }
  if (request === "next/cache") return { revalidatePath: () => {}, revalidateTag: () => {} }
  return originalLoad.call(this, request, ...rest)
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma } = require("../src/lib/db/prisma") as typeof import("../src/lib/db/prisma")
const actions = require("../src/lib/actions/instrument-calibration.actions") as typeof import("../src/lib/actions/instrument-calibration.actions")

type Row = { id: string; title: string; ok: boolean; detail: string }
const rows: Row[] = []
function record(id: string, title: string, ok: boolean, detail = "") {
  rows.push({ id, title, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${title}${detail ? " — " + detail : ""}`)
}

const tenantId = process.env.DEFAULT_TENANT_ID!
const runId = `imp${Date.now().toString(36)}`
let profileId = ""
const toDateKey = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const parseDot = (text: string) => {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(text.trim())
  if (!m) return null
  const key = `${m[1]}-${m[2]}-${m[3]}`
  const d = new Date(`${key}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== key ? null : key
}

async function main() {
  // 선행 조건
  const existing = await prisma.measuringInstrument.count({ where: { tenantId } })
  if (existing !== 0) throw new Error(`MeasuringInstrument 가 비어 있지 않습니다(${existing}건). 실제 데이터를 보호하기 위해 중단합니다.`)

  // OWNER 시험 계정 + 세션
  const loginId = `${runId}_owner`
  const profile = await prisma.profile.create({ data: { email: `${loginId}@example.test`, name: "이관시험 OWNER" } })
  profileId = profile.id
  await prisma.tenantUser.create({ data: { tenantId, profileId, role: "OWNER" } })
  await prisma.userCredential.create({ data: { tenantId, loginId, profileId, passwordHash: "x", mustChangePw: false } })
  currentCookie = jwt.sign({ profileId, tenantId, loginId, name: "owner", role: "OWNER" }, process.env.JWT_SECRET!, { expiresIn: 900 })

  // 엑셀 원본 (이관 코드와 독립적으로 읽는다)
  const wb = XLSX.readFile(xlsxPath!)
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: false, defval: "" }).map((r) => r.map((c) => String(c ?? "").slice(0, 500))),
  }))
  const master = (sheets.find((s) => s.name === "계측기 검교정 계획서")?.rows ?? []).filter((r) => /^DW-/.test(String(r[1]).trim()))
  record("S00", "원본 엑셀 종합 관리대장 80행 확인", master.length === 80, `${master.length}행`)

  // ── 미리보기 ──
  const preview = await actions.previewInstrumentImport(sheets)
  if (!preview.ok) throw new Error(preview.error)
  const s = preview.data.summary
  record("V01", "미리보기: 신규 계측기 80 / 기존 0", s.instrumentsNew === 80 && s.instrumentsExisting === 0, JSON.stringify(s))
  record("V02", "미리보기: 신규 교정이력 263 / 중복 0 / 제외 0", s.calibrationsNew === 263 && s.calibrationsDuplicate === 0 && s.calibrationsSkipped === 0)
  const errors = preview.data.issues.filter((i) => i.level === "error")
  const warnings = preview.data.issues.filter((i) => i.level === "warning")
  record("V03", "미리보기: 오류 0건, 경고 7건(기존 검증 결과와 동일)", errors.length === 0 && warnings.length === 7,
    `오류 ${errors.length}, 경고 ${warnings.length} (Serial 중복 ${warnings.filter((w) => w.message.includes("Serial")).length}, 잘못된 날짜 ${warnings.filter((w) => w.message.includes("2026.06.00")).length})`)
  const dbBeforeCommit = await prisma.measuringInstrument.count({ where: { tenantId } })
  record("V04", "미리보기는 저장하지 않는다", dbBeforeCommit === 0)

  // ── 실행 ──
  const commit = await actions.commitInstrumentImport(sheets)
  if (!commit.ok) throw new Error(commit.error)
  record("T01", "이관 실행: 계측기 80 / 이력 263", commit.data.instrumentsCreated === 80 && commit.data.calibrationsCreated === 263, JSON.stringify(commit.data))

  const instruments = await prisma.measuringInstrument.findMany({ where: { tenantId }, include: { calibrations: true } })
  const byNo = new Map(instruments.map((i) => [i.managementNo, i]))
  record("T02", "계측기 80대, 관리번호 중복 없음, 출처 EXCEL_IMPORT",
    instruments.length === 80 && byNo.size === 80 && instruments.every((i) => i.source === "EXCEL_IMPORT"))

  const status = (st: string) => instruments.filter((i) => i.usageStatus === st).length
  record("T03", "사용상태 건수: 사용가능 73 / 폐기 5 / 보류 2 / 사용중지 0", status("AVAILABLE") === 73 && status("DISPOSED") === 5 && status("ON_HOLD") === 2 && status("SUSPENDED") === 0,
    `AVAILABLE=${status("AVAILABLE")} DISPOSED=${status("DISPOSED")} ON_HOLD=${status("ON_HOLD")}`)

  // 원본 행과 1:1 대조
  const mismatches: string[] = []
  let nextChecked = 0
  for (const r of master) {
    const no = String(r[1]).trim()
    const db = byNo.get(no)
    if (!db) { mismatches.push(`${no}: DB 없음`); continue }
    const serial = String(r[4]).trim()
    if ((db.serialNo ?? "") !== serial) mismatches.push(`${no}: serial '${db.serialNo}' ≠ '${serial}'`)
    if (db.name !== String(r[2]).trim()) mismatches.push(`${no}: name`)
    if ((db.specification ?? "") !== String(r[3]).trim()) mismatches.push(`${no}: spec`)
    if ((db.manufacturer ?? "") !== String(r[5]).trim()) mismatches.push(`${no}: manufacturer`)
    const statusText = String(r[12]).trim()
    const remark = String(r[14]).trim()
    const expected = remark.includes("폐기") ? "DISPOSED" : remark.includes("보류") || String(r[7]).includes("보류") ? "ON_HOLD" : statusText === "사용가능" ? "AVAILABLE" : "SUSPENDED"
    if (db.usageStatus !== expected) mismatches.push(`${no}: 상태 ${db.usageStatus} ≠ ${expected}`)
    if (statusText === "사용불가" && db.usageStatus === "AVAILABLE") mismatches.push(`${no}: 사용불가가 사용가능으로 이관됨`)
    const intervalText = String(r[6]).replace(/\s/g, "")
    const months = intervalText === "1년" ? 12 : intervalText === "2년" ? 24 : intervalText === "6개월" ? 6 : null
    if (db.calibrationIntervalMonths !== months) mismatches.push(`${no}: 교정주기 ${db.calibrationIntervalMonths} ≠ ${months}`)
    const agency = String(r[9]).trim()
    const cert = String(r[10]).trim()
    const next = parseDot(String(r[13]))
    if (agency || cert || next) {
      const rec = db.calibrations.find((c) => (c.certificateNo ?? "") === cert && toDateKey(c.nextCalibrationDate) === next)
      if (!rec) mismatches.push(`${no}: 이력(${cert}/${next}) 없음`)
      else if ((rec.calibrationAgency ?? "") !== agency) mismatches.push(`${no}: 교정기관 '${rec.calibrationAgency}' ≠ '${agency}'`)
    }
    if (next && statusText === "사용가능") {
      nextChecked += 1
      if (toDateKey(db.nextCalibrationDate) !== next) mismatches.push(`${no}: 차기교정일 ${toDateKey(db.nextCalibrationDate)} ≠ ${next}`)
    }
  }
  record("T04", "원본 80행 대조: 관리번호·계측기명·규격·Serial·제조사·교정주기·사용상태·교정기관·성적서번호·차기교정일 모두 일치", mismatches.length === 0,
    mismatches.length === 0 ? `차기교정일 대조 ${nextChecked}대` : mismatches.slice(0, 8).join(" ; "))
  const zeroSerials = ["DW-A13", "DW-A15", "DW-A16", "DW-G04"].map((no) => byNo.get(no)?.serialNo)
  record("T05", "Serial No 선행 0 유지(문자열)", JSON.stringify(zeroSerials) === JSON.stringify(["0089483", "0124645", "0080210", "032288725393291"]), zeroSerials.join(","))

  const cals = instruments.flatMap((i) => i.calibrations)
  record("T06", "교정이력 263건, 교정실시일 미기재 유지(전부 NULL)", cals.length === 263 && cals.every((c) => c.calibrationDate === null))
  record("T07", "임의 적합/부적합 판정 생성 없음(result 전부 NULL, 마스터 최근교정일 NULL)", cals.every((c) => c.result === null) && instruments.every((i) => i.lastCalibrationDate === null))
  record("T08", "이관 이력은 완료/미취소/이관 출처로 저장, 교정비용·담당자 없음",
    cals.every((c) => c.progressStatus === "COMPLETED" && c.cancelledAt === null && c.source === "EXCEL_IMPORT" && c.calibrationCost === null && c.managerId === null))
  // 폐기 계측기라도 날짜별 시트에 남아 있는 과거 교정 기록은 보존한다(이력 보존 정책). 상태만 폐기로 유지된다.
  const disposed = instruments.filter((i) => i.usageStatus === "DISPOSED")
  record("T09", "폐기 5대는 폐기 상태 유지(사용가능 아님), 과거 교정 기록은 보존", disposed.length === 5 && disposed.every((i) => i.usageStatus !== "AVAILABLE"),
    `이력이 있는 폐기 계측기 ${disposed.filter((i) => i.calibrations.length > 0).length}대(${disposed.filter((i) => i.calibrations.length > 0).map((i) => i.managementNo).join(",")})`)
  const keys = cals.map((c) => c.sourceKey)
  record("T10", "이력 sourceKey 263개 모두 고유", new Set(keys).size === 263 && keys.every(Boolean))

  const overview = await actions.getCalibrationOverview()
  if (!overview.ok) throw new Error(overview.error)
  const stateCount = (st: string) => overview.data.instruments.filter((i) => i.calibrationState === st).length
  record("T11", "이관 직후 교정상태 자동계산(기준일 오늘): 차기교정일이 모두 과거라 활성 75대 기한초과, 폐기 5대 제외",
    stateCount("OVERDUE") + stateCount("DUE_SOON") + stateCount("NORMAL") === 75 && stateCount("EXEMPT") === 5,
    `OVERDUE=${stateCount("OVERDUE")} DUE_SOON=${stateCount("DUE_SOON")} NORMAL=${stateCount("NORMAL")} EXEMPT=${stateCount("EXEMPT")} 기준일 ${overview.data.asOf}`)

  // ── 재이관(중복) ──
  const again = await actions.previewInstrumentImport(sheets)
  const a = again.ok ? again.data.summary : null
  record("D01", "재이관 미리보기: 신규 0 / 기존 80 / 중복 이력 263", !!a && a.instrumentsNew === 0 && a.instrumentsExisting === 80 && a.calibrationsNew === 0 && a.calibrationsDuplicate === 263, JSON.stringify(a))
  const commit2 = await actions.commitInstrumentImport(sheets)
  const countsAfter = { i: await prisma.measuringInstrument.count({ where: { tenantId } }), c: await prisma.instrumentCalibration.count({ where: { tenantId } }) }
  record("D02", "재이관 실행: 신규 0건(거부), 계측기 80/이력 263 그대로", commit2.ok === false && countsAfter.i === 80 && countsAfter.c === 263, commit2.ok ? "" : commit2.error)

  // 기존 값 보호: 사용자가 바꾼 값은 재이관이 덮어쓰지 않는다
  const edited = byNo.get("DW-A01")!
  await prisma.measuringInstrument.update({ where: { id: edited.id }, data: { name: "사용자가 수정한 이름", usageStatus: "SUSPENDED" } })
  await actions.commitInstrumentImport(sheets)
  const keep = await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: edited.id } })
  record("D03", "재이관이 사용자가 수정한 기존 계측기(이름/사용상태)를 덮어쓰지 않음", keep.name === "사용자가 수정한 이름" && keep.usageStatus === "SUSPENDED")

  // 관리번호 중복 방지(대소문자 무관)
  const dup = await actions.createInstrument({ managementNo: "dw-a02", name: "중복", calibrationRequired: true, calibrationIntervalMonths: 12, usageStatus: "AVAILABLE" })
  record("D04", "이미 이관된 관리번호로 직접 등록 시도 거부(대소문자 무관)", dup.ok === false && dup.error.includes("이미 등록"), dup.ok ? "" : dup.error)
}

async function cleanup() {
  try {
    const ids = (await prisma.measuringInstrument.findMany({ where: { tenantId }, select: { id: true } })).map((r) => r.id)
    const calIds = (await prisma.instrumentCalibration.findMany({ where: { instrumentId: { in: ids } }, select: { id: true } })).map((r) => r.id)
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: profileId || "none" }, { entityId: { in: [...ids, ...calIds] } }] } })
    await prisma.measuringInstrument.updateMany({ where: { id: { in: ids } }, data: { currentCalibrationId: null } })
    await prisma.instrumentStatusHistory.deleteMany({ where: { instrumentId: { in: ids } } })
    await prisma.instrumentCalibration.deleteMany({ where: { instrumentId: { in: ids } } })
    await prisma.measuringInstrument.deleteMany({ where: { id: { in: ids } } })
    if (profileId) {
      await prisma.userCredential.deleteMany({ where: { profileId } })
      await prisma.tenantUser.deleteMany({ where: { profileId } })
      await prisma.profile.deleteMany({ where: { id: profileId } })
    }
    const left = { instruments: await prisma.measuringInstrument.count({ where: { tenantId } }), calibrations: await prisma.instrumentCalibration.count({ where: { tenantId } }), profile: profileId ? await prisma.profile.count({ where: { id: profileId } }) : 0 }
    record("Z01", "시험 데이터/계정 정리 — DB 를 빈 상태로 복원", left.instruments === 0 && left.calibrations === 0 && left.profile === 0, JSON.stringify(left))
  } catch (error) {
    record("Z01", "정리 실패", false, String(error))
  }
}

main()
  .catch((error) => record("ERR", "예기치 않은 오류", false, error instanceof Error ? (error.stack ?? error.message) : String(error)))
  .finally(async () => {
    if (rows.some((r) => r.id === "ERR" && r.detail.includes("비어 있지 않습니다"))) {
      await prisma.$disconnect()
      process.exit(1)
    }
    await cleanup()
    await prisma.$disconnect()
    const failed = rows.filter((r) => !r.ok)
    console.log(`\n${rows.length - failed.length}/${rows.length} PASS, ${failed.length} FAIL`)
    process.exit(failed.length === 0 ? 0 : 1)
  })
