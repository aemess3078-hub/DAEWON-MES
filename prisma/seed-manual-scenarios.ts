/**
 * 대원정밀 MES 매뉴얼용 업무 시나리오 seed (로컬 매뉴얼 DB 전용)
 *
 * 앱의 실제 서버 액션(수주/생산의뢰/MRP/구매발주/자재입고/작업지시/자재출고/POP/품질검사/완제품입고/출하/외주)을
 * 로컬 관리자 세션(JWT)으로 그대로 호출한다. 재고·WIP·LOT·상태를 Prisma INSERT 로 직접 만들지 않는다.
 * (기준정보 seed-manual-master.ts / seed-manual-master-v2.ts 가 먼저 적용되어 있어야 한다.)
 *
 * 시나리오 식별: 업무 문서의 비고(note)에 [MAN-S01] … [MAN-S06] 태그. 업무번호(SO-/PO-/WO-…)는 시스템 채번 규칙을 따른다.
 *   S01 NON-RETURN VALVE 전체 생산·출하 완료 (+ 공통 원자재 구매·입고)   S02 PIPE 생산 진행 중
 *   S03 PROTECTIVE CAP 외주(분체도장) 진행 중                            S04 NON-RETURN VALVE 불량·재작업
 *   S05 PIPE 신규 수주·작업대기                                         S06 원자재 부족·MRP·구매발주(일부 입고)
 *
 * 실행:
 *   npx ts-node --compiler-options "{\"module\":\"commonjs\",\"target\":\"es2020\"}" --project tsconfig.json prisma/seed-manual-scenarios.ts [--only S01,S02] [--verify]
 *   (--only 는 선행 시나리오가 있어야 한다: S02~S06 은 S01 의 원자재 구매·입고, S04 는 S01 의 반제품 재고에 의존)
 *
 * 멱등: 각 단계가 DB 상태(태그/연결/요청ID/공정상태)를 확인하고 이미 된 것은 건너뛴다. 외부 발송/프린터/설비통신 없음.
 * 실패 시 부분 진행 상태가 남을 수 있다 → 같은 명령을 다시 실행하면 이어서 진행하고, 필요하면 백업(backup/*.dump)으로 복원한다.
 */
import Module from 'node:module';
import { join } from 'node:path';
import { assertLocalTarget, EXPECT } from './manual-seed-guard';

const TENANT_ID = assertLocalTarget();
const args = process.argv.slice(2);
const VERIFY_ONLY = args.includes('--verify');
const onlyArg = args.find((a) => a.startsWith('--only'));
const ONLY = onlyArg ? (onlyArg.includes('=') ? onlyArg.split('=')[1] : args[args.indexOf(onlyArg) + 1]).split(',').map((s) => s.trim().toUpperCase()) : null;
const want = (s: string) => !ONLY || ONLY.includes(s);

// ─── Next 런타임 대체 (next/headers 쿠키, next/cache) + '@/' 별칭 ───────────────
process.env.PRISMA_CONNECTION_LIMIT ??= '4';
process.env.PRISMA_POOL_TIMEOUT ??= '30';
const M = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const origResolve = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  return origResolve.call(this, request.startsWith('@/') ? join(process.cwd(), 'src', request.slice(2)) : request, ...rest);
};
const jar = new Map<string, string>();
function inject(modulePath: string, exports: Record<string, unknown>) {
  const filename = require.resolve(modulePath);
  const mod = new Module(filename);
  mod.filename = filename;
  mod.loaded = true;
  mod.exports = exports;
  require.cache[filename] = mod;
}
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  getAll: () => Array.from(jar).map(([name, value]) => ({ name, value })),
  has: (name: string) => jar.has(name),
  set: (name: string | { name: string; value: string }, value?: string) => { if (typeof name === 'object') jar.set(name.name, name.value); else jar.set(name, value ?? ''); },
  delete: (name: string) => void jar.delete(name),
};
inject('next/headers', { cookies: async () => cookieStore, headers: async () => new Map<string, string>([['x-forwarded-for', '127.0.0.1'], ['user-agent', 'manual-scenario-seed']]) });
inject('next/cache', { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: <T>(fn: T) => fn });

/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma } = require('../src/lib/db/prisma') as typeof import('../src/lib/db/prisma');
const jwtLib = require('../src/lib/jwt') as typeof import('../src/lib/jwt');
const act = {
  so: () => require('../src/lib/actions/sales-order.actions') as typeof import('../src/lib/actions/sales-order.actions'),
  plan: () => require('../src/lib/actions/production-plan.actions') as typeof import('../src/lib/actions/production-plan.actions'),
  po: () => require('../src/lib/actions/purchase-order.actions') as typeof import('../src/lib/actions/purchase-order.actions'),
  rcv: () => require('../src/lib/actions/receiving.actions') as typeof import('../src/lib/actions/receiving.actions'),
  wo: () => require('../src/lib/actions/work-order.actions') as typeof import('../src/lib/actions/work-order.actions'),
  issue: () => require('../src/lib/actions/material-issue.actions') as typeof import('../src/lib/actions/material-issue.actions'),
  pop: () => require('../src/lib/actions/pop.actions') as typeof import('../src/lib/actions/pop.actions'),
  stage: () => require('../src/lib/actions/inspection-stages.actions') as typeof import('../src/lib/actions/inspection-stages.actions'),
  fg: () => require('../src/lib/actions/finished-goods.actions') as typeof import('../src/lib/actions/finished-goods.actions'),
  ship: () => require('../src/lib/actions/shipment.actions') as typeof import('../src/lib/actions/shipment.actions'),
  out: () => require('../src/lib/actions/outsourcing.actions') as typeof import('../src/lib/actions/outsourcing.actions'),
  mrpRun: () => require('../src/lib/actions/mrp-run.actions') as typeof import('../src/lib/actions/mrp-run.actions'),
  mrpSug: () => require('../src/lib/actions/mrp-purchase-suggestion.actions') as typeof import('../src/lib/actions/mrp-purchase-suggestion.actions'),
};

// ─── 공통 ────────────────────────────────────────────────────────────────────

const SITE_ID = 'site-daewon-factory-001';
const WH = { RAW: 'wh-daewon-raw-001', WIP: 'wh-daewon-wip-001', FG: 'wh-daewon-fg-001' } as const;
const d = (iso: string) => new Date(`${iso}T09:00:00+09:00`);
const today = () => new Date();
const plusDays = (n: number) => new Date(Date.now() + n * 86400000);
const iso = (dt: Date) => dt.toISOString().slice(0, 10);
const num = (v: unknown) => Number(v ?? 0);
const logLine = (m: string) => console.log(`    ${m}`);
const fail = (m: string): never => { throw new Error(m); };

type Ctx = {
  item: Map<string, string>; itemById: Map<string, { code: string; name: string; uom: string; isLotTracked: boolean }>;
  partner: Map<string, string>; defect: Map<string, string>;
  admin: { profileId: string };
};
let ctx!: Ctx;

