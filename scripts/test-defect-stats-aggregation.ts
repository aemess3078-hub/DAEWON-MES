/**
 * 불량분석 집계(aggregateDefectStats)가 전체 검사기록 기준으로 정확한지 검증한다. (읽기 전용 — DB 쓰기 없음)
 *   · 필터에 맞는 검사기록 "전체"를 Prisma 로 가져와 JS 로 직접 계산한 값과 DB 집계 결과를 비교한다.
 *   · 이전 구현은 최근 500건만 가져와 요약을 계산했으므로, 기록이 500건을 넘으면 요약이 줄어들었다.
 *     → 비교 대상 범위의 검사 건수가 작아도 "상세 목록 상한(예: 50건)을 걸어도 집계는 전체"임을 함께 확인한다.
 *   로컬 매뉴얼 DB(127.0.0.1:5432/daewon_mes_manual) 전용이다.
 * 실행: npx ts-node --compiler-options '{"module":"commonjs","moduleResolution":"node","target":"es2020"}' scripts/test-defect-stats-aggregation.ts
 */
import Module from 'node:module';
import { join } from 'node:path';
import { assertLocalTarget } from '../prisma/manual-seed-guard';

const TENANT_ID = assertLocalTarget();
const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const orig = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  return orig.call(this, request.startsWith('@/') ? join(process.cwd(), 'src', request.slice(2)) : request, ...rest);
};
/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma } = require('../src/lib/db/prisma') as typeof import('../src/lib/db/prisma');
const { aggregateDefectStats } = require('../src/lib/quality/defect-stats-aggregate') as typeof import('../src/lib/quality/defect-stats-aggregate');

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); ok ? pass++ : fail++; };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const kst = (d: Date) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

type F = { from: Date; toExclusive: Date; stage?: 'FIRST' | 'MID' | 'FINAL'; itemCode?: string; opSeq?: number };

async function expected(f: F) {
  const rows = await prisma.qualityInspection.findMany({
    where: { inspectedAt: { gte: f.from, lt: f.toExclusive }, ...(f.stage && { stage: f.stage }), workOrderOperation: { ...(f.opSeq && { routingOperation: { seq: f.opSeq } }), workOrder: { tenantId: TENANT_ID, ...(f.itemCode && { item: { code: f.itemCode } }) } } },
    include: { defectRecords: { include: { defectCode: true } }, workOrderOperation: { include: { workOrder: { include: { item: true } }, routingOperation: true } } },
  });
  const sum = { n: rows.length, qty: 0, pass: 0, fail: 0, defect: 0 };
  const daily = new Map<string, { q: number; d: number }>(), type = new Map<string, number>(), item = new Map<string, { q: number; d: number }>(), op = new Map<string, { q: number; d: number }>();
  for (const r of rows) {
    const q = Number(r.inspectedQty); const d = r.defectRecords.reduce((s, x) => s + Number(x.qty), 0);
    sum.qty += q; sum.defect += d; if (r.result === 'PASS') sum.pass += q; if (r.result === 'FAIL') sum.fail += q;
    const dk = kst(r.inspectedAt); const de = daily.get(dk) ?? { q: 0, d: 0 }; de.q += q; de.d += d; daily.set(dk, de);
    const ik = r.workOrderOperation.workOrder.item.code; const ie = item.get(ik) ?? { q: 0, d: 0 }; ie.q += q; ie.d += d; item.set(ik, ie);
    const ok = String(r.workOrderOperation.routingOperationId); const oe = op.get(ok) ?? { q: 0, d: 0 }; oe.q += q; oe.d += d; op.set(ok, oe);
    for (const dr of r.defectRecords) type.set(dr.defectCode.code, (type.get(dr.defectCode.code) ?? 0) + Number(dr.qty));
  }
  return { sum, daily, type, item, op };
}

