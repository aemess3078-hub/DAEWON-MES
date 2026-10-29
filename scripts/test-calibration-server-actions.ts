/**
 * 계측기 검교정관리 — 실제 역할별 서버 액션 권한 검증 (로컬 테스트 DB 전용)
 *
 * 실행 조건 (하나라도 아니면 즉시 중단 — 운영 DB 보호):
 *   - DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB
 *   - DATABASE_URL 이 127.0.0.1/localhost 의 `*_test` 데이터베이스
 *   - 기본 권한이 seed 로 이미 만들어져 있을 것(npm run db:seed 완료 상태) — 사용자관리 화면 진입 없이 권한이 적용되는지도 함께 확인한다.
 *
 * 대체하는 것은 Next 런타임 두 가지뿐이다: next/headers(cookies → 테스트 세션 쿠키), next/cache(revalidatePath).
 * 인증(JWT 검증), 역할/권한 해석(RolePermission), 서버 액션 본문, DB 는 모두 실제 코드/실제 DB 이다.
 * 테스트 계정/데이터는 이 스크립트가 만들고 끝날 때 모두 삭제한다.
 */
import { join } from "node:path"
import Module from "node:module"
import jwt from "jsonwebtoken"

// ── 0. 안전 가드 ──────────────────────────────────────────────────────────────
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
if (!process.env.JWT_SECRET || !process.env.DEFAULT_TENANT_ID) {
  console.error("ABORT: JWT_SECRET / DEFAULT_TENANT_ID 가 필요합니다.")
  process.exit(2)
}

// ── 1. Next 런타임만 대체 ─────────────────────────────────────────────────────
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
      cookies: async () => ({
        get: (name: string) => (name === "nmes-session" && currentCookie ? { name, value: currentCookie } : undefined),
      }),
      headers: async () => new Map(),
    }
  }
  if (request === "next/cache") return { revalidatePath: () => {}, revalidateTag: () => {} }
  return originalLoad.call(this, request, ...rest)
}

/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma } = require("../src/lib/db/prisma") as typeof import("../src/lib/db/prisma")
const actions = require("../src/lib/actions/instrument-calibration.actions") as typeof import("../src/lib/actions/instrument-calibration.actions")
const features = require("../src/lib/services/feature.service") as typeof import("../src/lib/services/feature.service")

// ── 2. 결과 기록 ──────────────────────────────────────────────────────────────
type Row = { id: string; title: string; ok: boolean; detail: string }
const rows: Row[] = []
function record(id: string, title: string, ok: boolean, detail = "") {
  rows.push({ id, title, ok, detail })
  console.log(`${ok ? "PASS" : "FAIL"} [${id}] ${title}${detail ? " — " + detail : ""}`)
}

const DENIED = "이 기능을 사용할 권한이 없습니다."
const UNAUTH = "로그인이 필요합니다"
const NOT_FOUND = "찾을 수 없습니다"
type Result = { ok: true; data?: unknown } | { ok: false; error: string }
const allowed = (r: Result) => r.ok === true
const deniedWith = (r: Result, text: string) => r.ok === false && r.error.includes(text)

const ROLES = ["OWNER", "ADMIN", "MANAGER", "OPERATOR", "VIEWER"] as const
type Role = (typeof ROLES)[number]
// 요구 정책표
const CAN: Record<string, Role[]> = {
  read: ["OWNER", "ADMIN", "MANAGER", "OPERATOR", "VIEWER"],
  create: ["OWNER", "ADMIN", "MANAGER"],
  update: ["OWNER", "ADMIN", "MANAGER"],
  dispose: ["OWNER", "ADMIN"],
  export: ["OWNER", "ADMIN", "MANAGER"],
}

const runId = `ct${Date.now().toString(36)}`
const tenantId = process.env.DEFAULT_TENANT_ID!
const created = { profiles: [] as string[], tenants: [] as string[], instruments: [] as string[] }
const tokens: Record<string, string> = {}
const userIds: Record<string, string> = {}