async function init() {
  const admin = await prisma.userCredential.findFirst({ where: { tenantId: TENANT_ID, profile: { tenantUsers: { some: { tenantId: TENANT_ID, role: 'OWNER', isActive: true } } }, NOT: { loginId: 'test' } }, include: { profile: true } });
  if (!admin) fail('로컬 관리자(OWNER) 계정을 찾을 수 없습니다.');
  const a = admin!;
  jar.set(jwtLib.NMES_SESSION_COOKIE, jwtLib.signAuthToken({ profileId: a.profileId, tenantId: TENANT_ID, loginId: a.loginId, email: a.profile.email, name: a.profile.name, role: 'OWNER', mustChangePw: false }));
  const items = await prisma.item.findMany({ where: { tenantId: TENANT_ID, code: { startsWith: 'MAN-' } } });
  const partners = await prisma.businessPartner.findMany({ where: { tenantId: TENANT_ID, code: { startsWith: 'MAN-' } } });
  const defects = await prisma.defectCode.findMany({ where: { tenantId: TENANT_ID } });
  if (items.length < 11 || partners.length < 8) fail('기준정보 seed(seed-manual-master.ts, -v2)가 먼저 적용되어야 합니다.');
  if (!(await prisma.workCenter.findFirst({ where: { siteId: SITE_ID, code: 'WC-COAT' } }))) fail('seed-manual-master-v2.ts 가 먼저 적용되어야 합니다.');
  ctx = {
    item: new Map(items.map((i) => [i.code, i.id])),
    itemById: new Map(items.map((i) => [i.id, { code: i.code, name: i.name, uom: i.uom, isLotTracked: i.isLotTracked }])),
    partner: new Map(partners.map((p) => [p.code, p.id])),
    defect: new Map(defects.map((x) => [x.code, x.id])),
    admin: { profileId: a.profileId },
  };
}
const itemId = (code: string) => ctx.item.get(code) ?? fail(`품목 없음: ${code}`);
const partnerId = (code: string) => ctx.partner.get(code) ?? fail(`거래처 없음: ${code}`);

// ─── 문서 헬퍼 (모두 note 태그 기반으로 중복 방지) ──────────────────────────────

async function ensureSalesOrder(tag: string, customer: string, deliveryIso: string, lines: Array<{ item: string; qty: number; price: number }>) {
  const found = await prisma.salesOrder.findFirst({ where: { tenantId: TENANT_ID, note: { contains: `[${tag}]` } }, include: { items: true } });
  if (found) return found;
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  await act.so().createSalesOrder(TENANT_ID, SITE_ID, {
    customerId: partnerId(customer), orderDate: today(), deliveryDate: d(deliveryIso), totalAmount: total, currency: 'KRW',
    note: `[${tag}] 매뉴얼 시나리오 수주`,
    items: lines.map((l) => ({ itemId: itemId(l.item), qty: l.qty, unitPrice: l.price, deliveryDate: d(deliveryIso) })),
  });
  return prisma.salesOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: `[${tag}]` } }, include: { items: true } });
}

async function ensureProductionRequest(tag: string, so: { id: string; items: Array<{ id: string; itemId: string; qty: unknown }> }) {
  const existing = await prisma.productionPlanItem.findFirst({ where: { salesOrderItemId: { in: so.items.map((i) => i.id) }, plan: { tenantId: TENANT_ID, status: { not: 'CANCELLED' } } }, include: { plan: true } });
  if (existing) return existing;
  const res = await act.so().requestProductionFromSalesOrder(so.id, so.items.map((i) => ({ salesOrderItemId: i.id, itemId: i.itemId, qty: num(i.qty) })), TENANT_ID, SITE_ID, `man-${tag.toLowerCase()}-prod-request-0001`);
  if (!res.ok) fail(`생산의뢰 실패(${tag}): ${res.error}`);
  return prisma.productionPlanItem.findFirstOrThrow({ where: { salesOrderItemId: { in: so.items.map((i) => i.id) }, plan: { tenantId: TENANT_ID } }, include: { plan: true } });
}

async function ensureStockPlan(tag: string, planType: 'DAILY' | 'WEEKLY' | 'MONTHLY', lines: Array<{ item: string; qty: number }>) {
  const found = await prisma.productionPlan.findFirst({ where: { tenantId: TENANT_ID, note: { contains: `[${tag}]` } }, include: { items: true } });
  if (found) return found;
  await act.plan().createPlan({
    siteId: SITE_ID, planNo: 'AUTO', planType, startDate: iso(today()), endDate: iso(plusDays(7)), note: `[${tag}] 매뉴얼 시나리오 재고생산계획`,
    items: lines.map((l) => ({ itemId: itemId(l.item), plannedQty: l.qty })),
  }, TENANT_ID);
  return prisma.productionPlan.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: `[${tag}]` } }, include: { items: true } });
}

/** 계획 품목에 연결된 작업지시를 보장한다(없으면 라우팅 전 공정으로 등록 후 릴리즈). 설비가 매핑된 공정은 첫 매핑 설비에 전량 배정. */
async function ensureWorkOrder(planItemId: string, itemCode: string, routingCode: string, qty: number, dueIso: string) {
  const found = await prisma.workOrder.findFirst({ where: { tenantId: TENANT_ID, productionPlanItemId: planItemId, status: { not: 'CANCELLED' } } });
  const bom = await prisma.bOM.findFirstOrThrow({ where: { tenantId: TENANT_ID, itemId: itemId(itemCode), status: 'ACTIVE', isDefault: true } });
  const routing = await prisma.routing.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: routingCode }, include: { operations: { orderBy: { seq: 'asc' }, include: { equipmentMaps: { orderBy: { id: 'asc' } } } } } });
  let wo = found;
  if (!wo) {
    const res = await act.wo().createWorkOrder({
      siteId: SITE_ID, itemId: itemId(itemCode), bomId: bom.id, routingId: routing.id, orderNo: 'AUTO', manufacturingNo: null, plannedQty: qty, status: 'DRAFT', dueDate: dueIso, productionPlanItemId: planItemId,
      operations: routing.operations.map((o) => {
        const eq = o.equipmentMaps[0]?.equipmentId;
        return { routingOperationId: o.id, seq: o.seq, plannedQty: qty, equipmentId: eq ?? null, assignments: eq ? [{ equipmentId: eq, assignedQty: qty }] : [] };
      }),
    }, TENANT_ID);
    if (!res.success) fail(`작업지시 생성 실패(${itemCode}): ${(res as { error?: string }).error}`);
    wo = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, productionPlanItemId: planItemId, status: { not: 'CANCELLED' } } });
  }
  if (wo.status === 'DRAFT') {
    const r = await act.wo().releaseWorkOrder(wo.id);
    if (!r.success) fail(`작업지시 릴리즈 실패: ${r.error}`);
    wo = await prisma.workOrder.findFirstOrThrow({ where: { id: wo.id } });
  }
  return wo;
}

