/**
 * seed-manual-3months.ts --verify 용 읽기 전용 검증. DB 를 수정하지 않는다.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PrismaClient } from '@prisma/client';

type Args = { prisma: PrismaClient; TENANT_ID: string; manifestFile: string; ctx: { itemCode: Map<string, string>; item: Map<string, string>; bom: Map<string, { lines: Array<{ componentItemId: string; qtyPer: unknown; scrapRate: unknown }> }> } };
const num = (v: unknown) => Number(v ?? 0);
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const CUTOFF = new Date('2026-11-11T17:30:00+09:00').getTime();

export async function verifyAll({ prisma, TENANT_ID, manifestFile, ctx }: Args): Promise<boolean> {
  if (!fs.existsSync(manifestFile)) { console.log('  매니페스트가 없습니다(아직 apply 하지 않음).'); return false; }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as {
    existing: { lotIds: string[]; workOrderIds: string[]; salesOrderIds: string[]; poIds: string[]; planIds: string[] };
    baseline: { lotBalances: Record<string, number>; boxBalance: number; woOps: Record<string, string>; counts: Record<string, number> };
    cases: Record<string, { soId?: string; planIds: string[]; woIds: string[]; shipmentId?: string }>; purchases: Record<string, { poId: string }>; mrp: Record<string, unknown>;
  };
  const { requiredScaledByItem } = require('../src/lib/material-issue/issue-quantity') as typeof import('../src/lib/material-issue/issue-quantity');
  let allOk = true;
  const results: Array<{ name: string; ok: boolean; detail: string }> = [];
  const check = (name: string, ok: boolean, detail = '') => { results.push({ name, ok, detail }); if (!ok) allOk = false; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

  const demoWoIds = Object.values(manifest.cases).flatMap((c) => c.woIds);
  const wos = await prisma.workOrder.findMany({ where: { id: { in: demoWoIds } }, include: { operations: { orderBy: { seq: 'asc' }, include: { routingOperation: true } }, productionPlanItem: true, item: true } });
  const opIds = wos.flatMap((w) => w.operations.map((o) => o.id));
  const results_ = await prisma.productionResult.findMany({ where: { workOrderOperationId: { in: opIds } }, orderBy: { endedAt: 'asc' } });
  const insp = await prisma.qualityInspection.findMany({ where: { workOrderOperationId: { in: opIds } }, include: { defectRecords: true } });
  const byOp = <T extends { workOrderOperationId: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) m.set(r.workOrderOperationId, [...(m.get(r.workOrderOperationId) ?? []), r]); return m; };
  const resByOp = byOp(results_); const inspByOp = byOp(insp);
  console.log(`\n  [검증 대상] 시연 작업지시 ${wos.length}건, 공정 ${opIds.length}건, 실적 ${results_.length}건, 검사 ${insp.length}건\n`);

  // 1) 생산계획 = 작업지시 수량
  const bad1 = wos.filter((w) => !w.productionPlanItem || !near(num(w.productionPlanItem.plannedQty), num(w.plannedQty)));
  check('생산계획 수량 = 작업지시 수량', bad1.length === 0, bad1.length ? `불일치 ${bad1.length}건 (${bad1.slice(0, 3).map((w) => w.orderNo).join(',')})` : `${wos.length}건`);
  // 2) 공정 완료수량 = 실적 합 (양품+불량+재작업), 재작업=0
  let b2 = 0, rework = 0, b2s = '';
  for (const w of wos) for (const o of w.operations) {
    const rs = resByOp.get(o.id) ?? [];
    const sum = rs.reduce((s, r) => s + num(r.goodQty) + num(r.defectQty) + num(r.reworkQty), 0);
    rework += rs.reduce((s, r) => s + num(r.reworkQty), 0);
    if (!near(sum, num(o.completedQty))) { b2++; if (b2s.length < 120) b2s += `${w.orderNo}#${o.seq}(${sum}/${num(o.completedQty)}) `; }
  }
  check('공정 완료수량 = 실적(양품+불량+재작업) 합계', b2 === 0, b2 ? b2s : `재작업 합계 ${rework}`);
  // 3) 전공정 양품 = 다음 공정 처리량 (WIP 흐름), 완료 공정은 계획수량 이하
  let b3 = 0, b3s = '';
  for (const w of wos) {
    let prevGood: number | null = null;
    for (const o of w.operations) {
      const rs = resByOp.get(o.id) ?? [];
      const proc = rs.reduce((s, r) => s + num(r.goodQty) + num(r.defectQty), 0);
      const good = rs.reduce((s, r) => s + num(r.goodQty), 0);
      if (prevGood !== null && proc > prevGood + 1e-6) { b3++; if (b3s.length < 120) b3s += `${w.orderNo}#${o.seq}(${proc}>${prevGood}) `; }
      if (o.status === 'COMPLETED' && prevGood !== null && !near(proc, prevGood)) { b3++; if (b3s.length < 120) b3s += `${w.orderNo}#${o.seq}(완료 ${proc}≠${prevGood}) `; }
      if (rs.length > 0 || o.status === 'COMPLETED') prevGood = good; else prevGood = prevGood;
    }
  }
  check('공정 간 수량 흐름(전공정 양품 = 다음 공정 처리량)', b3 === 0, b3s);
  // 4) 불량기록 = POP 불량실적, 불량 있는 실적은 FAIL 자주검사
  let b4 = 0, b4s = '', defRecTotal = 0, defResTotal = 0;
  for (const w of wos) for (const o of w.operations) {
    const rs = resByOp.get(o.id) ?? []; const is = inspByOp.get(o.id) ?? [];
    const dRes = rs.reduce((s, r) => s + num(r.defectQty), 0);
    const dRec = is.reduce((s, q) => s + q.defectRecords.reduce((x, d) => x + num(d.qty), 0), 0);
    const failN = is.filter((q) => q.result === 'FAIL').length; const defResN = rs.filter((r) => num(r.defectQty) > 0).length;
    defRecTotal += dRec; defResTotal += dRes;
    if (!near(dRes, dRec) || failN !== defResN) { b4++; if (b4s.length < 120) b4s += `${w.orderNo}#${o.seq}(실적 ${dRes}/기록 ${dRec}, FAIL ${failN}/${defResN}) `; }
  }
  check('검사 불량기록 = 공정 불량실적 (수량·건수)', b4 === 0, b4 ? b4s : `불량 ${defRecTotal}`);
  const fails = insp.filter((q) => q.result === 'FAIL');
  const b4b = fails.filter((q) => { const r = (resByOp.get(q.workOrderOperationId) ?? []).find((x) => num(x.defectQty) > 0 && near(num(x.goodQty) + num(x.defectQty) + num(x.reworkQty), num(q.inspectedQty))); return !r; });
  check('불합격 검사 수량 = 해당 실적 처리량', b4b.length === 0, b4b.length ? `${b4b.length}건` : `${fails.length}건`);
  // 5) 자재출고 = BOM 필요량, 원자재 LOT 연결
  let b5 = 0, b5s = '', noIssue = 0;
  for (const w of wos) {
    const txs = await prisma.inventoryTransaction.findMany({ where: { tenantId: TENANT_ID, refType: 'WORK_ORDER', refId: w.id, txType: 'ISSUE' } });
    if (txs.length === 0) { noIssue++; continue; }
    const need = requiredScaledByItem(ctx.bom.get(w.item.code)!.lines, num(w.plannedQty));
    const got = new Map<string, number>(); for (const t of txs) got.set(t.itemId, (got.get(t.itemId) ?? 0) + num(t.qty));
    for (const [id, s] of need) if (!near(got.get(id) ?? 0, Number(s) / 1e6)) { b5++; if (b5s.length < 150) b5s += `${w.orderNo}:${ctx.itemCode.get(id)}(${got.get(id) ?? 0}/${Number(s) / 1e6}) `; }
  }
  check('자재출고 합계 = BOM 필요량', b5 === 0, b5 ? b5s : `미출고 작업지시 ${noIssue}건(작업대기)`);
  const consumedWos = wos.filter((w) => w.operations.some((o) => num(o.completedQty) > 0));
  const mlots = await prisma.workOrderMaterialLot.findMany({ where: { workOrderId: { in: wos.map((w) => w.id) } } });
  const lotMls = mlots.filter((m) => ctx.itemCode.get(m.materialItemId) !== 'MAN-CS-BOX');
  const lotNos = new Set(lotMls.map((m) => m.materialLotNo));
  const lotRows = await prisma.lot.findMany({ where: { tenantId: TENANT_ID, lotNo: { in: [...lotNos] } }, select: { id: true, lotNo: true, itemId: true } });
  const woWithoutMaterialLot = consumedWos.filter((w) => !mlots.some((m) => m.workOrderId === w.id));
  const lotItemMismatch = lotMls.filter((m) => !lotRows.some((l) => l.lotNo === m.materialLotNo && l.itemId === m.materialItemId));
  check('원자재 LOT ↔ 제조 LOT(작업지시) 연결', lotRows.length === lotNos.size && woWithoutMaterialLot.length === 0 && lotItemMismatch.length === 0, `연결 LOT ${lotNos.size}개 / 작업중 작업지시 중 LOT 미연결 ${woWithoutMaterialLot.length}건 / 품목 불일치 ${lotItemMismatch.length}`);
  const touchedExisting = lotRows.filter((l) => manifest.existing.lotIds.includes(l.id));
  check('시연 데이터가 기존(S01~S06) LOT 를 사용하지 않음', touchedExisting.length === 0, touchedExisting.length ? `${touchedExisting.length}개` : '');
  // 6) 재고 원장 = 재고 잔량 (전체)
  const txAll = await prisma.inventoryTransaction.findMany({ where: { tenantId: TENANT_ID }, select: { itemId: true, lotId: true, fromLocationId: true, toLocationId: true, qty: true } });
  const net = new Map<string, number>();
  const key = (i: string, w: string, l: string | null) => `${i}|${w}|${l ?? ''}`;
  for (const t of txAll) { if (t.toLocationId) net.set(key(t.itemId, t.toLocationId, t.lotId), (net.get(key(t.itemId, t.toLocationId, t.lotId)) ?? 0) + num(t.qty)); if (t.fromLocationId) net.set(key(t.itemId, t.fromLocationId, t.lotId), (net.get(key(t.itemId, t.fromLocationId, t.lotId)) ?? 0) - num(t.qty)); }
  const bals = await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID } });
  let b6 = 0, b6s = '', neg = 0;
  for (const b of bals) {
    const k = key(b.itemId, b.warehouseId, b.lotId); const n = net.get(k) ?? 0;
    if (!near(n, num(b.qtyOnHand), 1e-4)) { b6++; if (b6s.length < 150) b6s += `${ctx.itemCode.get(b.itemId)}(${n}/${num(b.qtyOnHand)}) `; }
    if (num(b.qtyOnHand) < -1e-9) neg++; net.delete(k);
  }
  const orphan = [...net.entries()].filter(([, v]) => Math.abs(v) > 1e-4);
  check('입출고 이력 합계 = 재고 잔량 (전 품목·창고·LOT)', b6 === 0 && orphan.length === 0 && neg === 0, `${bals.length}개 잔량 ${b6 ? `불일치 ${b6}: ${b6s}` : '일치'} / 음수재고 ${neg} / 잔량행 없는 이력 ${orphan.length}`);
  // 7) 완제품/반제품 입고 = 최종공정 완료 수량, LOT
  let b7 = 0, b7s = '', completedN = 0;
  for (const w of wos) {
    const last = w.operations[w.operations.length - 1];
    const rcv = await prisma.finishedGoodsReceipt.aggregate({ where: { tenantId: TENANT_ID, workOrderId: w.id }, _sum: { receiptQty: true }, _count: true });
    const lastRs = resByOp.get(last.id) ?? [];
    const lastGood = lastRs.reduce((s, r) => s + num(r.goodQty), 0);
    if (last.status === 'COMPLETED') { completedN++; if (!near(num(rcv._sum.receiptQty), lastGood)) { b7++; if (b7s.length < 150) b7s += `${w.orderNo}(입고 ${num(rcv._sum.receiptQty)}/양품 ${lastGood}) `; } }
    else if (num(rcv._sum.receiptQty) > 0) { b7++; b7s += `${w.orderNo}(미완료인데 입고) `; }
  }
  check('입고수량 = 최종공정 양품수량 (완료 작업지시)', b7 === 0, b7 ? b7s : `${completedN}건`);
  const rcvRows = await prisma.finishedGoodsReceipt.findMany({ where: { tenantId: TENANT_ID, workOrderId: { in: demoWoIds } }, select: { lotId: true, itemId: true } });
  const rcvLots = await prisma.lot.findMany({ where: { id: { in: rcvRows.map((r) => r.lotId!).filter(Boolean) } }, select: { id: true, itemId: true } });
  check('입고 LOT 존재·품목 일치', rcvRows.every((r) => r.lotId && rcvLots.some((l) => l.id === r.lotId && l.itemId === r.itemId)), `${rcvRows.length}건`);
  // 8) WIP 수량
  const wips = await prisma.wipUnit.findMany({ where: { workOrderId: { in: demoWoIds } }, select: { workOrderId: true, status: true, qty: true } });
  const wipActive = ['WAITING', 'IN_PROCESS', 'RECEIVED', 'OUTSOURCED', 'REWORK', 'HOLD'];
  let b8 = 0, b8s = '';
  for (const w of wos) {
    const last = w.operations[w.operations.length - 1];
    if (last.status !== 'COMPLETED') continue;
    const act = wips.filter((x) => x.workOrderId === w.id && wipActive.includes(x.status)).reduce((s, x) => s + num(x.qty), 0);
    if (act > 1e-6) { b8++; if (b8s.length < 150) b8s += `${w.orderNo}(잔여재공 ${act}) `; }
  }
  const stat = new Map<string, number>(); for (const x of wips) stat.set(x.status, (stat.get(x.status) ?? 0) + num(x.qty));
  check('완료 작업지시에 잔여 재공(WIP) 없음', b8 === 0, b8 ? b8s : [...stat].map(([k, v]) => `${k} ${v}`).join(', '));
  const wipDefect = wips.filter((x) => x.status === 'SCRAPPED').reduce((s, x) => s + num(x.qty), 0);
  check('폐기 재공 합계 = 공정 불량실적 합계', near(wipDefect, defResTotal), `재공 ${wipDefect} / 실적 ${defResTotal}`);
  // 9) 출하
  let b9 = 0, b9s = '';
  const soIds = Object.values(manifest.cases).map((c) => c.soId).filter(Boolean) as string[];
  const sois = await prisma.salesOrderItem.findMany({ where: { salesOrderId: { in: soIds } }, include: { shipmentItems: { include: { shipmentOrder: true } } } });
  for (const s of sois) {
    const shipped = s.shipmentItems.filter((x) => x.shipmentOrder.status === 'SHIPPED').reduce((a, x) => a + num(x.qty), 0);
    if (!near(shipped, num(s.shippedQty)) || shipped > num(s.qty) + 1e-9) { b9++; b9s += `${s.id}(${shipped}/${num(s.shippedQty)}) `; }
  }
  check('출하수량 = 수주 출하누계 (수주수량 이내)', b9 === 0, b9 ? b9s : `${sois.length}개 수주 품목`);
  // 10) 시간 순서
  let b10 = 0, b10s = ''; const tbad = (m: string) => { b10++; if (b10s.length < 200) b10s += m + ' '; };
  const woCaseSo = new Map<string, string>(); for (const c of Object.values(manifest.cases)) if (c.soId) for (const id of c.woIds) woCaseSo.set(id, c.soId);
  for (const w of wos) {
    const so = woCaseSo.get(w.id) ? await prisma.salesOrder.findUnique({ where: { id: woCaseSo.get(w.id)! } }) : null;
    if (so && !(so.orderDate.getTime() <= w.createdAt.getTime())) tbad(`${w.orderNo} 수주>작업지시`);
    const iss = await prisma.inventoryTransaction.findFirst({ where: { tenantId: TENANT_ID, refType: 'WORK_ORDER', refId: w.id, txType: 'ISSUE' }, orderBy: { txAt: 'asc' } });
    if (iss && iss.txAt.getTime() < w.createdAt.getTime()) tbad(`${w.orderNo} 작업지시>자재출고`);
    let prevEnd = iss ? iss.txAt.getTime() : w.createdAt.getTime();
    for (const o of w.operations) {
      const rs = resByOp.get(o.id) ?? [];
      if (o.startedAt && o.startedAt.getTime() + 1000 < prevEnd) tbad(`${w.orderNo}#${o.seq} 시작<전공정 종료`);
      for (const r of rs) { if (!r.startedAt || !r.endedAt || r.endedAt <= r.startedAt) tbad(`${w.orderNo}#${o.seq} 실적 시각`); if (r.endedAt && r.endedAt.getTime() > CUTOFF) tbad(`${w.orderNo}#${o.seq} 기준시각 초과`); }
      if (rs.length) prevEnd = Math.max(prevEnd, ...rs.map((r) => r.endedAt?.getTime() ?? 0));
      for (const q of inspByOp.get(o.id) ?? []) if (q.inspectedAt.getTime() < (o.startedAt?.getTime() ?? 0) - 1000) tbad(`${w.orderNo}#${o.seq} 검사<공정시작`);
    }
    const rc = await prisma.finishedGoodsReceipt.findMany({ where: { workOrderId: w.id } });
    for (const r of rc) if (r.receiptAt.getTime() < prevEnd - 1000) tbad(`${w.orderNo} 입고<공정종료`);
  }
  const ships = await prisma.shipmentOrder.findMany({ where: { id: { in: Object.values(manifest.cases).map((c) => c.shipmentId).filter(Boolean) as string[] } }, include: { items: true } });
  for (const sh of ships) { if (sh.shippedDate && sh.shippedDate.getTime() > CUTOFF) tbad(`${sh.shipmentNo} 기준시각 초과`); }
  const future = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(`select (select count(*) from "WorkOrder" where "createdAt" > '2026-11-11 08:30:00' and id = any($1)) + (select count(*) from "ProductionResult" where "endedAt" > '2026-11-11 08:30:00' and "workOrderOperationId" = any($2)) n`, demoWoIds, opIds);
  check('시간 순서 (수주→작업지시→자재출고→공정→검사→입고→출하, 기준시각 이후 없음)', b10 === 0 && Number(future[0].n) === 0, b10 ? b10s : '');
  // 11) 구매·입고
  const poRows = await prisma.purchaseOrder.findMany({ where: { id: { in: Object.values(manifest.purchases).map((p) => p.poId) } }, include: { items: true } });
  const badPo = poRows.filter((p) => p.items.some((i) => num(i.receivedQty) > num(i.qty) + 1e-9));
  const lotsPo = await prisma.lot.count({ where: { tenantId: TENANT_ID, id: { notIn: manifest.existing.lotIds }, item: { itemType: { in: ['RAW_MATERIAL', 'CONSUMABLE'] } } } });
  const rcvTx = await prisma.inventoryTransaction.aggregate({ where: { tenantId: TENANT_ID, refType: 'PURCHASE_ORDER', refId: { in: poRows.map((p) => p.id) }, txType: 'RECEIPT' }, _sum: { qty: true } });
  const recvSum = poRows.reduce((s, p) => s + p.items.reduce((x, i) => x + num(i.receivedQty), 0), 0);
  check('구매발주 입고수량 = 입고 이력 합계, 발주수량 초과 없음', badPo.length === 0 && near(num(rcvTx._sum.qty), recvSum), `발주 ${poRows.length}건 / 입고 ${recvSum} / 이력 ${num(rcvTx._sum.qty)} / 원자재 LOT ${lotsPo}개`);
  // 12) 외주
  const outPos = await prisma.purchaseOrder.findMany({ where: { tenantId: TENANT_ID, note: { contains: '[DEMO3M:' }, AND: { note: { contains: '-OUT]' } } }, include: { items: true } });
  let b12 = 0;
  for (const p of outPos) for (const i of p.items) {
    const mv = await prisma.wipMovement.findMany({ where: { tenantId: TENANT_ID, sourceType: 'PurchaseOrderItem', sourceId: i.id } });
    const sent = mv.filter((m) => m.movementType === 'OUTSOURCED').reduce((s, m) => s + num(m.qty), 0);
    const back = mv.filter((m) => m.movementType === 'RETURNED').reduce((s, m) => s + num(m.qty), 0);
    if (!near(sent, num(i.qty)) || !near(back, num(i.receivedQty)) ) b12++;
  }
  check('외주 발주·출고·입고 관계 (발주수량=외주출고, 입고수량=외주입고)', b12 === 0, `외주발주 ${outPos.length}건`);
  // 13) 기존 S01~S06 보존
  const base = manifest.baseline; let b13 = 0, b13s = '';
  for (const [lotId, q] of Object.entries(base.lotBalances)) { const b = await prisma.inventoryBalance.aggregate({ where: { tenantId: TENANT_ID, lotId }, _sum: { qtyOnHand: true } }); if (!near(num(b._sum.qtyOnHand), q)) { b13++; b13s += `LOT ${lotId.slice(-6)}(${num(b._sum.qtyOnHand)}/${q}) `; } }
  const exWos = await prisma.workOrder.findMany({ where: { id: { in: manifest.existing.workOrderIds } }, include: { operations: true } });
  for (const wo of exWos) { const s = `${wo.status}|${num(wo.plannedQty)}|` + wo.operations.sort((a, b) => a.seq - b.seq).map((o) => `${o.status}:${num(o.completedQty)}`).join(','); if (base.woOps[wo.orderNo] !== s) { b13++; b13s += `${wo.orderNo} `; } }
  const cnt = { results: await prisma.productionResult.count({ where: { workOrderOperation: { workOrderId: { in: manifest.existing.workOrderIds } } } }), inspections: await prisma.qualityInspection.count({ where: { workOrderOperation: { workOrderId: { in: manifest.existing.workOrderIds } } } }), issueTx: await prisma.inventoryTransaction.count({ where: { refType: 'WORK_ORDER', refId: { in: manifest.existing.workOrderIds }, txType: 'ISSUE' } }) };
  for (const k of Object.keys(cnt) as Array<keyof typeof cnt>) if (cnt[k] !== base.counts[k]) { b13++; b13s += `${k}(${cnt[k]}/${base.counts[k]}) `; }
  const exSo = await prisma.salesOrder.count({ where: { id: { in: manifest.existing.salesOrderIds } } });
  check('기존 S01~S06 보존 (LOT 잔량·작업지시·공정·실적·검사·출고 이력 동일)', b13 === 0 && exSo === manifest.existing.salesOrderIds.length, b13 ? b13s : `기존 수주 ${exSo} · 작업지시 ${exWos.length} · LOT ${Object.keys(base.lotBalances).length}`);
  const boxNow = await prisma.inventoryBalance.findFirst({ where: { tenantId: TENANT_ID, item: { code: 'MAN-CS-BOX' }, lotId: null } });
  check('비LOT 소모품(포장박스) 잔량이 기존 수량 이상 유지', num(boxNow?.qtyOnHand) >= base.boxBalance - 1e-9, `기존 ${base.boxBalance} → 현재 ${num(boxNow?.qtyOnHand)}`);

  // 요약 파일(보고용)
  const sumFile = path.join(path.dirname(manifestFile), 'summary-' + path.basename(manifestFile).replace('manifest-', ''));
  const monthly = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`select to_char(r."endedAt" + interval '9 hours','YYYY-MM') m, i.code, sum(r."goodQty")::float good, sum(r."defectQty")::float defect from "ProductionResult" r join "WorkOrderOperation" o on o.id=r."workOrderOperationId" join "WorkOrder" w on w.id=o."workOrderId" join "Item" i on i.id=w."itemId" where w.id = any($1) and o.seq = (select max(seq) from "WorkOrderOperation" x where x."workOrderId"=w.id) group by 1,2 order by 1,2`, demoWoIds);
  fs.writeFileSync(sumFile, JSON.stringify({ generatedAt: new Date().toISOString(), checks: results, counts: { workOrders: wos.length, operations: opIds.length, results: results_.length, inspections: insp.length, defectRecords: insp.reduce((s, q) => s + q.defectRecords.length, 0), defectQty: defRecTotal, salesOrders: soIds.length, shipments: ships.length, purchaseOrders: poRows.length }, monthlyFinalOpGoodDefect: monthly }, null, 2));
  console.log(`\n  ${allOk ? '모든 검증 통과' : '검증 실패 항목이 있습니다'} (${results.filter((r) => r.ok).length}/${results.length})`);
  return allOk;
}
