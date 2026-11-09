/**
 * 자재출고 검색 — 실제 PostgreSQL 검증 (로컬 테스트 DB 전용, 가드 통과 시에만 실행).
 *
 * 모든 데이터는 하나의 트랜잭션 안에서 만들고 마지막에 롤백한다(DB 에 아무것도 남기지 않는다).
 *   1) 근거: Prisma `contains` 가 % _ \ 를 이스케이프하지 않는다는 것을 실제 DB 로 확인(그래서 strpos 방식을 쓴다).
 *   2) 자재출고현황 작업지시 검색: OR/AND, 대소문자, 특수문자, 페이지네이션, 중복 행 없음.
 *   3) 자재출고이력: 6개 항목 검색, 기간(KST 포함 규칙)·창고 필터, 완료 작업지시 포함, 반납 구분, 최신순, 페이지네이션.
 *
 * 실행(로컬 테스트 DB 의 접속 주소를 환경변수로 직접 지정):
 *   DATABASE_URL=postgresql://…@127.0.0.1:54329/daewon_mes_test DAEWON_TEST_DB_CONFIRM=YES_LOCAL_TEST_DB npm run test:material-issue-search-db
 */
import assert from "node:assert/strict"
import { checkLocalTestDbEnv } from "./helpers/local-test-db-guard"

const guard = checkLocalTestDbEnv(process.env)
if (!guard.ok) {
  console.error("로컬 테스트 DB 가 아니라서 실행하지 않습니다:\n - " + guard.reasons.join("\n - "))
  process.exit(2)
}

import Module from "node:module"
import { join } from "node:path"
const ModuleInternals = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string }
const originalResolve = ModuleInternals._resolveFilename
ModuleInternals._resolveFilename = function (request: string, ...rest: unknown[]) {
  return originalResolve.call(this, request.startsWith("@/") ? join(process.cwd(), "src", request.slice(2)) : request, ...rest)
}

let pass = 0
const ok = (cond: unknown, name: string) => {
  assert.ok(cond, name)
  pass += 1
  console.log(`PASS ${name}`)
}
const ROLLBACK = new Error("rollback-sentinel")