/**
 * BOM × 수량으로 필요량을 계산한다. 앱(bom-material-sufficiency.ts)과 같은 규칙: 단위소요 = round6(qtyPer × (1+손실률)), 필요량 = round6(계획수량 × 단위소요).
 * 앱의 생산가능수량 계산은 floor(출고량 ÷ 단위소요) 이며 부동소수점 오차로 정확히 필요량만 출고하면 1칸(0.000001) 모자라게 계산되는 경우가 있다
 * (예: 77.25 ÷ 2.575 = 29.999999…). 이 경우 출고량을 6자리 단위로 최소한만 올려 전량 실적이 등록되게 한다. — 앱 결함 보고 대상, 앱 코드는 수정하지 않는다.
 */
async function bomRequirement(parentCode: string, qty: number) {
  const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
  const bom = await prisma.bOM.findFirstOrThrow({ where: { tenantId: TENANT_ID, itemId: itemId(parentCode), status: 'ACTIVE', isDefault: true }, include: { bomItems: { orderBy: { seq: 'asc' } } } });
  return bom.bomItems.map((b) => {
    const per = r6(num(b.qtyPer) * (1 + num(b.scrapRate)));
    let need = r6(qty * per);
    const producible = (issued: number) => Math.floor((issued / per + Number.EPSILON) * 1e6) / 1e6;
    let bumped = 0;
    while (producible(need) < qty && bumped < 5) { need = r6(need + 0.000001); bumped++; }
    return { itemId: b.componentItemId, qty: need, bumped };
  });
}

/** 자재출고: BOM 필요량 전량을 FIFO LOT 로 출고(요청ID 로 재실행 방어). */
async function ensureIssue(woId: string, parentCode: string, qty: number, requestKey: string, whOf: (code: string) => string) {
  const issuedAlready = await prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID, refType: 'WORK_ORDER', refId: woId, txType: 'ISSUE' } });
  if (issuedAlready > 0) return;
  const reqs = await bomRequirement(parentCode, qty);
  const items = [];
  for (const r of reqs) {
    const meta = ctx.itemById.get(r.itemId)!;
    const wh = whOf(meta.code);
    const balances = await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID, itemId: r.itemId, warehouseId: wh, qtyAvailable: { gt: 0 } }, orderBy: { updatedAt: 'asc' } });
    let remain = r.qty;
    const lots: Array<{ lotId: string; warehouseId: string; quantity: number }> = [];
    if (meta.isLotTracked) {
      for (const b of balances) {
        if (!b.lotId || remain <= 0) continue;
        const take = Math.min(remain, num(b.qtyAvailable));
        lots.push({ lotId: b.lotId, warehouseId: wh, quantity: Math.round(take * 1e6) / 1e6 });
        remain = Math.round((remain - take) * 1e6) / 1e6;
      }
      if (remain > 0) fail(`재고 부족: ${meta.code} 필요 ${r.qty}, 부족 ${remain}`);
      items.push({ itemId: r.itemId, warehouseId: wh, lots, issueQty: r.qty, requiredQty: r.qty, reservationId: null });
    } else {
      const avail = balances.reduce((s, b) => s + num(b.qtyAvailable), 0);
      if (avail < r.qty) fail(`재고 부족: ${meta.code} 필요 ${r.qty}, 가용 ${avail}`);
      items.push({ itemId: r.itemId, warehouseId: wh, issueQty: r.qty, requiredQty: r.qty, reservationId: null });
    }
  }
  const res = await act.issue().issueMaterialsForWorkOrder({ workOrderId: woId, siteId: SITE_ID, requestId: requestKey, items }, TENANT_ID);
  if (!res.ok) fail(`자재출고 실패(${requestKey}): ${res.error}`);
}

/** 공정 실적 등록(양품 중심). 이미 목표 수량 이상 완료되었으면 건너뛴다. 설비 배정이 있으면 배정 단위로 등록. */
async function runOperation(woId: string, seq: number, good: number, extra: { defect?: number; rework?: number; defectCode?: string } = {}) {
  const op = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: woId, seq }, include: { assignments: { orderBy: { seq: 'asc' } } } });
  if (op.status === 'COMPLETED') return;
  if (op.status === 'PENDING') {
    const s = await act.pop().startOperation(op.id, op.assignments[0]?.id ?? null);
    if (!s.success) fail(`공정 시작 실패(seq ${seq}): ${s.error}`);
  }
  const details = extra.defect ? [{ defectCodeId: ctx.defect.get(extra.defectCode ?? 'DIM-001')!, qty: extra.defect }] : [];
  const r = await act.pop().submitProductionResult({
    workOrderOperationId: op.id, assignmentId: op.assignments[0]?.id ?? null,
    goodQty: good, defectQty: extra.defect ?? 0, reworkQty: extra.rework ?? 0, defectDetails: details as never,
  });
  if (!r.success) fail(`생산실적 실패(seq ${seq}): ${r.error}`);
}

async function ensureFinalInspection(woId: string, seq: number, qty: number, lotId?: string | null) {
  const op = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: woId, seq }, include: { workOrder: true } });
  const spec = await prisma.inspectionSpec.findFirstOrThrow({ where: { tenantId: TENANT_ID, itemId: op.workOrder.itemId, routingOperationId: op.routingOperationId, status: 'ACTIVE' } });
  const done = await prisma.qualityInspection.count({ where: { workOrderOperationId: op.id, stage: 'FINAL', result: 'PASS' } });
  if (done > 0) return;
  await act.stage().createStagedInspection({ workOrderOperationId: op.id, inspectionSpecId: spec.id, stage: 'FINAL', result: 'PASS', inspectedQty: qty, lotId: lotId ?? null });
}

/** 단계별 검사(초물/중간) 등록. 대원정밀 허용 화면(inspection-stages) 경로의 액션을 쓴다. 이미 있으면 건너뜀. */
async function ensureStagedInspection(woId: string, seq: number, qty: number, stage: 'FIRST' | 'MID') {
  const op = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: woId, seq }, include: { workOrder: true } });
  const spec = await prisma.inspectionSpec.findFirstOrThrow({ where: { tenantId: TENANT_ID, itemId: op.workOrder.itemId, routingOperationId: op.routingOperationId, status: 'ACTIVE' } });
  if ((await prisma.qualityInspection.count({ where: { workOrderOperationId: op.id, inspectionSpecId: spec.id, stage } })) > 0) return;
  await act.stage().createStagedInspection({ workOrderOperationId: op.id, inspectionSpecId: spec.id, stage, result: 'PASS', inspectedQty: qty, lotId: null });
}

async function ensureFgReceipt(woId: string, itemCode: string, warehouseId: string, qty: number) {
  const done = await prisma.finishedGoodsReceipt.aggregate({ where: { tenantId: TENANT_ID, workOrderId: woId }, _sum: { receiptQty: true } });
  if (num(done._sum.receiptQty) >= qty - 1e-9) return;
  const r = await act.fg().createFinishedGoodsReceiptAction({ workOrderId: woId, itemId: itemId(itemCode), siteId: SITE_ID, warehouseId, receiptQty: qty - num(done._sum.receiptQty) }, TENANT_ID);
  if (!r.ok) fail(`완제품/반제품 입고 실패(${itemCode}): ${r.error}`);
}

