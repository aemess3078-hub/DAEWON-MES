/**
 * 매뉴얼 기준정보 보완(v2) — seed-manual-master.ts 이후에 실행한다. 기존 seed 는 수정하지 않는다.
 *
 *  A. 품목 단가(ItemPrice): 구매단가(공급사별) / 판매단가(고객별). 전부 가상 단가.
 *  B. 작업장 보완: WC-WELD(용접) / WC-COAT(도장) / WC-OUTS(외주가공) 추가.
 *     - WorkCenterKind 는 화면 라벨일 뿐 생산·POP·외주 로직에 쓰이지 않는다(외주는 작업장이 아니라 외주발주 + 재공 이동으로 처리).
 *     - 가공 작업장(WC-MACH)과 설비(CNC-1/8/9, MCT-6) 매핑은 변경하지 않는다.
 *     - NRV 라우팅을 [가공→용접→열처리(외주)→도장(외주)→세척→포장→최종검사]로 재구성(최종검사를 마지막 공정에 두어야 시스템의 출하 품질 게이트가 동작).
 *       아직 작업지시가 없을 때만 수행한다. CAP 라우팅의 분체도장은 WC-COAT 로 이동.
 *  C. 반제품 라우팅 보완: NRV 디스크 / CAP 원판(작업지시 생성에는 라우팅이 필수라 반제품 생산 시나리오에 필요).
 *
 * 실행: npx ts-node --compiler-options "{\"module\":\"commonjs\",\"target\":\"es2020\"}" --project tsconfig.json prisma/seed-manual-master-v2.ts [--verify]
 * 멱등: 자연키 upsert / findFirst. 단일 트랜잭션. 삭제는 NRV 라우팅 재구성 시 이 seed 가 만든 검사기준 1건뿐(참조 없을 때만).
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { assertLocalTarget, EXPECT } from './manual-seed-guard';

const TENANT_ID = assertLocalTarget();
const VERIFY_ONLY = process.argv.includes('--verify');
const prisma = new PrismaClient();
const SITE_ID = 'site-daewon-factory-001';
const TAG = '[매뉴얼 테스트용 가상 단가]';

const WC_BASE = { MACH: 'wc-daewon-machining-001', INSP: 'wc-daewon-inspection-001', WASH: 'wc-daewon-washing-001', PACK: 'wc-daewon-packaging-001' };
const NEW_WC = [
  { id: 'wc-manual-weld-001', code: 'WC-WELD', name: '용접', kind: 'ASSEMBLY' as const },
  { id: 'wc-manual-coat-001', code: 'WC-COAT', name: '도장', kind: 'ASSEMBLY' as const },
  { id: 'wc-manual-outs-001', code: 'WC-OUTS', name: '외주가공', kind: 'ASSEMBLY' as const },
];
const WC = { ...WC_BASE, WELD: NEW_WC[0].id, COAT: NEW_WC[1].id, OUTS: NEW_WC[2].id } as const;
type WcKey = keyof typeof WC;

// 가상 단가 (KRW)
const PURCHASE_PRICES: Array<{ item: string; partner: string; price: number }> = [
  { item: 'MAN-RM-PIPE-STK', partner: 'MAN-S01', price: 4500 },
  { item: 'MAN-RM-NRV-BAR', partner: 'MAN-S01', price: 1100 },
  { item: 'MAN-RM-PLATE', partner: 'MAN-S02', price: 1200 },
  { item: 'MAN-RM-PLATE', partner: 'MAN-S01', price: 1350 },
  { item: 'MAN-CS-POWDER', partner: 'MAN-S02', price: 8500 },
  { item: 'MAN-CS-BOX', partner: 'MAN-S03', price: 700 },
];
const SALES_PRICES: Array<{ item: string; partner: string; price: number }> = [
  { item: 'MAN-FG-NRV01', partner: 'MAN-C01', price: 45000 },
  { item: 'MAN-FG-PIPE01', partner: 'MAN-C02', price: 6500 },
  { item: 'MAN-FG-CAP01', partner: 'MAN-C03', price: 3800 },
];
const EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');

type Op = { name: string; wc: WcKey; min: number };
const NRV_OPS: Op[] = [
  { name: '[테스트] 조립부 가공', wc: 'MACH', min: 15 },
  { name: '[테스트] 용접', wc: 'WELD', min: 12 },
  { name: '[테스트] 열처리 (외주)', wc: 'OUTS', min: 0 },
  { name: '[테스트] 도장 (외주)', wc: 'COAT', min: 0 },
  { name: '[테스트] 세척', wc: 'WASH', min: 5 },
  { name: '[테스트] 포장', wc: 'PACK', min: 3 },
  { name: '[테스트] 최종검사(외관·기능)', wc: 'INSP', min: 10 },
];
const NEW_ROUTINGS: Array<{ code: string; name: string; item: string; ops: Op[]; maps: Array<{ eq: string; seq: number }> }> = [
  {
    code: 'MAN-RT-NRV-DISC', name: 'NRV 디스크 가공 라우팅(테스트 구성)', item: 'MAN-SF-NRV-DISC',
    ops: [{ name: '[테스트] 소재 검사', wc: 'INSP', min: 6 }, { name: '[테스트] 철판 절단', wc: 'MACH', min: 3 }, { name: '[테스트] 디스크 가공', wc: 'MACH', min: 8 }],
    maps: [{ eq: 'MCT-6', seq: 3 }],
  },
  {
    code: 'MAN-RT-CAP-DISC', name: 'CAP 원판 가공 라우팅(테스트 구성)', item: 'MAN-SF-CAP-DISC',
    ops: [{ name: '[테스트] 소재 검사', wc: 'INSP', min: 6 }, { name: '[테스트] 철판 절단', wc: 'MACH', min: 3 }, { name: '[테스트] 원형·센터홀 가공', wc: 'MACH', min: 4 }],
    maps: [{ eq: 'CNC-1', seq: 3 }],
  },
];

const tally: Record<string, { created: number; updated: number }> = {};
const bump = (k: string, existed: boolean) => { (tally[k] ??= { created: 0, updated: 0 })[existed ? 'updated' : 'created']++; };

async function apply(tx: Prisma.TransactionClient) {
  const items = new Map((await tx.item.findMany({ where: { tenantId: TENANT_ID, code: { startsWith: 'MAN-' } } })).map((i) => [i.code, i.id]));
  const partners = new Map((await tx.businessPartner.findMany({ where: { tenantId: TENANT_ID, code: { startsWith: 'MAN-' } } })).map((p) => [p.code, p.id]));
  if (items.size < 11 || partners.size < 8) throw new Error('기준정보(seed-manual-master.ts)가 먼저 적용되어야 합니다.');

  // B-1 작업장
  for (const w of NEW_WC) {
    const where = { siteId_code: { siteId: SITE_ID, code: w.code } };
    const existed = !!(await tx.workCenter.findUnique({ where }));
    await tx.workCenter.upsert({ where, create: { id: w.id, siteId: SITE_ID, code: w.code, name: w.name, kind: w.kind }, update: { name: w.name, kind: w.kind } });
    bump('작업장', existed);
  }

  // A 단가
  for (const [priceType, list] of [['PURCHASE', PURCHASE_PRICES], ['SALES', SALES_PRICES]] as const) {
    for (const p of list) {
      const itemId = items.get(p.item)!, partnerId = partners.get(p.partner)!;
      const found = await tx.itemPrice.findFirst({ where: { tenantId: TENANT_ID, itemId, partnerId, priceType, effectiveFrom: EFFECTIVE_FROM } });
      const data = { unitPrice: p.price, currency: 'KRW', effectiveTo: null, note: `${TAG} ${priceType === 'PURCHASE' ? '구매단가' : '판매단가'}` };
      if (found) await tx.itemPrice.update({ where: { id: found.id }, data });
      else await tx.itemPrice.create({ data: { tenantId: TENANT_ID, itemId, partnerId, priceType, effectiveFrom: EFFECTIVE_FROM, ...data } });
      bump(priceType === 'PURCHASE' ? '구매단가' : '판매단가', !!found);
    }
  }

  // B-2 NRV 라우팅 재구성 (작업지시가 없을 때만)
  const nrv = await tx.routing.findUnique({ where: { tenantId_code: { tenantId: TENANT_ID, code: 'MAN-RT-NRV' } }, include: { operations: { orderBy: { seq: 'asc' } } } });
  if (!nrv) throw new Error('MAN-RT-NRV 라우팅이 없습니다.');
  const nrvOpIds = nrv.operations.map((o) => o.id);
  const alreadyDone = nrv.operations.length === NRV_OPS.length && NRV_OPS.every((o, i) => nrv.operations[i].name === o.name && nrv.operations[i].workCenterId === WC[o.wc]);
  if (!alreadyDone) {
    const used = await tx.workOrderOperation.count({ where: { routingOperationId: { in: nrvOpIds } } });
    if (used > 0) throw new Error('MAN-RT-NRV 를 사용하는 작업지시가 있어 라우팅을 재구성하지 않습니다.');
    const specs = await tx.inspectionSpec.findMany({ where: { routingOperationId: { in: nrvOpIds } }, select: { id: true } });
    const specIds = specs.map((s) => s.id);
    if (specIds.length > 0 && (await tx.qualityInspection.count({ where: { inspectionSpecId: { in: specIds } } })) > 0) throw new Error('NRV 검사기준에 검사 이력이 있어 재구성하지 않습니다.');
    await tx.inspectionItem.deleteMany({ where: { inspectionSpecId: { in: specIds } } });
    await tx.inspectionSpec.deleteMany({ where: { id: { in: specIds } } });
    // 설비 매핑은 1번 공정(가공, MCT-6)만 유지된다 — 2번 이후에 붙은 매핑이 있으면 중단(임의 변경 금지)
    const strayMaps = await tx.equipmentOperationMap.count({ where: { routingOperationId: { in: nrv.operations.filter((o) => o.seq > 1).map((o) => o.id) } } });
    if (strayMaps > 0) throw new Error('NRV 2번 이후 공정에 설비 매핑이 있어 재구성하지 않습니다.');
  }
  for (const [idx, o] of NRV_OPS.entries()) {
    const seq = idx + 1;
    const w = { routingId_seq: { routingId: nrv.id, seq } };
    const existed = !!(await tx.routingOperation.findUnique({ where: w }));
    const d = { workCenterId: WC[o.wc], operationCode: `OP${String(seq * 10).padStart(2, '0')}`, name: o.name, standardTime: o.min };
    await tx.routingOperation.upsert({ where: w, create: { routingId: nrv.id, seq, ...d }, update: d });
    bump('NRV 라우팅 공정', existed);
  }
  const nrvLast = await tx.routingOperation.findUniqueOrThrow({ where: { routingId_seq: { routingId: nrv.id, seq: NRV_OPS.length } } });
  const nrvItemId = items.get('MAN-FG-NRV01')!;
  const nrvSpecWhere = { tenantId_itemId_routingOperationId_version: { tenantId: TENANT_ID, itemId: nrvItemId, routingOperationId: nrvLast.id, version: '1.0' } };
  const nrvSpecExisted = !!(await tx.inspectionSpec.findUnique({ where: nrvSpecWhere }));
  const nrvSpec = await tx.inspectionSpec.upsert({ where: nrvSpecWhere, create: { tenantId: TENANT_ID, itemId: nrvItemId, routingOperationId: nrvLast.id, version: '1.0', status: 'ACTIVE' }, update: { status: 'ACTIVE' } });
  bump('검사기준(NRV 최종검사)', nrvSpecExisted);
  const nrvInsp = [
    { name: '[테스트] 도장 외관(얼룩·박리) 유무', inputType: 'BOOLEAN' as const, lo: null, hi: null, unit: null },
    { name: '[테스트] 역류방지 기능(누설 없음)', inputType: 'BOOLEAN' as const, lo: null, hi: null, unit: null },
    { name: '[테스트] 시험압력 유지', inputType: 'NUMERIC' as const, lo: 1.5, hi: 2.0, unit: 'MPa' },
  ];
  for (const [i, it] of nrvInsp.entries()) {
    const w = { inspectionSpecId_seq: { inspectionSpecId: nrvSpec.id, seq: i + 1 } };
    const ex = !!(await tx.inspectionItem.findUnique({ where: w }));
    const d = { name: it.name, inputType: it.inputType, lowerLimit: it.lo, upperLimit: it.hi, unit: it.unit };
    await tx.inspectionItem.upsert({ where: w, create: { inspectionSpecId: nrvSpec.id, seq: i + 1, ...d }, update: d });
    bump('검사항목(NRV 최종검사)', ex);
  }

  // B-3 CAP 분체도장 → 도장 작업장 (설비 매핑 없음)
  const cap = await tx.routing.findUniqueOrThrow({ where: { tenantId_code: { tenantId: TENANT_ID, code: 'MAN-RT-CAP' } } });
  const capOp5 = await tx.routingOperation.findUniqueOrThrow({ where: { routingId_seq: { routingId: cap.id, seq: 5 } } });
  if (capOp5.name !== '분체도장') throw new Error('CAP 5번 공정이 분체도장이 아닙니다. 중단합니다.');
  const moved = capOp5.workCenterId !== WC.COAT;
  if (moved) await tx.routingOperation.update({ where: { id: capOp5.id }, data: { workCenterId: WC.COAT } });
  bump('CAP 분체도장 작업장 이동', !moved);

  // C 반제품 라우팅
  for (const r of NEW_ROUTINGS) {
    const where = { tenantId_code: { tenantId: TENANT_ID, code: r.code } };
    const existed = !!(await tx.routing.findUnique({ where }));
    const routing = await tx.routing.upsert({ where, create: { tenantId: TENANT_ID, code: r.code, name: r.name, version: '1.0', status: 'ACTIVE', scope: 'ITEM_SPECIFIC' }, update: { name: r.name, status: 'ACTIVE' } });
    bump('반제품 라우팅', existed);
    const itemId = items.get(r.item)!;
    const opIds = new Map<number, string>();
    for (const [idx, o] of r.ops.entries()) {
      const seq = idx + 1;
      const w = { routingId_seq: { routingId: routing.id, seq } };
      const ex = !!(await tx.routingOperation.findUnique({ where: w }));
      const d = { workCenterId: WC[o.wc], operationCode: `OP${String(seq * 10).padStart(2, '0')}`, name: o.name, standardTime: o.min };
      const op = await tx.routingOperation.upsert({ where: w, create: { routingId: routing.id, seq, ...d }, update: d });
      opIds.set(seq, op.id);
      bump('반제품 라우팅 공정', ex);
    }
    const lw = { itemId_routingId: { itemId, routingId: routing.id } };
    const lex = !!(await tx.itemRouting.findUnique({ where: lw }));
    await tx.itemRouting.upsert({ where: lw, create: { tenantId: TENANT_ID, itemId, routingId: routing.id, isDefault: true }, update: { isDefault: true } });
    bump('품목-라우팅 연결', lex);
    for (const m of r.maps) {
      const eq = await tx.equipment.findUniqueOrThrow({ where: { siteId_code: { siteId: SITE_ID, code: m.eq } } });
      const w = { equipmentId_routingOperationId: { equipmentId: eq.id, routingOperationId: opIds.get(m.seq)! } };
      const ex = !!(await tx.equipmentOperationMap.findUnique({ where: w }));
      await tx.equipmentOperationMap.upsert({ where: w, create: { equipmentId: eq.id, routingOperationId: opIds.get(m.seq)! }, update: {} });
      bump('설비-공정 매핑', ex);
    }
    // 소재 검사(1번) 검사기준
    const specWhere = { tenantId_itemId_routingOperationId_version: { tenantId: TENANT_ID, itemId, routingOperationId: opIds.get(1)!, version: '1.0' } };
    const sex = !!(await tx.inspectionSpec.findUnique({ where: specWhere }));
    const spec = await tx.inspectionSpec.upsert({ where: specWhere, create: { tenantId: TENANT_ID, itemId, routingOperationId: opIds.get(1)!, version: '1.0', status: 'ACTIVE' }, update: { status: 'ACTIVE' } });
    bump('검사기준', sex);
    for (const [i, name] of ['[테스트] 표면 녹·스크래치 유무(외관)', '[테스트] 성적서·재질 일치 확인'].entries()) {
      const w = { inspectionSpecId_seq: { inspectionSpecId: spec.id, seq: i + 1 } };
      const ex = !!(await tx.inspectionItem.findUnique({ where: w }));
      await tx.inspectionItem.upsert({ where: w, create: { inspectionSpecId: spec.id, seq: i + 1, name, inputType: 'BOOLEAN' }, update: { name, inputType: 'BOOLEAN' } });
      bump('검사항목', ex);
    }
  }
}

async function verify(): Promise<boolean> {
  let ok = true;
  const check = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) ok = false; };
  const prices = await prisma.itemPrice.findMany({ where: { tenantId: TENANT_ID, note: { startsWith: TAG } }, include: { item: true, partner: true } });
  check(prices.length === PURCHASE_PRICES.length + SALES_PRICES.length, `단가 ${prices.length}건 (구매 ${prices.filter((p) => p.priceType === 'PURCHASE').length}, 판매 ${prices.filter((p) => p.priceType === 'SALES').length})`);
  check(prices.filter((p) => p.priceType === 'PURCHASE').every((p) => p.partner.partnerType === 'SUPPLIER') && prices.filter((p) => p.priceType === 'SALES').every((p) => p.partner.partnerType === 'CUSTOMER'), '구매단가=공급사, 판매단가=고객사 연결');
  const supplierLinks = await prisma.itemSupplier.findMany({ where: { tenantId: TENANT_ID, item: { code: { startsWith: 'MAN-' } } }, include: { item: true, supplier: true } });
  check(supplierLinks.every((s) => prices.some((p) => p.priceType === 'PURCHASE' && p.itemId === s.itemId && p.partnerId === s.supplierId)), '품목-공급업체 관계마다 구매단가 존재');
  const wcs = await prisma.workCenter.findMany({ where: { siteId: SITE_ID }, orderBy: { code: 'asc' } });
  check(['WC-WELD', 'WC-COAT', 'WC-OUTS'].every((c) => wcs.some((w) => w.code === c)) && wcs.length === 8, `작업장 ${wcs.map((w) => w.code).join(', ')}`);
  const nrv = await prisma.routing.findUniqueOrThrow({ where: { tenantId_code: { tenantId: TENANT_ID, code: 'MAN-RT-NRV' } }, include: { operations: { include: { workCenter: true, equipmentMaps: { include: { equipment: true } } }, orderBy: { seq: 'asc' } } } });
  check(nrv.operations.length === 7 && NRV_OPS.every((o, i) => nrv.operations[i].name === o.name && nrv.operations[i].workCenterId === WC[o.wc]), `NRV 라우팅: ${nrv.operations.map((o) => `${o.seq}.${o.name.replace('[테스트] ', '')}[${o.workCenter.code}]`).join(' → ')}`);
  check(nrv.operations[0].equipmentMaps.map((m) => m.equipment.code).join() === 'MCT-6' && nrv.operations.slice(1).every((o) => o.equipmentMaps.length === 0), '가공 공정↔MCT-6 매핑 유지, 나머지 공정 매핑 없음');
  const finalSpec = await prisma.inspectionSpec.findFirst({ where: { tenantId: TENANT_ID, routingOperationId: nrv.operations[6].id, status: 'ACTIVE' }, include: { inspectionItems: true } });
  check(!!finalSpec && finalSpec.inspectionItems.length === 3, 'NRV 마지막 공정(최종검사)에 ACTIVE 검사기준(3항목) → 출하 품질 게이트 대상');
  const eqMaps = await prisma.equipmentOperationMap.findMany({ where: { equipment: { tenantId: TENANT_ID } }, include: { equipment: true, routingOperation: { include: { routing: true, workCenter: true } } } });
  check(eqMaps.every((m) => m.routingOperation.workCenter.code === 'WC-MACH'), `설비 매핑 ${eqMaps.length}건 모두 가공(WC-MACH) 공정`);
  const pre = ['CNC-1:MAN-RT-PIPE#2', 'CNC-1:MAN-RT-PIPE#3', 'CNC-1:MAN-RT-CAP#2', 'CNC-8:MAN-RT-PIPE#4', 'CNC-8:MAN-RT-CAP#3', 'CNC-9:MAN-RT-PIPE#5', 'CNC-9:MAN-RT-CAP#4', 'MCT-6:MAN-RT-NRV-BODY#2', 'MCT-6:MAN-RT-NRV-BODY#3', 'MCT-6:MAN-RT-NRV#1'];
  const have = new Set(eqMaps.map((m) => `${m.equipment.code}:${m.routingOperation.routing.code}#${m.routingOperation.seq}`));
  check(pre.every((k) => have.has(k)), '기존 설비-공정 매핑 10건 모두 보존');
  const cap5 = await prisma.routingOperation.findFirst({ where: { routing: { code: 'MAN-RT-CAP', tenantId: TENANT_ID }, seq: 5 }, include: { workCenter: true } });
  check(cap5?.workCenter.code === 'WC-COAT', 'CAP 분체도장 → WC-COAT');
  for (const r of NEW_ROUTINGS) {
    const row = await prisma.routing.findUnique({ where: { tenantId_code: { tenantId: TENANT_ID, code: r.code } }, include: { operations: true, items: { include: { item: true } } } });
    check(!!row && row.operations.length === r.ops.length && row.items[0]?.item.code === r.item, `반제품 라우팅 ${r.code} (${row?.operations.length}공정 → ${r.item})`);
  }
  return ok;
}

async function main() {
  console.log(`▶ 매뉴얼 기준정보 보완 v2 ${VERIFY_ONLY ? '(검증만)' : '(적용)'} — ${EXPECT.host}:${EXPECT.port}/${EXPECT.db}, tenant=${TENANT_ID}`);
  if (!VERIFY_ONLY) {
    await prisma.$transaction(apply, { timeout: 120_000, maxWait: 10_000 });
    for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(24)} 신규 ${v.created}  갱신 ${v.updated}`);
    console.log('\n  === 검증 ===');
  }
  if (!(await verify())) { process.exitCode = 1; console.error('✗ 검증 실패'); } else console.log('\n✅ 완료');
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
