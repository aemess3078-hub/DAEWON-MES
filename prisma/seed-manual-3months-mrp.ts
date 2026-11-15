/**
 * seed-manual-3months.ts --phase=mrp : MRP 시연용 가상 데이터 (로컬 매뉴얼 DB 전용, 멱등)
 *
 *  · 2026-11~12 납기의 미완료(확정) 수주 13건 — 서로 다른 품목·납기, 공통 원자재(철판·분체도료·포장박스) 공유
 *  · 미입고 구매발주(ORDERED) / 일부입고(PARTIAL_RECEIVED) — 입고예정으로 MRP 에 반영됨 (일부 자재는 입고예정 후에도 부족)
 *  · 원자재 재고는 구매입고(서버 액션)로만 조정한다. 기존 데이터 수량·상태는 바꾸지 않는다.
 *  · MRP 실행이력(Snapshot)은 여기서 만들지 않는다. 화면 시연 시 사용자가 저장하거나, 별도 단계에서 "실제 생성 시각"으로 저장한다.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const ORDERS = [
  { id: 'M01', cust: 'MAN-C01', item: 'MAN-FG-PIPE01', qty: 200, price: 6500, order: '2026-11-02', due: '2026-11-19' },
  { id: 'M02', cust: 'MAN-C03', item: 'MAN-FG-CAP01', qty: 200, price: 3200, order: '2026-11-03', due: '2026-11-24' },
  { id: 'M03', cust: 'MAN-C01', item: 'MAN-FG-NRV01', qty: 30, price: 45000, order: '2026-11-04', due: '2026-11-27' },
  { id: 'M04', cust: 'MAN-C02', item: 'MAN-FG-PIPE01', qty: 300, price: 6500, order: '2026-11-05', due: '2026-12-01' },
  { id: 'M05', cust: 'MAN-C01', item: 'MAN-FG-CAP01', qty: 300, price: 3200, order: '2026-11-06', due: '2026-12-04' },
  { id: 'M06', cust: 'MAN-C02', item: 'MAN-FG-NRV01', qty: 40, price: 45000, order: '2026-11-09', due: '2026-12-10' },
  { id: 'M07', cust: 'MAN-C03', item: 'MAN-FG-PIPE01', qty: 400, price: 6500, order: '2026-11-09', due: '2026-12-14' },
  { id: 'M08', cust: 'MAN-C03', item: 'MAN-FG-CAP01', qty: 300, price: 3200, order: '2026-11-10', due: '2026-12-18' },
  { id: 'M09', cust: 'MAN-C01', item: 'MAN-FG-NRV01', qty: 50, price: 45000, order: '2026-11-10', due: '2026-12-22' },
  { id: 'M10', cust: 'MAN-C02', item: 'MAN-FG-PIPE01', qty: 300, price: 6500, order: '2026-11-10', due: '2026-12-28' },
  { id: 'M11', cust: 'MAN-C01', item: 'MAN-FG-CAP01', qty: 600, price: 3200, order: '2026-11-11', due: '2026-12-12' },
  { id: 'M12', cust: 'MAN-C03', item: 'MAN-FG-NRV01', qty: 60, price: 45000, order: '2026-11-11', due: '2026-12-24' },
  { id: 'M13', cust: 'MAN-C02', item: 'MAN-FG-CAP01', qty: 400, price: 3200, order: '2026-11-11', due: '2026-12-29' },
];
// 입고예정 구매발주(미입고/일부입고). receiveNow = 발주일에 이미 입고한 수량(일부입고 표현)
const POS = [
  { id: 'MP01', supplier: 'MAN-S01', order: '2026-11-04', expected: '2026-12-04', lines: [{ item: 'MAN-RM-PIPE-STK', qty: 150, price: 4600 }] },
  { id: 'MP02', supplier: 'MAN-S01', order: '2026-11-09', expected: '2026-12-10', lines: [{ item: 'MAN-RM-PIPE-STK', qty: 100, price: 4650 }, { item: 'MAN-RM-NRV-BAR', qty: 100, price: 1130 }] },
  { id: 'MP03', supplier: 'MAN-S02', order: '2026-11-09', expected: '2026-11-27', lines: [{ item: 'MAN-RM-PLATE', qty: 200, price: 1230, receiveNow: 80 }] },
  { id: 'MP04', supplier: 'MAN-S02', order: '2026-11-10', expected: '2026-12-08', lines: [{ item: 'MAN-CS-POWDER', qty: 10, price: 8700 }] },
];

export async function applyMrp(d: any) {
  const { prisma, TENANT_ID, at, act, manifest, saveManifest, itemId, partnerId, SITE_ID, WH, dateOf } = d;
  const kst = (iso: string, h: number, m = 0) => new Date(`${iso}T00:00:00+09:00`).getTime() + (h * 60 + m) * 60000;
  manifest.mrp ??= {};
  const adminId = (await prisma.userCredential.findFirstOrThrow({ where: { tenantId: TENANT_ID, loginId: { not: 'test' }, profile: { tenantUsers: { some: { tenantId: TENANT_ID, role: 'OWNER' } } } } })).profileId;
  const m: Record<string, any> = manifest.mrp;
  m.salesOrders ??= []; m.purchaseOrders ??= [];
  for (const o of ORDERS) {
    const tag = `[DEMO3M:${o.id}]`;
    let so = await prisma.salesOrder.findFirst({ where: { tenantId: TENANT_ID, note: { contains: tag } } });
    if (!so) {
      const t = kst(o.order, 9, 10 + ORDERS.indexOf(o) * 7);
      await at(t, () => act.so().createSalesOrder(TENANT_ID, SITE_ID, {
        customerId: partnerId(o.cust), orderDate: dateOf(t), deliveryDate: dateOf(kst(o.due, 9)), totalAmount: o.qty * o.price, currency: 'KRW',
        note: `${tag} 시연용 가상 수주(MRP 시연, 미완료)`, items: [{ itemId: itemId(o.item), qty: o.qty, unitPrice: o.price, deliveryDate: dateOf(kst(o.due, 9)) }],
      }));
      so = await prisma.salesOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: tag } } });
    }
    if (!m.salesOrders.includes(so.id)) m.salesOrders.push(so.id);
  }
  for (const p of POS) {
    const tag = `[DEMO3M:${p.id}]`;
    let po = await prisma.purchaseOrder.findFirst({ where: { tenantId: TENANT_ID, note: { contains: tag } }, include: { items: true } });
    if (!po) {
      const t = kst(p.order, 10, 20);
      const total = p.lines.reduce((s: number, l: any) => s + l.qty * l.price, 0);
      const res = await at(t, () => act.po().createPurchaseOrder(TENANT_ID, SITE_ID, {
        supplierId: partnerId(p.supplier), orderDate: dateOf(t), expectedDate: dateOf(kst(p.expected, 9)), status: 'ORDERED', totalAmount: total, currency: 'KRW',
        note: `${tag} 시연용 가상 구매발주(입고예정)`, items: p.lines.map((l: any) => ({ itemId: itemId(l.item), qty: l.qty, unitPrice: l.price })),
      }));
      if (!res.success) throw new Error(`MRP 구매발주 실패(${p.id}): ${(res as any).error}`);
      po = await prisma.purchaseOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: tag } }, include: { items: true } });
    }
    // 시연 일정 조정: 이미 만들어진 시연 발주의 입고예정일이 계획과 다르면 맞춘다(시연 데이터 한정, 로컬 전용).
    const wantExpected = kst(p.expected, 9);
    if (po.expectedDate?.getTime() !== wantExpected) po = await prisma.purchaseOrder.update({ where: { id: po.id }, data: { expectedDate: dateOf(wantExpected) }, include: { items: true } });
    for (const l of p.lines as any[]) {
      if (!l.receiveNow) continue;
      const poItem = po.items.find((x: any) => x.itemId === itemId(l.item))!;
      const fresh = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: poItem.id } });
      const remain = l.receiveNow - Number(fresh.receivedQty);
      if (remain <= 1e-9) continue;
      const t = kst('2026-11-11', 11, 0);
      const r = await at(t, () => act.rcv().createReceivingInspection({
        purchaseOrderItemId: poItem.id, purchaseOrderId: po!.id, warehouseId: WH.RAW, siteId: SITE_ID, inspectorId: adminId,
        receivedQty: remain, acceptedQty: remain, rejectedQty: 0, result: 'PASS', note: `${tag} 일부입고(시연)`, requestId: `demo3m-${p.id}-${l.item.toLowerCase().replace(/[^a-z0-9]/g, '')}-part`.padEnd(16, '0'),
      }));
      if (!r.success) throw new Error(`MRP 일부입고 실패(${p.id}): ${r.message}`);
    }
    if (!m.purchaseOrders.includes(po.id)) m.purchaseOrders.push(po.id);
  }
  saveManifest();
  // 결과 미리보기(읽기 전용, 실시간)
  d.useReal();
  const { runOrderBasedMrp } = require('../src/lib/actions/mrp-order.actions');
  for (const withReceipts of [false, true]) {
    const r = await runOrderBasedMrp({ from: '2026-11-12', to: '2026-12-31', includeScheduledReceipts: withReceipts });
    const mats = r.view.materials as any[];
    console.log(`
  [MRP 미리보기] 2026-11-12~12-31, 입고예정 ${withReceipts ? '반영' : '미반영'} — 자재 ${mats.length}종, 수주 ${r.view.kpi?.demandLineCount ?? '?'}건`);
    for (const x of mats) console.log(`    ${String(x.code).padEnd(16)} 가용 ${String(Math.round(x.qtyAvailable * 100) / 100).padStart(9)} 소요 ${String(Math.round(x.totalRequirement * 100) / 100).padStart(9)} 입고예정 ${String(x.scheduledReceiptQty).padStart(6)} 예상재고 ${String(Math.round(x.finalBalance * 100) / 100).padStart(9)} 부족 ${String(Math.round(x.shortageQty * 100) / 100).padStart(8)} 최초결품 ${x.firstShortageDate ?? '-'} (${x.firstShortageOrderNo ?? '-'}) 제품 ${x.productCount} 수주 ${x.demandLineCount}`);
  }
}