/** 구매발주 + 전량(또는 지정수량) 입고. */
async function ensurePurchase(tag: string, supplier: string, lines: Array<{ item: string; qty: number; price: number }>, receive: Array<number | 'ALL' | 0>, expectedDays = 7) {
  let po = await prisma.purchaseOrder.findFirst({ where: { tenantId: TENANT_ID, supplierId: partnerId(supplier), note: { contains: `[${tag}]` } }, include: { items: true } });
  if (!po) {
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const res = await act.po().createPurchaseOrder(TENANT_ID, SITE_ID, {
      supplierId: partnerId(supplier), orderDate: today(), expectedDate: plusDays(expectedDays), status: 'ORDERED', totalAmount: total, currency: 'KRW',
      note: `[${tag}] 매뉴얼 시나리오 구매발주`, items: lines.map((l) => ({ itemId: itemId(l.item), qty: l.qty, unitPrice: l.price })),
    });
    if (!res.success) fail(`구매발주 실패(${tag}): ${(res as { error?: string }).error}`);
    po = await prisma.purchaseOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, supplierId: partnerId(supplier), note: { contains: `[${tag}]` } }, include: { items: true } });
  }
  for (const [i, line] of lines.entries()) {
    const want = receive[i] === 'ALL' ? line.qty : num(receive[i]);
    if (!(want > 0)) continue;
    const poItem = po.items.find((x) => x.itemId === itemId(line.item))!;
    const fresh = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: poItem.id } });
    const remain = want - num(fresh.receivedQty);
    if (remain <= 1e-9) continue;
    const r = await act.rcv().createReceivingInspection({
      purchaseOrderItemId: poItem.id, purchaseOrderId: po.id, warehouseId: WH.RAW, siteId: SITE_ID, inspectorId: ctx.admin.profileId,
      receivedQty: remain, acceptedQty: remain, rejectedQty: 0, result: 'PASS', note: `[${tag}] 입고검사 합격`,
      requestId: `man-${tag.toLowerCase()}-rcv-${line.item.toLowerCase().replace(/[^a-z0-9]/g, '')}-${Math.round(want)}`.padEnd(16, '0'),
    });
    if (!r.success) fail(`입고 실패(${tag}/${line.item}): ${r.message}`);
  }
  return prisma.purchaseOrder.findFirstOrThrow({ where: { id: po.id }, include: { items: true } });
}

const whOfItem = (code: string) => (code.startsWith('MAN-SF-') || code.startsWith('MAN-FG-') ? WH.WIP : WH.RAW);

// ─── 시나리오 ────────────────────────────────────────────────────────────────

async function s01() {
  console.log('\n  [S01] NON-RETURN VALVE 전체 생산·출하 완료');
  const TAG = 'MAN-S01';
  // 1) 수주 → 생산의뢰(계획)
  const so = await ensureSalesOrder(TAG, 'MAN-C01', iso(plusDays(19)), [{ item: 'MAN-FG-NRV01', qty: 20, price: 45000 }]);
  logLine(`수주 ${so.orderNo}`);
  const nrvPlanItem = await ensureProductionRequest(TAG, so);
  logLine(`생산계획 ${nrvPlanItem.plan.planNo}`);
  const sfPlan = await ensureStockPlan(`${TAG}-SF`, 'WEEKLY', [{ item: 'MAN-SF-NRV-BODY', qty: 32 }, { item: 'MAN-SF-NRV-DISC', qty: 32 }]);
  logLine(`반제품 재고생산계획 ${sfPlan.planNo} (S04 용 여유 포함 — 32: 앱 부동소수점 오차 회피 수량)`);
  // 2) MRP 실행이력 저장(구매 전 시점의 부족 현황)
  const mrp = await prisma.mrpRun.findFirst({ where: { tenantId: TENANT_ID } });
  if (!mrp) {
    const res = await act.mrpRun().saveOrderMrpRun({ from: iso(plusDays(10)), to: iso(plusDays(25)), includeDraft: false, requestKey: 'man-s01-mrp-run-0001' });
    logLine(`MRP 실행이력 저장: ${res.success ? 'OK' : (res as { error?: string }).error}`);
  }
  // 3) 공통 원자재 구매·입고 (S01~S06 이 사용)
  const poA = await ensurePurchase(TAG, 'MAN-S01', [{ item: 'MAN-RM-NRV-BAR', qty: 100, price: 1100 }, { item: 'MAN-RM-PIPE-STK', qty: 80, price: 4500 }], ['ALL', 'ALL']);
  const poB = await ensurePurchase(TAG, 'MAN-S02', [{ item: 'MAN-RM-PLATE', qty: 100, price: 1200 }, { item: 'MAN-CS-POWDER', qty: 20, price: 8500 }], ['ALL', 'ALL']);
  const poC = await ensurePurchase(TAG, 'MAN-S03', [{ item: 'MAN-CS-BOX', qty: 100, price: 700 }], ['ALL']);
  logLine(`구매발주 ${[poA, poB, poC].map((p) => `${p.orderNo}(${p.status})`).join(', ')}`);
  // 4) 반제품 2종 생산 → 입고
  for (const [code, rt] of [['MAN-SF-NRV-BODY', 'MAN-RT-NRV-BODY'], ['MAN-SF-NRV-DISC', 'MAN-RT-NRV-DISC']] as const) {
    const pi = sfPlan.items.find((i) => i.itemId === itemId(code))!;
    const wo = await ensureWorkOrder(pi.id, code, rt, 32, iso(plusDays(5)));
    await ensureIssue(wo.id, code, 32, `man-s01-issue-${code.toLowerCase().replace(/[^a-z]/g, '')}`, whOfItem);
    const ops = await prisma.workOrderOperation.findMany({ where: { workOrderId: wo.id }, orderBy: { seq: 'asc' } });
    for (const op of ops) {
      await runOperation(wo.id, op.seq, 32);
      if (code === 'MAN-SF-NRV-BODY' && op.seq === 4) await ensureFinalInspection(wo.id, 4, 32);
    }
    await ensureFgReceipt(wo.id, code, WH.WIP, 32);
    logLine(`반제품 작업지시 ${wo.orderNo} (${code}) → 입고 32`);
  }
  // 5) 완제품 작업지시 → 출고 → 7공정 → 최종검사 → 입고
  const wo = await ensureWorkOrder(nrvPlanItem.id, 'MAN-FG-NRV01', 'MAN-RT-NRV', 20, iso(plusDays(10)));
  await ensureIssue(wo.id, 'MAN-FG-NRV01', 20, 'man-s01-issue-nrv-fg-0001', whOfItem);
  for (let seq = 1; seq <= 7; seq++) {
    await runOperation(wo.id, seq, 20);
    if (seq === 7) await ensureFinalInspection(wo.id, 7, 20);
  }
  await ensureFgReceipt(wo.id, 'MAN-FG-NRV01', WH.FG, 20);
  logLine(`완제품 작업지시 ${wo.orderNo} (제조번호 ${wo.manufacturingNo}) → 완제품 입고 20`);
  // 6) 출하
  const shipTag = `[${TAG}] 출하`;
  let ship = await prisma.shipmentOrder.findFirst({ where: { tenantId: TENANT_ID, note: { contains: shipTag } } });
  if (!ship) {
    const lot = await prisma.finishedGoodsReceipt.findFirstOrThrow({ where: { tenantId: TENANT_ID, workOrderId: wo.id }, orderBy: { receiptAt: 'desc' } });
    if (!lot.lotId) fail('완제품 LOT 가 없습니다.');
    const soi = so.items[0];
    await act.ship().createShipment(TENANT_ID, { salesOrderId: so.id, plannedDate: today(), warehouseId: WH.FG, note: shipTag, items: [{ salesOrderItemId: soi.id, itemId: itemId('MAN-FG-NRV01'), qty: 20, lotId: lot.lotId! }] });
    ship = await prisma.shipmentOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: shipTag } } });
  }
  if (ship.status === 'PLANNED') await act.ship().confirmShipment(ship.id);
  ship = await prisma.shipmentOrder.findFirstOrThrow({ where: { id: ship.id } });
  logLine(`출하 ${ship.shipmentNo ?? ship.id} (${ship.status})`);
}