async function main() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require("@prisma/client") as typeof import("@prisma/client")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const S = require("../src/lib/material-issue/issue-search") as typeof import("../src/lib/material-issue/issue-search")
  const prisma = new PrismaClient()
  try {
    await prisma.$transaction(
      async (tx) => {
        const t = await tx.tenant.create({ data: { code: `MIS-${Date.now()}`, name: "search-test" } })
        const site = await tx.site.create({ data: { tenantId: t.id, code: "S1", name: "S1" } })
        const wh1 = await tx.warehouse.create({ data: { tenantId: t.id, siteId: site.id, code: "WH1", name: "원자재창고" } })
        const wh2 = await tx.warehouse.create({ data: { tenantId: t.id, siteId: site.id, code: "WH2", name: "보조창고" } })
        const item = (code: string, name: string, itemType: "RAW_MATERIAL" | "FINISHED") => tx.item.create({ data: { tenantId: t.id, code, name, itemType } })
        const fg1 = await item("FG-BRK", "브라켓", "FINISHED")
        const fg2 = await item("FG-100%_X", "퍼센트_품목", "FINISHED")
        const rm1 = await item("RM-SUS", "스테인리스 봉재", "RAW_MATERIAL")
        const rm2 = await item("RM-A\\B", "백슬래시 자재", "RAW_MATERIAL")
        const bom = async (fgId: string, comps: { id: string }[]) =>
          tx.bOM.create({ data: { tenantId: t.id, itemId: fgId, version: "1", bomItems: { create: comps.map((c, i) => ({ componentItemId: c.id, seq: i + 1, qtyPer: 1 })) } } })
        const bom1 = await bom(fg1.id, [rm1])
        const bom2 = await bom(fg2.id, [rm2])
        const routing = await tx.routing.create({ data: { tenantId: t.id, code: "RT", name: "RT", version: "1" } })
        const wo = (orderNo: string, mfg: string | null, itemId: string, bomId: string, status: "RELEASED" | "IN_PROGRESS" | "COMPLETED", due: string | null) =>
          tx.workOrder.create({ data: { tenantId: t.id, siteId: site.id, itemId, bomId, routingId: routing.id, orderNo, manufacturingNo: mfg, plannedQty: 10, status, dueDate: due ? new Date(due) : null } })
        const wo1 = await wo("WO-2026-001", "A1229-26", fg1.id, bom1.id, "RELEASED", "2026-12-01T00:00:00Z")
        const wo2 = await wo("WO-2026-002", "261109-01", fg1.id, bom1.id, "IN_PROGRESS", "2026-12-02T00:00:00Z")
        const wo3 = await wo("WO-2026-003", null, fg2.id, bom2.id, "RELEASED", null)
        const wo4 = await wo("WO-2026-004", "A1229-27", fg1.id, bom1.id, "COMPLETED", "2026-11-01T00:00:00Z")
        const lot = (itemId: string, lotNo: string) => tx.lot.create({ data: { tenantId: t.id, itemId, lotNo } })
        const l1 = await lot(rm1.id, "LOT-001")
        const l2 = await lot(rm1.id, "LOT-002")
        const l3 = await lot(rm2.id, "LOT-50%_A")
        let seq = 0
        const txn = (woId: string, itemId: string, lotId: string | null, txNo: string, type: "ISSUE" | "RETURN", qty: number, at: string, whId: string) =>
          tx.inventoryTransaction.create({
            data: {
              tenantId: t.id, itemId, lotId, txNo, txType: type, qty, refType: "WORK_ORDER", refId: woId, txAt: new Date(at),
              ...(type === "ISSUE" ? { fromLocationId: whId } : { toLocationId: whId }), note: `n${++seq}`,
            },
          })
        // 한국 시간 경계: 2026-11-09 23:30 KST = 14:30Z(9일), 2026-11-10 00:10 KST = 15:10Z(9일)
        await txn(wo1.id, rm1.id, l1.id, "ISS-0001", "ISSUE", 5, "2026-11-09T14:30:00Z", wh1.id)
        await txn(wo1.id, rm1.id, l2.id, "ISS-0002", "ISSUE", 3, "2026-11-09T15:10:00Z", wh2.id)
        await txn(wo2.id, rm1.id, l1.id, "ISS-0003", "ISSUE", 2, "2026-11-05T01:00:00Z", wh1.id)
        await txn(wo3.id, rm2.id, l3.id, "ISS-%_9", "ISSUE", 7, "2026-11-08T01:00:00Z", wh1.id)
        await txn(wo4.id, rm1.id, l1.id, "ISS-0005", "ISSUE", 4, "2026-10-01T01:00:00Z", wh1.id) // 완료된 작업지시
        await txn(wo1.id, rm1.id, l1.id, "RET-0001", "RETURN", 2, "2026-11-10T01:00:00Z", wh1.id) // 반납
        // 출고·반납이 아닌 수불은 이력에서 제외되어야 한다
        await tx.inventoryTransaction.create({ data: { tenantId: t.id, itemId: rm1.id, lotId: l1.id, txNo: "RCV-0001", txType: "RECEIPT", qty: 100, refType: "WORK_ORDER", refId: wo1.id, toLocationId: wh1.id } })
        // 다른 tenant 의 같은 번호 — 섞이면 안 된다
        const t2 = await tx.tenant.create({ data: { code: `MIS2-${Date.now()}`, name: "other" } })

        // ─── 1) Prisma contains 가 와일드카드를 이스케이프하지 않음(근거) ───
        const cg = (code: string) => tx.codeGroup.create({ data: { tenantId: t.id, groupCode: code, groupName: code } })
        for (const c of ["P%Q", "PxQ", "P_Q", "PxxQ"]) await cg(c)
        const prismaContains = async (term: string) =>
          (await tx.codeGroup.findMany({ where: { tenantId: t.id, groupCode: { contains: term, mode: "insensitive" } }, select: { groupCode: true } })).map((r) => r.groupCode).sort()
        ok((await prismaContains("%")).length === 4, "R1 [근거] Prisma contains '%' 는 모든 행에 일치 — 이스케이프되지 않는다")
        ok((await prismaContains("P_Q")).join() === ["P%Q", "P_Q", "PxQ"].join(), "R2 [근거] Prisma contains '_' 는 한 글자 와일드카드로 동작")

        const WO_STATUS = ["RELEASED", "IN_PROGRESS"]
        const woSearch = async (q: string, page = 1, pageSize = 20) => {
          const r = await S.findIssueWorkOrderPage(tx, { tenantId: t.id, statuses: WO_STATUS, terms: S.parseIssueSearchTerms(q), page, pageSize })
          const rows = await tx.workOrder.findMany({ where: { id: { in: r.ids } }, select: { id: true, orderNo: true } })
          const order = new Map(rows.map((x) => [x.id, x.orderNo]))
          return { orderNos: r.ids.map((id) => order.get(id)), total: r.total, totalPages: r.totalPages, page: r.page }
        }

        // ─── 2) 자재출고현황: 작업지시 검색 ───
        ok((await woSearch("")).orderNos.join() === "WO-2026-001,WO-2026-002,WO-2026-003", "W1 빈 검색어 = 기존 범위(릴리즈·진행중) 전체, 완료 작업지시 제외, 기존 정렬(납기 → 번호, 납기 없음 마지막)")
        ok((await woSearch("wo-2026-001")).orderNos.join() === "WO-2026-001", "W2 작업지시번호(대소문자 무시)")
        ok((await woSearch("A1229")).orderNos.join() === "WO-2026-001", "W3 제조번호 — 범위 밖(완료) 작업지시 A1229-27 은 제외")
        ok((await woSearch("fg-brk")).total === 2, "W4 품목코드")
        ok((await woSearch("브라켓")).total === 2, "W5 품목명")
        ok((await woSearch("봉재")).total === 2, "W6 BOM 원자재 품목명")
        ok((await woSearch("ISS-0002")).orderNos.join() === "WO-2026-001", "W7 출고번호")
        ok((await woSearch("lot-001")).orderNos.join() === "WO-2026-001,WO-2026-002", "W8 LOT 번호")
        ok((await woSearch("A1229 261109")).total === 0, "W9 다중 검색어 AND — 서로 다른 작업지시의 값이면 없음")
        ok((await woSearch("A1229 LOT-001")).orderNos.join() === "WO-2026-001", "W10 제조번호 + LOT AND")
        ok((await woSearch("261109 ISS-0003")).orderNos.join() === "WO-2026-002", "W11 제조번호 + 출고번호 AND")
        ok((await woSearch("LOT-001 LOT-002")).orderNos.join() === "WO-2026-001", "W12 같은 항목(LOT)에서 두 검색어 모두 만족해야 함 — 둘 다 가진 작업지시만")
        ok((await woSearch("%")).orderNos.join() === "WO-2026-003", "W13 '%' 는 문자 그대로(품목코드 FG-100%_X·LOT-50%_A·출고번호 ISS-%_9 가 든 작업지시만)")
        ok((await woSearch("_")).orderNos.join() === "WO-2026-003", "W14 '_' 는 문자 그대로")
        ok((await woSearch("ISS-%_9")).orderNos.join() === "WO-2026-003", "W15 '%_' 조합도 문자 그대로(출고번호)")
        ok((await woSearch("FG-1_0")).total === 0 && (await woSearch("FG-%X")).total === 0, "W16 와일드카드로 해석되면 일치했을 패턴이 일치하지 않음")
        ok((await woSearch("\\")).orderNos.join() === "WO-2026-003", "W17 '\\' 는 문자 그대로(RM-A\\B 자재)")
        ok((await woSearch("A\\B")).orderNos.join() === "WO-2026-003", "W18 'A\\B' 부분 일치")
        ok((await woSearch("'; DROP TABLE \"WorkOrder\"; --")).total === 0 && (await tx.workOrder.count({ where: { tenantId: t.id } })) === 4, "W19 SQL 인젝션 문자열은 일반 문자열이며 데이터에 영향 없음")
        ok((await woSearch("zzzz")).total === 0, "W20 일치 없음")
        const dup = await woSearch("봉재 lot-001 brk")
        ok(new Set(dup.orderNos).size === dup.orderNos.length, "W21 BOM·출고 수불에 여러 번 일치해도 작업지시 행은 한 번만")
        const p1 = await woSearch("", 1, 2)
        const p2 = await woSearch("", 2, 2)
        ok(p1.total === 3 && p1.totalPages === 2 && p1.orderNos.join() === "WO-2026-001,WO-2026-002" && p2.orderNos.join() === "WO-2026-003", "W22 페이지네이션(건수는 전체 기준, 페이지 이어짐)")
        ok((await woSearch("", 9, 2)).page === 2, "W23 범위를 넘은 페이지는 마지막 페이지로")
        const other = await S.findIssueWorkOrderPage(tx, { tenantId: t2.id, statuses: WO_STATUS, terms: ["WO"], page: 1, pageSize: 20 })
        ok(other.total === 0, "W24 다른 tenant 로는 이 tenant 데이터가 조회되지 않음")

        // ─── 3) 자재출고이력 ───
        const hist = async (q: string, opts: { from?: string; to?: string; wh?: string; page?: number } = {}) => {
          const { fromUtc, toUtcExclusive } = S.kstDayRangeUtc(S.normalizeIssueDate(opts.from), S.normalizeIssueDate(opts.to))
          const r = await S.findIssueHistoryPage(tx, { tenantId: t.id, terms: S.parseIssueSearchTerms(q), fromUtc, toUtcExclusive, warehouseId: opts.wh ?? null, page: opts.page ?? 1, pageSize: 20 })
          const rows = await tx.inventoryTransaction.findMany({ where: { id: { in: r.ids } }, select: { id: true, txNo: true } })
          const no = new Map(rows.map((x) => [x.id, x.txNo]))
          return { txNos: r.ids.map((id) => no.get(id)), total: r.total, totalPages: r.totalPages, page: r.page }
        }
        ok((await hist("")).txNos.join() === "RET-0001,ISS-0002,ISS-0001,ISS-%_9,ISS-0003,ISS-0005", "H1 출고·반납만, 완료 작업지시(ISS-0005) 포함, 입고(RCV) 제외, 최신순")
        ok((await hist("ISS-0001")).txNos.join() === "ISS-0001", "H2 출고번호")
        ok((await hist("wo-2026-002")).txNos.join() === "ISS-0003", "H3 작업지시번호")
        ok((await hist("A1229")).txNos.join() === "RET-0001,ISS-0002,ISS-0001,ISS-0005", "H4 제조번호 — 완료 작업지시 포함")
        ok((await hist("RM-SUS")).total === 5 && (await hist("rm-sus")).total === 5, "H5 품목코드(대소문자 무시)")
        ok((await hist("봉재")).total === 5, "H6 품목명")
        ok((await hist("LOT-001")).txNos.join() === "RET-0001,ISS-0001,ISS-0003,ISS-0005", "H7 LOT 번호")
        ok((await hist("A1229 LOT-002")).txNos.join() === "ISS-0002", "H8 검색어 AND — 제조번호 + LOT")
        ok((await hist("%")).txNos.join() === "ISS-%_9" && (await hist("_")).txNos.join() === "ISS-%_9", "H9 '%' '_' 는 문자 그대로")
        ok((await hist("\\")).txNos.join() === "ISS-%_9", "H10 '\\' 는 문자 그대로")
        // 기간(KST, 시작·종료일 포함)
        ok((await hist("", { from: "2026-11-10", to: "2026-11-10" })).txNos.join() === "RET-0001,ISS-0002", "H11 하루 기간(11-10 KST) — 11-09 15:10Z(=11-10 00:10 KST) 포함, 11-09 14:30Z(=11-09 23:30 KST) 제외")
        ok((await hist("", { from: "2026-11-09", to: "2026-11-09" })).txNos.join() === "ISS-0001", "H12 하루 기간(11-09 KST)")
        ok((await hist("", { from: "2026-11-05", to: "2026-11-08" })).txNos.join() === "ISS-%_9,ISS-0003", "H13 시작일·종료일 모두 포함")
        ok((await hist("", { to: "2026-10-31" })).txNos.join() === "ISS-0005" && (await hist("", { from: "2026-11-10" })).txNos.join() === "RET-0001,ISS-0002", "H14 시작일만/종료일만 지정")
        ok((await hist("", { from: "2026-11-20", to: "2026-11-01" })).total === 0, "H15 시작일이 종료일보다 늦으면 결과 없음")
        ok((await hist("", { from: "not-a-date", to: "2026-02-31" })).total === 6, "H16 잘못된 날짜는 필터 없음으로 처리")
        // 창고(출고는 출고창고, 반납은 반납창고)
        ok((await hist("", { wh: wh2.id })).txNos.join() === "ISS-0002", "H17 창고 필터(WH2)")
        ok((await hist("", { wh: wh1.id })).txNos.join() === "RET-0001,ISS-0001,ISS-%_9,ISS-0003,ISS-0005", "H18 창고 필터(WH1) — 반납은 반납창고 기준")
        ok((await hist("LOT-001", { wh: wh1.id, from: "2026-11-01", to: "2026-11-30" })).txNos.join() === "RET-0001,ISS-0001,ISS-0003", "H19 검색 + 기간 + 창고 AND")
        ok((await hist("", { wh: "no-such-warehouse" })).total === 0, "H20 없는 창고 id 는 결과 없음")
        // 페이지네이션
        const h1 = await S.findIssueHistoryPage(tx, { tenantId: t.id, terms: [], page: 1, pageSize: 4 })
        const h2 = await S.findIssueHistoryPage(tx, { tenantId: t.id, terms: [], page: 2, pageSize: 4 })
        ok(h1.total === 6 && h1.totalPages === 2 && h1.ids.length === 4 && h2.ids.length === 2 && new Set([...h1.ids, ...h2.ids]).size === 6, "H21 페이지네이션 — 전체 건수·페이지 수·중복/누락 없음")
        const h3 = await S.findIssueHistoryPage(tx, { tenantId: t.id, terms: [], page: 1, pageSize: 20 })
        const hOther = await S.findIssueHistoryPage(tx, { tenantId: t2.id, terms: [], page: 1, pageSize: 20 })
        ok(h3.total === 6 && hOther.total === 0, "H22 tenant 격리")
        ok((await hist("봉재 lot-001 wo-2026")).txNos.length === new Set((await hist("봉재 lot-001 wo-2026")).txNos).size, "H23 여러 검색어가 여러 항목에 일치해도 행 중복 없음")

        throw ROLLBACK
      },
      { timeout: 120000, maxWait: 20000 },
    )
  } catch (error) {
    if (error !== ROLLBACK) throw error
  } finally {
    await prisma.$disconnect()
  }
  console.log(`\n${pass} checks passed (모든 테스트 데이터는 롤백됨)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