async function compare(label: string, f: F) {
  const itemId = f.itemCode ? (await prisma.item.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: f.itemCode } })).id : undefined;
  const routingOperationId = undefined; // 공정은 seq 로 비교(라우팅마다 id 가 달라 별도 처리)
  const exp = await expected(f);
  const got = await aggregateDefectStats(prisma, { tenantId: TENANT_ID, from: f.from, toExclusive: f.toExclusive, stage: f.stage, itemId, routingOperationId });
  if (f.opSeq) { console.log(`  (공정 seq ${f.opSeq} 필터는 합계만 비교)`); }
  check(`${label}: 검사 건수 ${exp.sum.n}`, got.summary.inspectionCount === exp.sum.n || !!f.opSeq, `DB ${got.summary.inspectionCount}`);
  if (f.opSeq) return;
  check(`${label}: 검사수량·합격·불합격·불량 합계`, near(got.summary.inspectedQty, exp.sum.qty) && near(got.summary.passQty, exp.sum.pass) && near(got.summary.failQty, exp.sum.fail) && near(got.summary.defectQty, exp.sum.defect), `검사 ${exp.sum.qty} / 불량 ${exp.sum.defect}`);
  check(`${label}: 일자별 ${exp.daily.size}일`, got.daily.length === exp.daily.size && got.daily.every((d) => { const e = exp.daily.get(d.date); return !!e && near(d.inspectedQty, e.q) && near(d.defectQty, e.d); }));
  check(`${label}: 불량유형별 ${exp.type.size}종`, got.byType.length === exp.type.size && got.byType.every((t) => near(t.qty, exp.type.get(t.code) ?? -1)));
  check(`${label}: 품목별 ${exp.item.size}종`, got.byItem.length === exp.item.size && got.byItem.every((t) => { const e = exp.item.get(t.code); return !!e && near(t.inspectedQty, e.q) && near(t.defectQty, e.d); }));
  const opSum = got.byOperation.reduce((s, o) => s + o.inspectedQty, 0);
  check(`${label}: 공정별 합계 = 전체 검사수량`, near(opSum, exp.sum.qty) && got.byOperation.length === exp.op.size, `공정 ${got.byOperation.length}종`);
}

async function main() {
  console.log(`\n[defect-stats aggregation] tenant=${TENANT_ID}`);
  const total = await prisma.qualityInspection.count({ where: { workOrderOperation: { workOrder: { tenantId: TENANT_ID } } } });
  console.log(`  전체 검사기록 ${total}건 (이전 구현의 집계 한도 500건)`);
  const all: F = { from: new Date('2020-01-01T00:00:00Z'), toExclusive: new Date('2100-01-01T00:00:00Z') };
  const last30: F = { from: new Date('2026-10-12T00:00:00+09:00'), toExclusive: new Date('2026-11-12T00:00:00+09:00') };
  const last3m: F = { from: new Date('2026-08-12T00:00:00+09:00'), toExclusive: new Date('2026-11-12T00:00:00+09:00') };
  await compare('전체 기간', all);
  await compare('최근 3개월', last3m);
  await compare('최근 30일', last30);
  await compare('PIPE 품목', { ...last3m, itemCode: 'MAN-FG-PIPE01' });
  await compare('CAP 품목', { ...last3m, itemCode: 'MAN-FG-CAP01' });
  await compare('MID 단계', { ...last3m, stage: 'MID' });
  await compare('FINAL 단계', { ...last3m, stage: 'FINAL' });
  // 기간 경계: 하루만(KST 날짜 경계 포함)
  const day = await prisma.qualityInspection.findFirst({ where: { result: 'FAIL' }, orderBy: { inspectedAt: 'asc' } });
  if (day) { const k = kst(day.inspectedAt); await compare(`단일 일자 ${k}`, { from: new Date(`${k}T00:00:00+09:00`), toExclusive: new Date(new Date(`${k}T00:00:00+09:00`).getTime() + 86400e3) }); }
  console.log(`\n  결과: PASS ${pass} / FAIL ${fail}`);
  if (fail > 0) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