async function s02() {
  console.log('\n  [S02] PIPE 생산 진행 중');
  const TAG = 'MAN-S02';
  const plan = await ensureStockPlan(TAG, 'DAILY', [{ item: 'MAN-FG-PIPE01', qty: 50 }]);
  logLine(`생산계획 ${plan.planNo}`);
  const wo = await ensureWorkOrder(plan.items[0].id, 'MAN-FG-PIPE01', 'MAN-RT-PIPE', 50, iso(plusDays(3)));
  await ensureIssue(wo.id, 'MAN-FG-PIPE01', 50, 'man-s02-issue-pipe-0001', whOfItem);
  await runOperation(wo.id, 1, 50); // 원자재 검사 완료
  // 2공정(PIPE 절단): 시작 + 부분 실적(20/50) → 진행 중
  const op2 = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: wo.id, seq: 2 }, include: { assignments: true } });
  if (num(op2.completedQty) < 20) {
    if (op2.status === 'PENDING') { const s = await act.pop().startOperation(op2.id, op2.assignments[0]?.id ?? null); if (!s.success) fail(`공정 시작 실패: ${s.error}`); }
    const r = await act.pop().submitProductionResult({ workOrderOperationId: op2.id, assignmentId: op2.assignments[0]?.id ?? null, goodQty: 20, defectQty: 0, reworkQty: 0 });
    if (!r.success) fail(`부분 실적 실패: ${r.error}`);
  }
  logLine(`작업지시 ${wo.orderNo} (제조번호 ${wo.manufacturingNo}): 1공정 완료 · 2공정 진행(20/50) · 3~8 대기`);
}

async function s03() {
  console.log('\n  [S03] PROTECTIVE CAP 외주(분체도장) 진행 중');
  const TAG = 'MAN-S03';
  const plan = await ensureStockPlan(TAG, 'DAILY', [{ item: 'MAN-SF-CAP-DISC', qty: 110 }, { item: 'MAN-FG-CAP01', qty: 100 }]);
  logLine(`생산계획 ${plan.planNo}`);
  const sfItem = plan.items.find((i) => i.itemId === itemId('MAN-SF-CAP-DISC'))!;
  const fgItem = plan.items.find((i) => i.itemId === itemId('MAN-FG-CAP01'))!;
  const woSf = await ensureWorkOrder(sfItem.id, 'MAN-SF-CAP-DISC', 'MAN-RT-CAP-DISC', 110, iso(plusDays(3)));
  await ensureIssue(woSf.id, 'MAN-SF-CAP-DISC', 110, 'man-s03-issue-capdisc-0001', whOfItem);
  for (let seq = 1; seq <= 3; seq++) await runOperation(woSf.id, seq, 110);
  await ensureFgReceipt(woSf.id, 'MAN-SF-CAP-DISC', WH.WIP, 110);
  logLine(`반제품 작업지시 ${woSf.orderNo} → 원판 입고 110 (CAP 100 + 손실분)`);
  const wo = await ensureWorkOrder(fgItem.id, 'MAN-FG-CAP01', 'MAN-RT-CAP', 100, iso(plusDays(7)));
  await ensureIssue(wo.id, 'MAN-FG-CAP01', 100, 'man-s03-issue-cap-fg-0001', whOfItem);
  for (let seq = 1; seq <= 4; seq++) {
    if (seq === 1) await ensureStagedInspection(wo.id, 1, 100, 'FIRST');
    await runOperation(wo.id, seq, 100);
  }
  // 외주발주 + 외주출고
  let order = await prisma.purchaseOrder.findFirst({ where: { tenantId: TENANT_ID, note: { contains: `[${TAG}]` }, supplierId: partnerId('MAN-O02') } });
  if (!order) {
    await act.out().createOutsourcingOrder({ supplierId: partnerId('MAN-O02'), outsourcingProcessName: '분체도장', expectedDate: iso(plusDays(5)), note: `[${TAG}] CAP 분체도장 외주` });
    order = await prisma.purchaseOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: `[${TAG}]` }, supplierId: partnerId('MAN-O02') } });
  }
  const wip = await prisma.wipUnit.findFirstOrThrow({ where: { tenantId: TENANT_ID, workOrderId: wo.id, parentWipUnitId: null }, orderBy: { createdAt: 'asc' } });
  if (wip.status !== 'OUTSOURCED') {
    await act.out().issueWipUnitToOutsourcing({ wipUnitId: wip.id, outsourcingOrderId: order.id });
  }
  logLine(`작업지시 ${wo.orderNo} (제조번호 ${wo.manufacturingNo}) / 외주발주 ${order.orderNo} → 분체도장 외주출고 100 (입고 전)`);
}

async function s04() {
  console.log('\n  [S04] NON-RETURN VALVE 불량 및 재작업');
  const TAG = 'MAN-S04';
  const plan = await ensureStockPlan(TAG, 'DAILY', [{ item: 'MAN-FG-NRV01', qty: 10 }]);
  logLine(`생산계획 ${plan.planNo}`);
  const wo = await ensureWorkOrder(plan.items[0].id, 'MAN-FG-NRV01', 'MAN-RT-NRV', 10, iso(plusDays(4)));
  await ensureIssue(wo.id, 'MAN-FG-NRV01', 10, 'man-s04-issue-nrv-0001', whOfItem);
  // 1공정(조립부 가공): 양품 7 / 불량 1 / 재작업 2
  await runOperation(wo.id, 1, 7, { defect: 1, rework: 2, defectCode: 'DIM-001' });
  logLine(`작업지시 ${wo.orderNo} (제조번호 ${wo.manufacturingNo}): 1공정 양품 7 · 불량 1(DIM-001) · 재작업 2`);
}