function sign(payload: { profileId: string; tenantId: string; loginId: string; name: string; role: string }, secret = process.env.JWT_SECRET!) {
  return jwt.sign(payload, secret, { expiresIn: 600 })
}
async function as<T>(token: string | null, fn: () => Promise<T>): Promise<T> {
  currentCookie = token
  try {
    return await fn()
  } finally {
    currentCookie = null
  }
}

async function makeUser(tid: string, label: string, role: Role) {
  const loginId = `${runId}_${label}`.toLowerCase()
  const profile = await prisma.profile.create({ data: { email: `${loginId}@example.test`, name: `${label} 시험` } })
  created.profiles.push(profile.id)
  await prisma.tenantUser.create({ data: { tenantId: tid, profileId: profile.id, role } })
  await prisma.userCredential.create({ data: { tenantId: tid, loginId, profileId: profile.id, passwordHash: "x", mustChangePw: false } })
  return { profileId: profile.id, loginId, token: sign({ profileId: profile.id, tenantId: tid, loginId, name: label, role }) }
}

const instrumentInput = (no: string, extra: Record<string, unknown> = {}) => ({
  managementNo: no,
  name: `시험계측기 ${no}`,
  calibrationRequired: true,
  calibrationIntervalMonths: 12,
  usageStatus: "AVAILABLE" as const,
  ...extra,
})
const updateInput = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  calibrationRequired: true,
  calibrationIntervalMonths: 12,
  usageStatus: "AVAILABLE" as const,
  ...extra,
})
let n = 0
const uniq = (p: string) => `${runId}-${p}-${++n}`.toUpperCase()

async function ownerCreateInstrument(no: string) {
  const r = await as(tokens.OWNER, () => actions.createInstrument(instrumentInput(no)))
  if (!r.ok) throw new Error(`fixture createInstrument failed: ${r.error}`)
  created.instruments.push(r.data.id)
  return r.data.id
}
async function ownerRegister(instrumentId: string, date: string, cert: string) {
  const r = await as(tokens.OWNER, () =>
    actions.registerCalibration({ instrumentId, calibrationDate: date, result: "PASS", certificateNo: cert, calibrationAgency: "시험기관" }),
  )
  if (!r.ok) throw new Error(`fixture registerCalibration failed: ${r.error}`)
  return r.data.id
}