async function s05() {
  console.log('\n  [S05] PIPE 신규 수주 및 작업대기');
  const TAG = 'MAN-S05';
  const so = await ensureSalesOrder(TAG, 'MAN-C02', iso(plusDays(24)), [{ item: 'MAN-FG-PIPE01', qty: 200, price: 6500 }]);
  logLine(`수주 ${so.orderNo}`);
  const pi = await ensureProductionRequest(TAG, so);
  logLine(`생산계획 ${pi.plan.planNo}`);
  const wo = await ensureWorkOrder(pi.id, 'MAN-FG-PIPE01', 'MAN-RT-PIPE', 200, iso(plusDays(20)));
  logLine(`작업지시 ${wo.orderNo} (제조번호 ${wo.manufacturingNo}) — 작업대기(자재출고·실적 없음)`);
}

async function s06() {
  console.log('\n  [S06] 원자재 재고 부족 및 구매');
  const TAG = 'MAN-S06';
  const deliveryIso = iso(plusDays(39));
  const so = await ensureSalesOrder(TAG, 'MAN-C01', deliveryIso, [{ item: 'MAN-FG-NRV01', qty: 80, price: 45000 }]);
  logLine(`수주 ${so.orderNo} (납기 ${deliveryIso})`);
  const pi = await ensureProductionRequest(TAG, so);
  logLine(`생산계획 ${pi.plan.planNo}`);
  // MRP: S06 납기 구간만 계산(다른 시나리오 수요와 분리). 실행이력은 구매 전 시점으로 한 번만 저장.
  const win = { from: iso(plusDays(30)), to: iso(plusDays(50)), includeDraft: false } as const;
  const sug = (await act.mrpSug().getPurchaseSuggestions(win)) as unknown as { rows: Array<{ code: string; kind: string; qtyAvailable: number; totalRequirement: number; finalShortageQty: number; suggestedQty: number; recommendedSupplierId: string | null; suppliers: Array<{ supplierId: string; supplierCode: string; price: { unitPrice: number } | null }> }> };
  const buy = sug.rows.filter((r) => r.suggestedQty > 0 && r.recommendedSupplierId);
  logLine(`MRP 발주제안: ${buy.map((r) => `${r.code} 재고 ${r.qtyAvailable} / 소요 ${r.totalRequirement} / 부족 ${r.finalShortageQty} → 제안 ${r.suggestedQty} (${r.kind})`).join(' | ')}`);
  if (!(await prisma.mrpRun.findFirst({ where: { tenantId: TENANT_ID, fromDate: new Date(win.from) } }))) {
    const saved = await act.mrpRun().saveOrderMrpRun({ ...win, requestKey: 'man-s06-mrp-run-0001' });
    logLine(`MRP 실행이력 저장: ${saved.success ? 'OK' : (saved as { error?: string }).error}`);
  }
  // 구매발주: MRP 제안 수량 그대로(공급업체별 묶음). 봉강만 일부 입고, 나머지는 입고대기.
  const bySupplier = new Map<string, typeof buy>();
  for (const r of buy) { const sup = r.suppliers.find((x) => x.supplierId === r.recommendedSupplierId)!; bySupplier.set(sup.supplierCode, [...(bySupplier.get(sup.supplierCode) ?? []), r]); }
  for (const [supplier, rows] of bySupplier) {
    const lines = rows.map((r) => ({ item: r.code, qty: r.suggestedQty, price: r.suppliers.find((x) => x.supplierId === r.recommendedSupplierId)!.price?.unitPrice ?? 0 }));
    const receive = rows.map((r) => (r.code === 'MAN-RM-NRV-BAR' ? Math.round(r.suggestedQty / 2) : 0));
    const po = await ensurePurchase(TAG, supplier, lines, receive, 10);
    logLine(`구매발주 ${po.orderNo} (${supplier}, ${po.status}): ${po.items.map((i) => `${ctx.itemById.get(i.itemId)!.code} 발주 ${num(i.qty)} / 입고 ${num(i.receivedQty)}`).join(', ')}`);
  }
}

// ─── 정합성 검증 (읽기 전용) ─────────────────────────────────────────────────

async function verifyAll(): Promise<boolean> {
  let ok = true;
  const check = (c: boolean, m: string) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) ok = false; };
  const near = (a: number, b: number) => Math.abs(a - b) < 0.0005;
  const lotApi = require('../src/lib/actions/lot.actions') as typeof import('../src/lib/actions/lot.actions');
  const traceApi = require('../src/lib/actions/manufacturing-traceability.actions') as typeof import('../src/lib/actions/manufacturing-traceability.actions');
  const code = (id: string) => ctx.itemById.get(id)?.code ?? id;
  const wo = async (no: string) => prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, orderNo: no }, include: { item: true, operations: { orderBy: { seq: 'asc' }, include: { productionResults: true } }, wipUnits: true } });
  const woByTag = async (tag: string, itemCode: string) => {
    const plan = await prisma.productionPlan.findFirstOrThrow({ where: { tenantId: TENANT_ID, OR: [{ note: { contains: `[${tag}]` } }, { items: { some: { salesOrderItem: { salesOrder: { note: { contains: `[${tag}]` } } } } } }] }, include: { items: true } });
    return prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, productionPlanItemId: { in: plan.items.filter((i) => i.itemId === itemId(itemCode)).map((i) => i.id) }, status: { not: 'CANCELLED' } }, include: { item: true, operations: { orderBy: { seq: 'asc' }, include: { productionResults: true } }, wipUnits: true } });
  };

  console.log('\n  [1] 재고 수량 ↔ 재고 이동 이력');
  const balances = await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID, item: { code: { startsWith: 'MAN-' } } } });
  const txs = await prisma.inventoryTransaction.findMany({ where: { tenantId: TENANT_ID, item: { code: { startsWith: 'MAN-' } } } });
  const calc = new Map<string, number>();
  for (const t of txs) {
    if (t.toLocationId) calc.set(`${t.itemId}|${t.lotId ?? ''}|${t.toLocationId}`, (calc.get(`${t.itemId}|${t.lotId ?? ''}|${t.toLocationId}`) ?? 0) + num(t.qty));
    if (t.fromLocationId) calc.set(`${t.itemId}|${t.lotId ?? ''}|${t.fromLocationId}`, (calc.get(`${t.itemId}|${t.lotId ?? ''}|${t.fromLocationId}`) ?? 0) - num(t.qty));
  }
  const balKeys = new Map(balances.map((b) => [`${b.itemId}|${b.lotId ?? ''}|${b.warehouseId}`, b]));
  const mismatches = [...new Set([...calc.keys(), ...balKeys.keys()])].filter((k) => !near(calc.get(k) ?? 0, num(balKeys.get(k)?.qtyOnHand)));
  check(mismatches.length === 0, `재고 잔액 ${balances.length}건 = 입출고 이력 ${txs.length}건 누계 (불일치 ${mismatches.length}건${mismatches.length ? ': ' + mismatches.slice(0, 3).map((k) => `${code(k.split('|')[0])}/${k.split('|')[1].slice(-6)}`).join(',') : ''})`);
  check(balances.every((b) => num(b.qtyOnHand) >= 0 && near(num(b.qtyAvailable), num(b.qtyOnHand) - num(b.qtyHold))), '음수 재고 없음 · 가용 = 현재고 − 보류');
  const po = await prisma.purchaseOrderItem.findMany({ where: { purchaseOrder: { tenantId: TENANT_ID, orderNo: { startsWith: 'PO-' } } }, include: { purchaseOrder: true } });
  const rcvTx = txs.filter((t) => t.refType === 'PURCHASE_ORDER');
  check(near(po.reduce((s, p) => s + num(p.receivedQty), 0), rcvTx.reduce((s, t) => s + num(t.qty), 0)), `구매발주 입고수량 합 ${po.reduce((s, p) => s + num(p.receivedQty), 0)} = 입고 이력 합 ${rcvTx.reduce((s, t) => s + num(t.qty), 0)}`);

  console.log('\n  [2] 원자재 LOT ↔ 생산 LOT ↔ 완제품 LOT');
  const s01wo = await woByTag('MAN-S01', 'MAN-FG-NRV01');
  const fgLot = await prisma.finishedGoodsReceipt.findFirstOrThrow({ where: { tenantId: TENANT_ID, workOrderId: s01wo.id }, include: { lot: true } });
  const back = await lotApi.getLotBackwardTrace(fgLot.lotId!);
  const flat = (n: { lotNo: string; itemCode: string; children?: unknown[] }, acc: string[] = []): string[] => { acc.push(`${n.itemCode}:${n.lotNo}`); for (const c of (n.children ?? []) as Array<typeof n>) flat(c, acc); return acc; };
  const lots = flat(back);
  logLine(`S01 완제품 LOT ${fgLot.lot?.lotNo} ← ${lots.slice(1).join(', ')}`);
  check(lots.some((l) => l.startsWith('MAN-SF-NRV-BODY:')) && lots.some((l) => l.startsWith('MAN-SF-NRV-DISC:')) && lots.some((l) => l.startsWith('MAN-RM-NRV-BAR:')) && lots.some((l) => l.startsWith('MAN-RM-PLATE:')), '완제품 LOT 역추적 → 반제품 LOT(바디·디스크) → 원자재 LOT(봉강·철판)');
  const barLot = await prisma.lot.findFirstOrThrow({ where: { tenantId: TENANT_ID, item: { code: 'MAN-RM-NRV-BAR' } }, orderBy: { lotNo: 'asc' } });
  const fwd = flat(await lotApi.getLotForwardTrace(barLot.id));
  logLine(`봉강 LOT ${barLot.lotNo} → ${fwd.slice(1).join(', ')}`);
  check(fwd.some((l) => l.startsWith('MAN-FG-NRV01:') && l.endsWith(fgLot.lot!.lotNo)), '원자재(봉강) LOT 정추적 → S01 완제품 LOT');
  const shipItem = await prisma.shipmentItem.findFirstOrThrow({ where: { shipmentOrder: { tenantId: TENANT_ID, note: { contains: '[MAN-S01]' } } }, include: { lot: true, shipmentOrder: true } });
  check(shipItem.lotId === fgLot.lotId, `출하 LOT = 완제품 입고 LOT (${shipItem.lot?.lotNo})`);
  const allLots = await prisma.lot.findMany({ where: { tenantId: TENANT_ID, item: { code: { startsWith: 'MAN-' } } }, include: { item: true } });
  const rawLots = allLots.filter((l) => l.item.itemType === 'RAW_MATERIAL' || l.item.itemType === 'CONSUMABLE');
  const prodLots = allLots.filter((l) => l.item.itemType === 'SEMI_FINISHED' || l.item.itemType === 'FINISHED');
  const mfgSet = new Set((await prisma.workOrder.findMany({ where: { tenantId: TENANT_ID }, select: { manufacturingNo: true } })).map((w) => w.manufacturingNo));
  check(rawLots.length > 0 && rawLots.every((l) => l.lotNo.startsWith(l.item.code) && /\d{4}-\d{3}$/.test(l.lotNo)), `입고 LOT ${rawLots.length}건: 규칙(품목코드+YYMM-순번3) 형식`);
  check(prodLots.length > 0 && prodLots.every((l) => mfgSet.has(l.lotNo)) && new Set(allLots.map((l) => l.lotNo)).size === allLots.length, `반제품·완제품 LOT ${prodLots.length}건: 제조번호와 동일(프로젝트 LOT 정책) · 전체 ${allLots.length}건 중복 없음`);
  const mfgNos = (await prisma.workOrder.findMany({ where: { tenantId: TENANT_ID }, select: { manufacturingNo: true } })).map((w) => w.manufacturingNo);
  check(new Set(mfgNos).size === mfgNos.length && mfgNos.every((m) => /^MFG-\d{4}-\d{4}$/.test(m ?? '')), `제조번호 ${mfgNos.length}건 규칙(MFG-YYMM-순번4) 형식 · 중복 없음`);

  console.log('\n  [3] 작업지시 수량 ↔ POP 실적');
  const wos = await prisma.workOrder.findMany({ where: { tenantId: TENANT_ID }, include: { operations: { orderBy: { seq: 'asc' }, include: { productionResults: true } } } });
  const bad3 = wos.flatMap((w) => w.operations.filter((o) => !near(num(o.completedQty), o.productionResults.reduce((s, r) => s + num(r.goodQty) + num(r.defectQty) + num(r.reworkQty), 0))).map((o) => `${w.orderNo}#${o.seq}`));
  check(bad3.length === 0, `전 작업지시 ${wos.length}건 공정별 완료수량 = 실적(양품+불량+재작업) 합 (불일치 ${bad3.join(',') || '없음'})`);
  const done = wos.filter((w) => w.status === 'COMPLETED');
  check(done.length >= 4 && done.every((w) => w.operations.every((o) => o.status === 'COMPLETED' && near(num(o.completedQty), num(w.plannedQty)))), `완료 작업지시 ${done.length}건: 모든 공정 완료 · 완료수량 = 계획수량`);

  console.log('\n  [4] 공정별 WIP 수량');
  for (const w of wos.filter((x) => x.status !== 'DRAFT')) {
    const units = await prisma.wipUnit.findMany({ where: { workOrderId: w.id } });
    if (units.length === 0) continue;
    const sum = units.reduce((s, u) => s + num(u.qty), 0);
    check(near(sum, num(w.plannedQty)), `${w.orderNo} WIP 합 ${sum} = 계획 ${num(w.plannedQty)} (${units.map((u) => `${u.status}:${num(u.qty)}`).join(', ')})`);
  }

  console.log('\n  [5] 외주발주 ↔ 외주 재공');
  const s03wo = await woByTag('MAN-S03', 'MAN-FG-CAP01');
  const osPo = await prisma.purchaseOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: '[MAN-S03]' }, supplier: { code: 'MAN-O02' } }, include: { items: true } });
  const outWip = await prisma.wipUnit.findMany({ where: { workOrderId: s03wo.id, status: 'OUTSOURCED' } });
  const outMv = await prisma.wipMovement.aggregate({ where: { tenantId: TENANT_ID, movementType: 'OUTSOURCED', sourceType: 'PurchaseOrderItem', sourceId: { in: osPo.items.map((i) => i.id) } }, _sum: { qty: true } });
  const op5 = s03wo.operations.find((o) => o.seq === 5)!;
  check(osPo.items.length === 1 && near(num(osPo.items[0].qty), 100) && near(outWip.reduce((s, u) => s + num(u.qty), 0), 100) && near(num(outMv._sum.qty), 100), `외주발주 ${osPo.orderNo}(${osPo.status}) 수량 100 = 외주 재공 ${outWip.reduce((s, u) => s + num(u.qty), 0)} = 외주출고 이동 ${num(outMv._sum.qty)}`);
  check(outWip[0]?.outsourcingPartnerId === partnerId('MAN-O02') && num(osPo.items[0].receivedQty) === 0, '외주처 = 고운도장(가상), 외주입고 0 (입고 전)');
  check(op5.status === 'IN_PROGRESS' && s03wo.operations.slice(0, 4).every((o) => o.status === 'COMPLETED') && s03wo.operations[5].status === 'PENDING', 'CAP 공정 상태: 1~4 완료 · 5(분체도장) 진행 · 6 대기 → 외주 상태와 일치');

  console.log('\n  [6] 불량·재작업 수량');
  const s04wo = await woByTag('MAN-S04', 'MAN-FG-NRV01');
  const r = s04wo.operations[0].productionResults;
  const [g, dft, rw] = [r.reduce((s, x) => s + num(x.goodQty), 0), r.reduce((s, x) => s + num(x.defectQty), 0), r.reduce((s, x) => s + num(x.reworkQty), 0)];
  const u4 = await prisma.wipUnit.findMany({ where: { workOrderId: s04wo.id } });
  const byStatus = (st: string) => u4.filter((u) => u.status === st).reduce((s, u) => s + num(u.qty), 0);
  check(near(g, 7) && near(dft, 1) && near(rw, 2) && near(g + dft + rw, num(s04wo.operations[0].completedQty)), `1공정 실적 양품 ${g} · 불량 ${dft} · 재작업 ${rw} (합 ${g + dft + rw} = 공정 완료수량 ${num(s04wo.operations[0].completedQty)}, 중복 집계 없음)`);
  check(near(byStatus('WAITING') + byStatus('IN_PROCESS'), 7) && near(byStatus('SCRAPPED'), 1) && near(byStatus('REWORK'), 2), `WIP: 정상 ${byStatus('WAITING') + byStatus('IN_PROCESS')} · 폐기 ${byStatus('SCRAPPED')} · 재작업 ${byStatus('REWORK')}`);
  const defRec = await prisma.defectRecord.findMany({ where: { qualityInspection: { workOrderOperation: { workOrderId: s04wo.id } } }, include: { defectCode: true } });
  check(defRec.length === 1 && near(num(defRec[0].qty), 1) && defRec[0].defectCode.code === 'DIM-001', `불량 기록 ${defRec.map((d) => `${d.defectCode.code}×${num(d.qty)}`).join(',')} (불량코드 연결)`);

  console.log('\n  [7] 완제품 입고 ↔ 출하');
  const fgr = await prisma.finishedGoodsReceipt.findMany({ where: { tenantId: TENANT_ID, item: { code: 'MAN-FG-NRV01' } } });
  const shipped = await prisma.shipmentItem.aggregate({ where: { shipmentOrder: { tenantId: TENANT_ID, status: 'SHIPPED' }, item: { code: 'MAN-FG-NRV01' } }, _sum: { qty: true } });
  const fgBal = balances.filter((b) => ctx.itemById.get(b.itemId)?.code === 'MAN-FG-NRV01').reduce((s, b) => s + num(b.qtyOnHand), 0);
  check(near(fgr.reduce((s, x) => s + num(x.receiptQty), 0), 20) && near(num(shipped._sum.qty), 20) && near(fgBal, 0), `NRV 완제품 입고 ${fgr.reduce((s, x) => s + num(x.receiptQty), 0)} = 출하 ${num(shipped._sum.qty)} → 완제품 재고 ${fgBal}`);
  const so1 = await prisma.salesOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: '[MAN-S01]' } } });
  check(so1.status === 'SHIPPED' || so1.status === 'CLOSED', `S01 수주 상태 ${so1.status}`);

  // 제조이력추적(manufacturing-traceability) 액션은 대원정밀 범위 정책상 개발자 계정 전용이라 일반 세션으로는 호출하지 않고 같은 연결을 DB 로 확인한다.
  console.log('\n  [8] 제조이력추적 (제조번호 기준 연결)');
  const mfg = s01wo.manufacturingNo!;
  const [mLots, results, insp, receipts, ships] = await Promise.all([
    prisma.workOrderMaterialLot.findMany({ where: { tenantId: TENANT_ID, workOrderId: s01wo.id }, include: { materialItem: true } }),
    prisma.productionResult.count({ where: { workOrderOperation: { workOrderId: s01wo.id } } }),
    prisma.qualityInspection.count({ where: { workOrderOperation: { workOrderId: s01wo.id } } }),
    prisma.finishedGoodsReceipt.count({ where: { tenantId: TENANT_ID, workOrderId: s01wo.id } }),
    prisma.shipmentItem.count({ where: { lotId: fgLot.lotId! } }),
  ]);
  logLine(`제조번호 ${mfg}: 투입 자재 LOT ${mLots.map((m) => `${m.materialItem.code}:${m.materialLotNo}`).join(', ')} / 공정실적 ${results} / 검사 ${insp} / 완제품 입고 ${receipts} / 출하 ${ships}`);
  check(mLots.length === 3 && results === 7 && insp >= 1 && receipts === 1 && ships === 1, '제조번호 → 투입 LOT(반제품 2 + 분체도료 1; 포장박스는 LOT 비관리) · 7공정 실적 · 최종검사 · 완제품 입고 · 출하 연결');
  check(mLots.filter((m) => m.materialItem.itemType === 'SEMI_FINISHED').every((m) => allLots.some((l) => l.lotNo === m.materialLotNo)), '투입 반제품 LOT 번호가 LOT 원장에 존재(→ 위 역추적으로 원자재 LOT 도달)');
  return ok;
}

// ─── 실행 ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`▶ 매뉴얼 업무 시나리오 seed ${VERIFY_ONLY ? '(검증만)' : '(적용)'} — ${EXPECT.host}:${EXPECT.port}/${EXPECT.db}, tenant=${TENANT_ID}${ONLY ? `, only=${ONLY.join(',')}` : ''}`);
  await init();
  if (VERIFY_ONLY) {
    const ok = await verifyAll();
    if (!ok) process.exitCode = 1;
    return;
  }
  const runners: Array<[string, () => Promise<unknown>]> = [['S01', s01], ['S02', s02], ['S03', s03], ['S04', s04], ['S05', s05], ['S06', s06]];
  for (const [name, fn] of runners) if (want(name)) await fn();
  console.log('\n✅ 완료');
}

main().catch((e) => { console.error(e instanceof Error ? (e.stack ?? e.message) : e); process.exit(1); }).finally(() => prisma.$disconnect());