async function main() {
  // 선행 조건: seed 만으로 기본 권한이 있어야 한다(사용자관리 화면 진입 없이)
  const seeded = await prisma.rolePermission.findMany({ where: { tenantId, resource: "INSTRUMENT_CALIBRATION", isAllowed: true }, select: { role: true, action: true } })
  const bySeed = (role: string) => seeded.filter((s) => s.role === role).map((s) => s.action).sort().join(",")
  record("P01", "seed 만으로 INSTRUMENT_CALIBRATION 기본 권한 행이 존재(사용자관리 화면 미접근)", seeded.length === 18,
    `OWNER=${bySeed("OWNER")} | MANAGER=${bySeed("MANAGER")} | OPERATOR=${bySeed("OPERATOR")} | VIEWER=${bySeed("VIEWER")}`)
  if (seeded.length === 0) throw new Error("seed 가 선행되어야 합니다(npm run db:seed).")

  // 역할별 시험 계정 + 다른 테넌트
  for (const role of ROLES) {
    const u = await makeUser(tenantId, role, role)
    tokens[role] = u.token
    userIds[role] = u.profileId
  }
  const otherTenant = await prisma.tenant.create({ data: { code: `${runId}-other`, name: `${runId} other` } })
  created.tenants.push(otherTenant.id)
  const otherOwner = await makeUser(otherTenant.id, "OTHER_OWNER", "OWNER")

  // 고정 데이터: 이력이 있는 계측기 / 일반 계측기
  const withHistory = await ownerCreateInstrument(uniq("HIST"))
  const recordForHistory = await ownerRegister(withHistory, "2026-01-10", uniq("C"))
  const plain = await ownerCreateInstrument(uniq("PLAIN"))

  const countInstruments = (where: object = {}) => prisma.measuringInstrument.count({ where: { tenantId, ...where } })
  const countCal = (where: object = {}) => prisma.instrumentCalibration.count({ where: { tenantId, ...where } })

  // ── 조회 ────────────────────────────────────────────────────────────────────
  for (const role of ROLES) {
    const overview = await as(tokens[role], () => actions.getCalibrationOverview())
    const detail = await as(tokens[role], () => actions.getInstrumentDetailExtras(withHistory))
    const okRead = overview.ok && detail.ok
    const flags = overview.ok ? overview.data.permissions : null
    const flagsOk =
      !!flags &&
      flags.canCreate === CAN.create.includes(role) &&
      flags.canUpdate === CAN.update.includes(role) &&
      flags.canDelete === CAN.dispose.includes(role) &&
      flags.canExport === CAN.export.includes(role)
    const sees = overview.ok && overview.data.instruments.some((i) => i.id === withHistory) && overview.data.calibrations.some((c) => c.instrumentId === withHistory)
    record(`R-${role}`, `${role}: 목록/상세/일정/이력 조회`, okRead && sees, `화면 권한 플래그 ${flagsOk ? "일치" : "불일치"}`)
    record(`RF-${role}`, `${role}: 화면에 내려주는 권한 플래그가 정책표와 일치`, flagsOk)
  }

  // ── 등록(계측기/교정 실적/이관) ───────────────────────────────────────────────
  for (const role of ROLES) {
    const expectOk = CAN.create.includes(role)
    const no = uniq(`NEW-${role}`)
    const before = await countInstruments()
    const r = await as(tokens[role], () => actions.createInstrument(instrumentInput(no)))
    if (r.ok) created.instruments.push(r.data.id)
    const after = await countInstruments()
    record(`C-${role}`, `${role}: 계측기 등록 ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(r) && after === before + 1 : deniedWith(r, DENIED) && after === before, r.ok ? "" : r.error)

    const calBefore = await countCal()
    const rc = await as(tokens[role], () =>
      actions.registerCalibration({ instrumentId: plain, calibrationDate: "2026-02-01", result: "PASS", certificateNo: uniq(`RC-${role}`) }),
    )
    const calAfter = await countCal()
    record(`CR-${role}`, `${role}: 교정 실적 등록 ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(rc) && calAfter === calBefore + 1 : deniedWith(rc, DENIED) && calAfter === calBefore, rc.ok ? "" : rc.error)
  }
  {
    const r = await as(tokens.MANAGER, () => actions.createInstrument(instrumentInput(uniq("DISP-NEW"), { usageStatus: "DISPOSED" })))
    record("C-MANAGER-DISPOSED", "MANAGER: 폐기 상태로 등록 거부(폐기는 DELETE 권한)", deniedWith(r, DENIED))
  }

  // ── 수정(계측기/교정 이력/취소/일정) ──────────────────────────────────────────
  for (const role of ROLES) {
    const expectOk = CAN.update.includes(role)
    const target = await ownerCreateInstrument(uniq(`UPD-${role}`))
    const originalName = (await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: target } })).name
    const newName = `수정됨 ${role}`
    const r = await as(tokens[role], () => actions.updateInstrument(target, updateInput(newName)))
    const nameNow = (await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: target } })).name
    record(`U-${role}`, `${role}: 계측기 수정 ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(r) && nameNow === newName : deniedWith(r, DENIED) && nameNow === originalName, r.ok ? "" : r.error)

    const rec = await ownerRegister(target, "2026-03-01", uniq(`UC-${role}`))
    const ru = await as(tokens[role], () =>
      actions.updateCalibration(rec, { calibrationDate: "2026-03-02", result: "PASS", certificateNo: uniq(`UC2-${role}`) }),
    )
    const dateNow = (await prisma.instrumentCalibration.findUniqueOrThrow({ where: { id: rec } })).calibrationDate?.toISOString().slice(0, 10)
    record(`UC-${role}`, `${role}: 교정 이력 수정 ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(ru) && dateNow === "2026-03-02" : deniedWith(ru, DENIED) && dateNow === "2026-03-01", ru.ok ? "" : ru.error)

    const rec2 = await ownerRegister(target, "2026-04-01", uniq(`CC-${role}`))
    const rx = await as(tokens[role], () => actions.cancelCalibration(rec2, "시험 취소"))
    const cancelled = (await prisma.instrumentCalibration.findUniqueOrThrow({ where: { id: rec2 } })).cancelledAt !== null
    record(`CC-${role}`, `${role}: 교정 이력 취소 ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(rx) && cancelled : deniedWith(rx, DENIED) && !cancelled, rx.ok ? "" : rx.error)

    const openBefore = await countCal({ instrumentId: target, progressStatus: { not: "COMPLETED" } })
    const rs = await as(tokens[role], () => actions.saveCalibrationSchedule({ instrumentId: target, status: "SCHEDULED", plannedDate: "2026-12-01" }))
    const openAfter = await countCal({ instrumentId: target, progressStatus: { not: "COMPLETED" } })
    record(`US-${role}`, `${role}: 교정 일정 지정 ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(rs) && openAfter === openBefore + 1 : deniedWith(rs, DENIED) && openAfter === openBefore, rs.ok ? "" : rs.error)
  }

  // ── 삭제/폐기 ───────────────────────────────────────────────────────────────
  for (const role of ROLES) {
    const expectOk = CAN.dispose.includes(role)
    const del = await ownerCreateInstrument(uniq(`DEL-${role}`))
    const r = await as(tokens[role], () => actions.deleteInstrument(del, "시험 삭제"))
    const deletedAt = (await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: del } })).deletedAt
    record(`D-${role}`, `${role}: 계측기 삭제(소프트) ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(r) && deletedAt !== null : deniedWith(r, DENIED) && deletedAt === null, r.ok ? "" : r.error)

    const disp = await ownerCreateInstrument(uniq(`DSP-${role}`))
    const rd = await as(tokens[role], () => actions.updateInstrument(disp, updateInput("폐기 시험", { usageStatus: "DISPOSED", statusReason: "시험 폐기" })))
    const statusNow = (await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: disp } })).usageStatus
    record(`DP-${role}`, `${role}: 폐기 처리 ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(rd) && statusNow === "DISPOSED" : deniedWith(rd, DENIED) && statusNow === "AVAILABLE", rd.ok ? "" : rd.error)
  }
  {
    const r = await as(tokens.OWNER, () => actions.deleteInstrument(withHistory, "이력 있는 계측기 삭제 시도"))
    const row = await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: withHistory } })
    record("D-HISTORY", "OWNER 라도 교정이력이 있는 계측기는 삭제 불가(폐기만 가능), 이력 보존", r.ok === false && row.deletedAt === null && (await countCal({ instrumentId: withHistory })) >= 1, r.ok ? "" : r.error)
    const disp = await as(tokens.OWNER, () => actions.updateInstrument(withHistory, updateInput("이력 있는 계측기", { usageStatus: "DISPOSED", statusReason: "폐기" })))
    const still = await countCal({ instrumentId: withHistory })
    record("DP-HISTORY", "폐기 후에도 과거 교정이력이 그대로 보존", allowed(disp) && still >= 1, `이력 ${still}건`)
  }

  // ── 엑셀 다운로드 ───────────────────────────────────────────────────────────
  for (const role of ROLES) {
    const expectOk = CAN.export.includes(role)
    const a = await as(tokens[role], () => actions.exportInstrumentRows({}))
    const b = await as(tokens[role], () => actions.exportCalibrationRows({}))
    record(`E-${role}`, `${role}: 엑셀 다운로드(관리대장/이력) ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(a) && allowed(b) && (a.ok && a.data.count > 0) : deniedWith(a, DENIED) && deniedWith(b, DENIED))
  }

  // ── 엑셀 이관 ───────────────────────────────────────────────────────────────
  const sheetsFor = (no: string) => [
    {
      name: "계측기 검교정 계획서",
      rows: [
        ["No", "관리번호", "계측기명", "규격", "Serial No", "제조사", "교정주기", "검교정 계획 대비 실적", "", "", "", "", "", "차기교정일", "비 고"],
        ["", "", "", "", "", "", "", "계획", "실적", "교정기관", "교정번호", "사용부서(장소)", "제품상태"],
        ["1", no, "이관시험", "", "007", "", "1년", "", "", "에어텍", `CERT-${no}`, "생산부", "사용가능", "2027.01.01"],
      ],
    },
  ]
  for (const role of ROLES) {
    const expectOk = CAN.create.includes(role)
    const no = uniq(`IMP-${role}`)
    const pv = await as(tokens[role], () => actions.previewInstrumentImport(sheetsFor(no)))
    const before = await countInstruments({ managementNo: no })
    const cm = await as(tokens[role], () => actions.commitInstrumentImport(sheetsFor(no)))
    const row = await prisma.measuringInstrument.findFirst({ where: { tenantId, managementNo: no } })
    if (row) created.instruments.push(row.id)
    record(`I-${role}`, `${role}: 엑셀 이관(미리보기/실행) ${expectOk ? "허용" : "거부"}`,
      expectOk ? allowed(pv) && allowed(cm) && !!row && before === 0 && row.serialNo === "007" : deniedWith(pv, DENIED) && deniedWith(cm, DENIED) && !row)
  }

  // ── 권한 우회 시도 ──────────────────────────────────────────────────────────
  {
    // (1) UI 버튼과 무관한 직접 호출 = 위 모든 검사. (3) 로그인하지 않은 요청
    const noName = uniq("NOSESSION")
    const before = await countInstruments()
    const results: Result[] = [
      await as(null, () => actions.getCalibrationOverview()),
      await as(null, () => actions.createInstrument(instrumentInput(noName))),
      await as(null, () => actions.updateInstrument(plain, updateInput("무세션 수정"))),
      await as(null, () => actions.deleteInstrument(plain, "무세션")),
      await as(null, () => actions.registerCalibration({ instrumentId: plain, calibrationDate: "2026-05-01", result: "PASS" })),
      await as(null, () => actions.cancelCalibration(recordForHistory, "무세션")),
      await as(null, () => actions.saveCalibrationSchedule({ instrumentId: plain, status: "SCHEDULED" })),
      await as(null, () => actions.exportInstrumentRows({})),
      await as(null, () => actions.exportCalibrationRows({})),
      await as(null, () => actions.previewInstrumentImport(sheetsFor(noName))),
      await as(null, () => actions.commitInstrumentImport(sheetsFor(noName))),
      await as(null, () => actions.getInstrumentDetailExtras(plain)),
    ]
    const plainNow = await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: plain } })
    record("B-UNAUTH", "로그인하지 않은 요청 12종 모두 거부, 데이터 변경 없음",
      results.every((r) => deniedWith(r, UNAUTH)) && (await countInstruments()) === before && plainNow.name !== "무세션 수정" && plainNow.deletedAt === null,
      results.map((r) => (r.ok ? "허용!" : "거부")).join(","))

    // 위조/타 테넌트/무효 세션
    const forged = sign({ profileId: userIds.OWNER, tenantId, loginId: "x", name: "x", role: "OWNER" }, "wrong-secret-for-test")
    const rForged = await as(forged, () => actions.createInstrument(instrumentInput(uniq("FORGED"))))
    record("B-FORGED", "다른 비밀키로 서명한 위조 세션 거부", deniedWith(rForged, UNAUTH))

    const crossToken = sign({ profileId: userIds.VIEWER, tenantId: otherTenant.id, loginId: "x", name: "x", role: "OWNER" })
    const rCross = await as(crossToken, () => actions.createInstrument(instrumentInput(uniq("CROSS"))))
    record("B-ROLE-CLAIM", "세션 페이로드의 role/tenant 주장을 믿지 않는다(조회자 프로필 + 타 테넌트 주장 거부)", deniedWith(rCross, UNAUTH))

    // 다른 사용자의 세션으로 권한을 빌릴 수 없다: VIEWER 토큰으로 OWNER 가 하는 동작 시도
    const rBorrow = await as(tokens.VIEWER, () => actions.updateInstrument(plain, updateInput("VIEWER 가 OWNER 인 척")))
    const nameNow = (await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: plain } })).name
    record("B-SESSION-ROLE", "세션별 실제 역할이 적용된다(VIEWER 세션의 수정 시도는 OWNER 작업과 무관하게 거부)", deniedWith(rBorrow, DENIED) && nameNow !== "VIEWER 가 OWNER 인 척")

    // 역할 강등 즉시 반영 / 비활성 / 잠금
    const m2 = await makeUser(tenantId, "M2", "MANAGER")
    const okBefore = await as(m2.token, () => actions.createInstrument(instrumentInput(uniq("M2-OK"))))
    if (okBefore.ok) created.instruments.push(okBefore.data.id)
    await prisma.tenantUser.updateMany({ where: { tenantId, profileId: m2.profileId }, data: { role: "VIEWER" } })
    const afterDowngrade = await as(m2.token, () => actions.createInstrument(instrumentInput(uniq("M2-DENY"))))
    record("B-DOWNGRADE", "같은 토큰이라도 DB 에서 역할이 강등되면 즉시 거부(역할을 토큰에 캐시하지 않음)", allowed(okBefore) && deniedWith(afterDowngrade, DENIED))
    await prisma.tenantUser.updateMany({ where: { tenantId, profileId: m2.profileId }, data: { role: "MANAGER", isActive: false } })
    const rInactive = await as(m2.token, () => actions.getCalibrationOverview())
    record("B-INACTIVE", "비활성화된 사용자 세션 거부", rInactive.ok === false)
    await prisma.tenantUser.updateMany({ where: { tenantId, profileId: m2.profileId }, data: { isActive: true } })
    await prisma.userCredential.updateMany({ where: { profileId: m2.profileId }, data: { isLocked: true } })
    const rLocked = await as(m2.token, () => actions.getCalibrationOverview())
    record("B-LOCKED", "잠긴 계정 세션 거부", rLocked.ok === false)
  }

  // ── 존재하지 않는 ID / 임의 ID / 타 테넌트 ID ─────────────────────────────────
  {
    const ghost = "does-not-exist-id"
    const ownerCalls: Result[] = [
      await as(tokens.OWNER, () => actions.updateInstrument(ghost, updateInput("x"))),
      await as(tokens.OWNER, () => actions.deleteInstrument(ghost, "x")),
      await as(tokens.OWNER, () => actions.registerCalibration({ instrumentId: ghost, calibrationDate: "2026-05-01", result: "PASS" })),
      await as(tokens.OWNER, () => actions.updateCalibration(ghost, { calibrationDate: "2026-05-01", result: "PASS" })),
      await as(tokens.OWNER, () => actions.cancelCalibration(ghost, "x")),
      await as(tokens.OWNER, () => actions.saveCalibrationSchedule({ instrumentId: ghost, status: "SCHEDULED" })),
      await as(tokens.OWNER, () => actions.getInstrumentDetailExtras(ghost)),
    ]
    record("X-GHOST-OWNER", "권한이 있어도 존재하지 않는 ID 는 '찾을 수 없음'으로 처리, 데이터 생성/변경 없음",
      ownerCalls.every((r) => deniedWith(r, NOT_FOUND)) && (await prisma.instrumentCalibration.count({ where: { instrumentId: ghost } })) === 0,
      ownerCalls.map((r) => (r.ok ? "허용!" : r.error)).join(" | "))

    const before = await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: plain } })
    const lowCalls: Result[] = [
      await as(tokens.VIEWER, () => actions.updateInstrument(plain, updateInput("임의 ID 수정"))),
      await as(tokens.VIEWER, () => actions.deleteInstrument(plain, "임의 ID 삭제")),
      await as(tokens.OPERATOR, () => actions.cancelCalibration(recordForHistory, "임의 ID 취소")),
      await as(tokens.OPERATOR, () => actions.updateCalibration(recordForHistory, { calibrationDate: "2026-06-01", result: "FAIL" })),
      await as(tokens.VIEWER, () => actions.updateInstrument(ghost, updateInput("x"))),
    ]
    const after = await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: plain } })
    const rec = await prisma.instrumentCalibration.findUniqueOrThrow({ where: { id: recordForHistory } })
    record("X-ARBITRARY-ID", "수정/삭제 권한 없는 계정이 임의 ID 를 넘겨도 권한 오류(존재 여부를 알려주지 않음), 데이터 불변",
      lowCalls.every((r) => deniedWith(r, DENIED)) && before.name === after.name && after.deletedAt === null && rec.cancelledAt === null && rec.result === "PASS",
      lowCalls.map((r) => (r.ok ? "허용!" : "거부")).join(","))

    const crossCalls: Result[] = [
      await as(otherOwner.token, () => actions.updateInstrument(plain, updateInput("타 테넌트 수정"))),
      await as(otherOwner.token, () => actions.deleteInstrument(plain, "타 테넌트 삭제")),
      await as(otherOwner.token, () => actions.cancelCalibration(recordForHistory, "타 테넌트 취소")),
      await as(otherOwner.token, () => actions.registerCalibration({ instrumentId: plain, calibrationDate: "2026-05-01", result: "PASS" })),
      await as(otherOwner.token, () => actions.getInstrumentDetailExtras(plain)),
    ]
    const after2 = await prisma.measuringInstrument.findUniqueOrThrow({ where: { id: plain } })
    const overviewOther = await as(otherOwner.token, () => actions.getCalibrationOverview())
    record("X-CROSS-TENANT", "다른 테넌트(OWNER)는 이 테넌트의 ID 로 조회/수정/삭제/등록 불가, 목록에도 보이지 않음",
      crossCalls.every((r) => deniedWith(r, NOT_FOUND)) && after2.name === before.name && after2.deletedAt === null && overviewOther.ok && overviewOther.data.instruments.length === 0,
      crossCalls.map((r) => (r.ok ? "허용!" : r.error)).join(" | "))
  }

  // ── 메뉴 / 빈 상태 ───────────────────────────────────────────────────────────
  {
    const menuCodes = await features.getEnabledMenuCodes(tenantId)
    record("M01", "기본 메뉴 코드 'calibration' 이 시드만으로 활성화됨(메뉴 정의 + 기능 카탈로그)", menuCodes.includes("calibration"))
  }
}

async function cleanup() {
  const ids = created.instruments
  try {
    const cals = await prisma.instrumentCalibration.findMany({ where: { instrumentId: { in: ids } }, select: { id: true } })
    const importIds = (await prisma.measuringInstrument.findMany({ where: { tenantId, managementNo: { startsWith: runId.toUpperCase() } }, select: { id: true } })).map((r) => r.id)
    const allIds = Array.from(new Set([...ids, ...importIds]))
    const calIds = cals.map((c) => c.id)
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: [...allIds, ...calIds] } }, { actorId: { in: created.profiles } }, { entityId: "BULK", actorId: { in: created.profiles } }] },
    })
    await prisma.measuringInstrument.updateMany({ where: { id: { in: allIds } }, data: { currentCalibrationId: null } })
    await prisma.instrumentStatusHistory.deleteMany({ where: { instrumentId: { in: allIds } } })
    await prisma.instrumentCalibration.deleteMany({ where: { instrumentId: { in: allIds } } })
    await prisma.measuringInstrument.deleteMany({ where: { id: { in: allIds } } })
    await prisma.userCredential.deleteMany({ where: { profileId: { in: created.profiles } } })
    await prisma.tenantUser.deleteMany({ where: { profileId: { in: created.profiles } } })
    await prisma.profile.deleteMany({ where: { id: { in: created.profiles } } })
    await prisma.rolePermission.deleteMany({ where: { tenantId: { in: created.tenants } } })
    await prisma.tenant.deleteMany({ where: { id: { in: created.tenants } } })
    const left = {
      instruments: await prisma.measuringInstrument.count({ where: { id: { in: allIds } } }),
      profiles: await prisma.profile.count({ where: { id: { in: created.profiles } } }),
      tenants: await prisma.tenant.count({ where: { id: { in: created.tenants } } }),
    }
    record("Z01", "시험 계정/계측기/이력/임시 테넌트 정리 완료(잔여 0)", left.instruments === 0 && left.profiles === 0 && left.tenants === 0, JSON.stringify(left))
  } catch (error) {
    record("Z01", "정리 실패", false, String(error))
  }
}

main()
  .catch((error) => record("ERR", "예기치 않은 오류", false, error instanceof Error ? (error.stack ?? error.message) : String(error)))
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
    const failed = rows.filter((r) => !r.ok)
    console.log(`\n${rows.length - failed.length}/${rows.length} PASS, ${failed.length} FAIL`)
    process.exit(failed.length === 0 ? 0 : 1)
  })
