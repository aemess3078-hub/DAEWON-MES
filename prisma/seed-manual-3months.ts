/**
 * 대원정밀 MES 고객 시연용 "최근 3개월" 가상 생산·품질·자재 데이터 (로컬 매뉴얼 DB 전용)
 *
 * 모든 데이터는 고객 시연용 가상 데이터이며 실제 대원정밀 생산실적이 아니다. (식별자: 비고의 [DEMO3M:Cxxx] 태그 + 매니페스트)
 * 기간: 2026-08-12 ~ 2026-11-11 (KST). 평일 중심, 공휴일 제외.
 *
 * 생성 방식
 *   · 수주/생산의뢰/생산계획/작업지시/자재출고/POP 공정실적/검사/완제품입고/출하/외주/구매발주/입고검사는 모두 앱의 서버 액션을
 *     로컬 관리자 세션(JWT)으로 호출한다. 재고·LOT·WIP·이력은 Prisma INSERT 로 직접 만들지 않는다.
 *   · 앱 액션은 "지금 시각"으로 일시를 기록한다. 과거 일시 지원이 없으므로 로컬 전용 가상 시계(Date 대체)로 Node 측 시각을 과거로 두고,
 *     DB 엔진이 찍는 시각(createdAt/updatedAt 등)은 단계별로 같은 간격만큼 되돌린다(shiftWindow). 업무번호의 YYMM 도 과거 월로 채번된다.
 *   · 불량은 POP 불량코드 입력(자주검사 QualityInspection + DefectRecord 자동 생성)으로만 만든다. 불량이 없는 실적은 검사(PASS)를 별도 등록해 분모를 맞춘다.
 *   · 재작업(reworkQty)은 이번 시연 데이터에 포함하지 않는다(기존 S04 가 보존됨).
 *
 * 실행 (스크립트 러너: scripts/run-demo3m.sh 참고)
 *   --dry-run  DB 쓰기 없이 계획 수치만 계산·출력         --apply  백업 존재 확인 후 생성(멱등, 재실행 시 이어서 진행)
 *   --verify   DB 쓰기 없이 관계·수량 검증                --target=test  WSL 테스트 DB(54329/daewon_mes_manual_demo3m_test) 대상
 *   --phase=history|mrp|all (기본 all)   --only=C001,C002   --limit=N (앞에서 N 개 케이스만; 시험용)
 *
 * 정리(삭제) 대상은 docs/manual/demo3m/manifest-<target>.json 의 cases/mrp 에 기록된다. 기존 S01~S06 및 기존 LOT 는 baseline 으로 보존·검증한다.
 */
import Module from 'node:module';
import { join } from 'node:path';
import * as fs from 'fs';
import * as path from 'path';
import { loadDotEnv } from './manual-seed-guard';

const RealDate = Date;
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => args.find((a) => a.startsWith(`${n}=`))?.split('=')[1];
const MODE = flag('--apply') ? 'apply' : flag('--verify') ? 'verify' : 'dry-run';
const TARGET = opt('--target') === 'test' ? 'test' : 'manual';
const PHASE = opt('--phase') ?? 'all';
const ONLY = opt('--only')?.split(',').map((s) => s.trim().toUpperCase());
const LIMIT = opt('--limit') ? Number(opt('--limit')) : Infinity;

// ─── 안전장치 ────────────────────────────────────────────────────────────────
const TARGETS = {
  manual: { host: '127.0.0.1', port: '5432', db: 'daewon_mes_manual' },
  test: { host: '127.0.0.1', port: '54329', db: 'daewon_mes_manual_demo3m_test' },
} as const;
function assertTarget(): string {
  loadDotEnv();
  const want = TARGETS[TARGET];
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    const raw = process.env[name];
    if (!raw) throw new Error(`[demo3m] ${name} 가 없습니다. 중단합니다.`);
    let u: URL;
    try { u = new URL(raw); } catch { throw new Error(`[demo3m] ${name} 형식을 해석할 수 없습니다. 중단합니다.`); }
    if (u.hostname !== want.host || (u.port || '5432') !== want.port || u.pathname.replace(/^\//, '') !== want.db) {
      throw new Error(`[demo3m] ${name} 대상이 ${want.host}:${want.port}/${want.db}(${TARGET})가 아닙니다. 중단합니다.`);
    }
  }
  const tenant = process.env.DEFAULT_TENANT_ID?.trim();
  if (tenant !== 'tenant-daewon-manual') throw new Error('[demo3m] DEFAULT_TENANT_ID 가 tenant-daewon-manual 이 아닙니다. 중단합니다.');
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(DATABASE_URL|DIRECT_URL|SUPABASE_.*|NEXT_PUBLIC_SUPABASE_.*)$/.test(k) && v && /supabase|aquqetajewvhyirmewfy/i.test(v)) throw new Error(`[demo3m] 환경변수 ${k} 가 운영(Supabase)을 가리킵니다. 중단합니다.`);
  }
  return tenant;
}
const TENANT_ID = assertTarget();
if (MODE === 'apply' && TARGET === 'manual') {
  const dir = path.resolve(__dirname, '..', 'backup');
  const ok = fs.existsSync(dir) && fs.readdirSync(dir).some((f) => /^daewon_mes_manual_pre-3months_.*\.dump$/.test(f) && fs.statSync(path.join(dir, f)).size > 10000);
  if (!ok) throw new Error('[demo3m] 작업 전 백업(backup/daewon_mes_manual_pre-3months_*.dump)이 없습니다. 중단합니다.');
}

// ─── Next 런타임 대체 + '@/' 별칭 (seed-manual-scenarios.ts 와 동일) ─────────────
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
  mod.filename = filename; mod.loaded = true; mod.exports = exports;
  require.cache[filename] = mod;
}
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  getAll: () => Array.from(jar).map(([name, value]) => ({ name, value })),
  has: (name: string) => jar.has(name),
  set: (name: string | { name: string; value: string }, value?: string) => { if (typeof name === 'object') jar.set(name.name, name.value); else jar.set(name, value ?? ''); },
  delete: (name: string) => void jar.delete(name),
};
inject('next/headers', { cookies: async () => cookieStore, headers: async () => new Map<string, string>([['x-forwarded-for', '127.0.0.1'], ['user-agent', 'manual-demo3m-seed']]) });
inject('next/cache', { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: <T>(fn: T) => fn });

/* eslint-disable @typescript-eslint/no-var-requires */
const { prisma } = require('../src/lib/db/prisma') as typeof import('../src/lib/db/prisma');
const jwtLib = require('../src/lib/jwt') as typeof import('../src/lib/jwt');
const { requiredScaledByItem } = require('../src/lib/material-issue/issue-quantity') as typeof import('../src/lib/material-issue/issue-quantity');
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
};

// ─── 상수·유틸 ───────────────────────────────────────────────────────────────
const SITE_ID = 'site-daewon-factory-001';
const WH = { RAW: 'wh-daewon-raw-001', WIP: 'wh-daewon-wip-001', FG: 'wh-daewon-fg-001' } as const;
const KST = 9 * 3600e3;
const DAY = 86400e3;
const START = new RealDate('2026-08-12T00:00:00+09:00').getTime();
const CUTOFF = new RealDate('2026-11-11T17:30:00+09:00').getTime();
const HOLIDAYS = new Set(['2026-08-17', '2026-09-24', '2026-09-25', '2026-09-26', '2026-10-05', '2026-10-09']);
const num = (v: unknown) => Number(v ?? 0);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const log = (m: string) => console.log(`  ${m}`);
const fail = (m: string): never => { throw new Error(m); };
const kstKey = (t: number) => new RealDate(t + KST).toISOString().slice(0, 10);
const kstMin = (t: number) => { const k = new RealDate(t + KST); return k.getUTCHours() * 60 + k.getUTCMinutes(); };
const isWorkday = (t: number) => { const k = new RealDate(t + KST); const wd = k.getUTCDay(); return wd !== 0 && wd !== 6 && !HOLIDAYS.has(k.toISOString().slice(0, 10)); };
const kstAt = (key: string, h: number, m = 0) => new RealDate(`${key}T00:00:00+09:00`).getTime() + (h * 60 + m) * 60000;
/** 근무시간(08:30-12:00, 13:00-17:30, 평일) 안의 가장 가까운 이후 시각 */
function normalize(t: number): number {
  for (let i = 0; i < 20; i++) {
    const mm = kstMin(t);
    if (!isWorkday(t) || mm >= 1050) { t = kstAt(kstKey(t + DAY), 8, 30); continue; }
    if (mm < 510) return kstAt(kstKey(t), 8, 30);
    if (mm >= 720 && mm < 780) return kstAt(kstKey(t), 13, 0);
    return t;
  }
  return t;
}
function addWork(t: number, minutes: number): number {
  t = normalize(t);
  let left = Math.max(1, Math.round(minutes));
  while (left > 0) {
    const mm = kstMin(t);
    const segEnd = mm < 720 ? 720 : 1050;
    const avail = segEnd - mm;
    if (left <= avail) { t += left * 60000; left = 0; } else { left -= avail; t += avail * 60000; t = normalize(t); }
  }
  return t;
}
const nextWorkdayAt = (t: number, h: number, m = 0) => { let k = t + DAY; for (let i = 0; i < 10 && !isWorkday(k); i++) k += DAY; return kstAt(kstKey(k), h, m); };
const workdaysBetween = (a: number, b: number) => { const out: number[] = []; for (let t = a; t <= b; t += DAY) if (isWorkday(t)) out.push(t); return out; };
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = <T,>(rng: () => number, arr: Array<[T, number]>): T => { const tot = arr.reduce((s, x) => s + x[1], 0); let r = rng() * tot; for (const [v, w] of arr) { if ((r -= w) <= 0) return v; } return arr[arr.length - 1][0]; };
const iso = (t: number) => kstKey(t);

// ─── 가상 시계 + 일시 보정 ────────────────────────────────────────────────────
let simOffset = 0;
class FakeDate extends RealDate {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(...a: any[]) { if (a.length === 0) super(RealDate.now() + simOffset); else super(...(a as [any])); }
  static now() { return RealDate.now() + simOffset; }
}
(globalThis as unknown as { Date: unknown }).Date = FakeDate;

let shiftTables: Array<{ t: string; cols: string[] }> = [];
const tsLit = (ms: number) => new RealDate(ms).toISOString().replace('T', ' ').replace('Z', '');
async function loadShiftTables() {
  const rows = await prisma.$queryRawUnsafe<Array<{ t: string; c: string }>>(`select c.table_name t, c.column_name c from information_schema.columns c join information_schema.tables tb on tb.table_schema=c.table_schema and tb.table_name=c.table_name where c.table_schema='public' and tb.table_type='BASE TABLE' and c.data_type like 'timestamp%' and c.table_name <> '_prisma_migrations' order by 1,2`);
  const m = new Map<string, string[]>();
  for (const r of rows) m.set(r.t, [...(m.get(r.t) ?? []), r.c]);
  shiftTables = [...m].map(([t, cols]) => ({ t, cols }));
}
/** 실시간 창 [a,b] 에 찍힌 DB 엔진 시각을 deltaMs 만큼 옮긴다(로컬 시연 데이터 전용). */
async function shiftWindow(a: number, b: number, deltaMs: number) {
  if (Math.abs(deltaMs) < 1000) return;
  const lo = tsLit(a - 150), hi = tsLit(b + 150), iv = `${(deltaMs / 1000).toFixed(3)} seconds`;
  const body = shiftTables.map(({ t, cols }) => `UPDATE "${t}" SET ${cols.map((c) => `"${c}" = CASE WHEN "${c}" BETWEEN '${lo}' AND '${hi}' THEN "${c}" + interval '${iv}' ELSE "${c}" END`).join(', ')} WHERE ${cols.map((c) => `"${c}" BETWEEN '${lo}' AND '${hi}'`).join(' OR ')};`).join('\n');
  await prisma.$executeRawUnsafe(`DO $do$ BEGIN\n${body}\nEND $do$`);
}
let sessionBase: { profileId: string; loginId: string; email: string; name: string } | null = null;
function setSim(t: number) {
  simOffset = t - RealDate.now();
  if (sessionBase) jar.set(jwtLib.NMES_SESSION_COOKIE, jwtLib.signAuthToken({ ...sessionBase, tenantId: TENANT_ID, role: 'OWNER', mustChangePw: false }));
}
async function at<T>(t: number, fn: () => Promise<T>): Promise<T> {
  if (t > CUTOFF) fail(`기준 시각(2026-11-11 17:30) 이후 단계입니다: ${new RealDate(t).toISOString()}`);
  setSim(t);
  const t0 = RealDate.now();
  const off = simOffset;
  try { return await fn(); } finally { await shiftWindow(t0, RealDate.now(), off); }
}

// ─── 매니페스트 / baseline ────────────────────────────────────────────────────
type Manifest = {
  version: 1; target: string; createdAt: string; existing: { lotIds: string[]; workOrderIds: string[]; salesOrderIds: string[]; poIds: string[]; planIds: string[] };
  baseline: { lotBalances: Record<string, number>; boxBalance: number; woOps: Record<string, string>; counts: Record<string, number> };
  cases: Record<string, { soId?: string; planIds: string[]; woIds: string[]; poIds: string[]; shipmentId?: string }>; purchases: Record<string, { poId: string }>; mrp: Record<string, unknown>;
};
const MANIFEST_DIR = path.resolve(__dirname, '..', 'docs', 'manual', 'demo3m');
const MANIFEST_FILE = path.join(MANIFEST_DIR, `manifest-${TARGET}.json`);
let manifest!: Manifest;
const saveManifest = () => { fs.mkdirSync(MANIFEST_DIR, { recursive: true }); fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2)); };

// ─── 마스터 ──────────────────────────────────────────────────────────────────
type Bom = { itemCode: string; lines: Array<{ componentItemId: string; qtyPer: unknown; scrapRate: unknown }> };
type RoutingMeta = Array<{ seq: number; name: string; stdTime: number; hasSpec: boolean }>;
const ctx = {
  item: new Map<string, string>(), itemCode: new Map<string, string>(), lotTracked: new Map<string, boolean>(), partner: new Map<string, string>(), defect: new Map<string, string>(),
  bom: new Map<string, Bom>(), routing: new Map<string, RoutingMeta>(), admin: { profileId: '' }, existingLots: new Set<string>(),
};
const itemId = (code: string) => ctx.item.get(code) ?? fail(`품목 없음: ${code}`);
const partnerId = (code: string) => ctx.partner.get(code) ?? fail(`거래처 없음: ${code}`);
const ROUTING_OF: Record<string, string> = { 'MAN-FG-PIPE01': 'MAN-RT-PIPE', 'MAN-FG-CAP01': 'MAN-RT-CAP', 'MAN-FG-NRV01': 'MAN-RT-NRV', 'MAN-SF-CAP-DISC': 'MAN-RT-CAP-DISC', 'MAN-SF-NRV-BODY': 'MAN-RT-NRV-BODY', 'MAN-SF-NRV-DISC': 'MAN-RT-NRV-DISC' };
const whOfItem = (code: string) => (code.startsWith('MAN-SF-') || code.startsWith('MAN-FG-') ? WH.WIP : WH.RAW);

async function initMaster() {
  const admin = await prisma.userCredential.findFirst({ where: { tenantId: TENANT_ID, profile: { tenantUsers: { some: { tenantId: TENANT_ID, role: 'OWNER', isActive: true } } }, NOT: { loginId: 'test' } }, include: { profile: true } });
  if (!admin) fail('로컬 관리자(OWNER) 계정을 찾을 수 없습니다.');
  sessionBase = { profileId: admin!.profileId, loginId: admin!.loginId, email: admin!.profile.email, name: admin!.profile.name };
  ctx.admin.profileId = admin!.profileId;
  const items = await prisma.item.findMany({ where: { tenantId: TENANT_ID, code: { startsWith: 'MAN-' } } });
  for (const i of items) { ctx.item.set(i.code, i.id); ctx.itemCode.set(i.id, i.code); ctx.lotTracked.set(i.id, i.isLotTracked); }
  for (const p of await prisma.businessPartner.findMany({ where: { tenantId: TENANT_ID, code: { startsWith: 'MAN-' } } })) ctx.partner.set(p.code, p.id);
  for (const d of await prisma.defectCode.findMany({ where: { tenantId: TENANT_ID } })) ctx.defect.set(d.code, d.id);
  if (items.length < 11) fail('기준정보 seed 가 먼저 적용되어야 합니다.');
  for (const code of Object.keys(ROUTING_OF)) {
    const bom = await prisma.bOM.findFirstOrThrow({ where: { tenantId: TENANT_ID, itemId: itemId(code), status: 'ACTIVE', isDefault: true }, include: { bomItems: { orderBy: { seq: 'asc' } } } });
    ctx.bom.set(code, { itemCode: code, lines: bom.bomItems.map((b) => ({ componentItemId: b.componentItemId, qtyPer: b.qtyPer, scrapRate: b.scrapRate })) });
    const rt = await prisma.routing.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: ROUTING_OF[code] }, include: { operations: { orderBy: { seq: 'asc' } } } });
    const specs = await prisma.inspectionSpec.findMany({ where: { tenantId: TENANT_ID, itemId: itemId(code), status: 'ACTIVE' }, select: { routingOperationId: true } });
    const specOps = new Set(specs.map((s) => s.routingOperationId));
    ctx.routing.set(code, rt.operations.map((o) => ({ seq: o.seq, name: o.name, stdTime: num(o.standardTime), hasSpec: specOps.has(o.id) })));
  }
}

// ─── 케이스 계획(순수 계산) ───────────────────────────────────────────────────
type Kind = 'PIPE' | 'CAP' | 'NRV';
type ResultPlan = { at: number; good: number; defect: number; details: Array<{ code: string; qty: number }> };
type OpPlan = { seq: number; startAt: number; results: ResultPlan[]; endAt: number; outsourced?: boolean };
type WoPlan = { itemCode: string; qty: number; woAt: number; issueAt: number; ops: OpPlan[]; receiptAt: number; outQty: number };
type Case = {
  id: string; kind: Kind; qty: number; mode: 'SO' | 'STOCK'; customer: string; soAt: number; delivery: number; outsource: boolean; seed: number;
  semis: WoPlan[]; fg: WoPlan; ship?: { planAt: number; at: number }; defectTotal: number;
};
const DEFECT_MODEL: Record<string, Record<number, { rate: number; codes: Array<[string, number]> }>> = {
  'MAN-FG-PIPE01': { 1: { rate: 0.003, codes: [['MAT-001', 1]] }, 4: { rate: 0.018, codes: [['DIM-001', 0.5], ['DIM-002', 0.3], ['VIS-001', 0.2]] }, 5: { rate: 0.012, codes: [['DIM-001', 0.4], ['DIM-002', 0.3], ['VIS-001', 0.3]] }, 6: { rate: 0.006, codes: [['VIS-001', 0.6], ['DIM-001', 0.4]] } },
  'MAN-FG-CAP01': { 1: { rate: 0.004, codes: [['MAT-001', 1]] }, 4: { rate: 0.03, codes: [['VIS-001', 0.45], ['DIM-001', 0.3], ['DIM-002', 0.25]] } },
  'MAN-FG-NRV01': { 7: { rate: 0.045, codes: [['FUN-001', 0.45], ['VIS-001', 0.3], ['DIM-001', 0.25]] } },
  'MAN-SF-NRV-BODY': { 4: { rate: 0.02, codes: [['DIM-001', 0.6], ['DIM-002', 0.4]] } },
};
const FINAL_OP: Record<string, number> = { 'MAN-FG-PIPE01': 6, 'MAN-FG-NRV01': 7, 'MAN-SF-NRV-BODY': 4 };
/** 마지막 공정에 검사표준이 있으면 최종검사 PASS 가 있어야 입고 가능(앱 규칙). */
const needsFinalAtLast = (itemCode: string, seq: number, hasSpec: boolean) => hasSpec && ctx.routing.get(itemCode)![ctx.routing.get(itemCode)!.length - 1].seq === seq;
/** 불량 집중 기간(시연 패턴, 가상): 공정별 불량률을 일정 기간 높인다. */
function periodBoost(itemCode: string, seq: number, t: number): number {
  const k = kstKey(t);
  if (itemCode === 'MAN-FG-PIPE01' && seq === 4 && k >= '2026-09-14' && k <= '2026-09-25') return 2.6;
  if (itemCode === 'MAN-FG-CAP01' && seq === 4 && k >= '2026-10-19' && k <= '2026-10-30') return 2.2;
  if (itemCode === 'MAN-FG-NRV01' && seq === 7 && k >= '2026-10-01' && k <= '2026-10-31') return 1.6;
  if (itemCode === 'MAN-FG-PIPE01' && seq === 5 && k >= '2026-10-12' && k <= '2026-10-23') return 1.8;
  return 1;
}

function planWo(rng: () => number, itemCode: string, qty: number, woAt: number, notBefore: number, outsource: boolean, maxDefect: number): WoPlan {
  const meta = ctx.routing.get(itemCode)!;
  const issueAt = Math.max(addWork(woAt, 20), notBefore);
  let cur = addWork(issueAt, 30 + Math.round(rng() * 60));
  let flow = qty; let defectLeft = maxDefect;
  const ops: OpPlan[] = [];
  for (const m of meta) {
    const std = m.stdTime > 0 ? m.stdTime : 8;
    const isInsp = /검사/.test(m.name);
    const minutes = Math.min(420, Math.max(isInsp ? 45 : 60, isInsp ? 45 + flow * 0.2 : flow * std * 0.6 * (0.8 + rng() * 0.5)));
    const startAt = ops.length === 0 ? cur : (rng() < 0.3 ? nextWorkdayAt(ops[ops.length - 1].endAt, 8, 40 + Math.round(rng() * 40)) : addWork(ops[ops.length - 1].endAt, 15 + Math.round(rng() * 90)));
    const startN = normalize(startAt);
    const outsourcedOp = outsource && itemCode === 'MAN-FG-CAP01' && m.seq === 5;
    // 외주 공정은 출고(+20분) → 외주입고(+2근무일) → 입고검사(+90분)에 맞춰 종료 시각을 잡는다(runOutsourcing 과 동일 식).
    const endAt = outsourcedOp ? addWork(addWork(addWork(startN, 20), 960), 90) : addWork(startN, minutes);
    const model = DEFECT_MODEL[itemCode]?.[m.seq];
    const split = flow >= 40 && minutes > 150 && rng() < 0.35;
    const nRes = split ? 2 : 1;
    // 불량: 결과 이벤트 확률 35%, 불량수량 = 수량 × (공정 기준 불량률 / 0.35) × 변동
    let defect = 0; let details: Array<{ code: string; qty: number }> = [];
    if (model && rng() < 0.35 && defectLeft > 0) {
      defect = Math.max(1, Math.round(flow * (model.rate / 0.35) * periodBoost(itemCode, m.seq, startN) * (0.5 + rng())));
      defect = Math.min(defect, Math.max(0, flow - 1), defectLeft);
      if (defect > 0) {
        const c1 = pick(rng, model.codes); details = [{ code: c1, qty: defect }];
        if (defect >= 3 && model.codes.length > 1 && rng() < 0.3) { const c2 = pick(rng, model.codes.filter((c) => c[0] !== c1)); const q2 = Math.max(1, Math.floor(defect / 3)); details = [{ code: c1, qty: defect - q2 }, { code: c2, qty: q2 }]; }
      }
    }
    const results: ResultPlan[] = [];
    if (nRes === 2) {
      const g1 = Math.max(1, Math.round((flow - defect) * (0.4 + rng() * 0.2)));
      results.push({ at: addWork(startN, minutes * 0.5), good: g1, defect: 0, details: [] });
      results.push({ at: endAt, good: flow - defect - g1, defect, details });
    } else {
      results.push({ at: endAt, good: flow - defect, defect, details });
    }
    ops.push({ seq: m.seq, startAt: startN, results, endAt, outsourced: outsourcedOp });
    flow -= defect; defectLeft -= defect;
    cur = endAt;
  }
  const receiptAt = addWork(ops[ops.length - 1].endAt, 40);
  return { itemCode, qty, woAt, issueAt, ops, receiptAt, outQty: flow };
}

function buildCases(): Case[] {
  const rng0 = mulberry32(20260812);
  const days = workdaysBetween(kstAt('2026-08-13', 9), kstAt('2026-11-06', 9));
  const mk = (kind: Kind, n: number, qtys: Array<[number, number]>, custs: string[]): Array<Omit<Case, 'semis' | 'fg' | 'ship' | 'defectTotal' | 'id'>> => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const base = Math.floor(((i + 0.5) / n) * days.length);
      const idx = Math.min(days.length - 1, Math.max(0, base + Math.round((rng0() - 0.5) * 4)));
      const soAt = kstAt(kstKey(days[idx]), 9, 0) + Math.floor(rng0() * 120) * 60000;
      const lead = kind === 'PIPE' ? 10 + Math.floor(rng0() * 7) : kind === 'CAP' ? 14 + Math.floor(rng0() * 8) : 21 + Math.floor(rng0() * 8);
      out.push({ kind, qty: pick(rng0, qtys), mode: (rng0() < (kind === 'PIPE' ? 0.4 : 0.28) ? 'STOCK' : 'SO') as 'SO' | 'STOCK', customer: custs[Math.floor(rng0() * custs.length)], soAt, delivery: kstAt(kstKey(soAt + lead * DAY), 9), outsource: kind === 'CAP' && rng0() < 0.45, seed: Math.floor(rng0() * 1e9) });
    }
    return out;
  };
  const raw = [
    ...mk('PIPE', 30, [[80, 1], [100, 2], [120, 2], [140, 1.5], [160, 1.5], [180, 1], [200, 1]], ['MAN-C01', 'MAN-C02', 'MAN-C03']),
    ...mk('CAP', 14, [[100, 4], [200, 3], [300, 1]], ['MAN-C01', 'MAN-C03']),
    ...mk('NRV', 8, [[10, 1], [20, 2], [30, 2], [40, 1]], ['MAN-C01', 'MAN-C02']),
  ].sort((a, b) => a.soAt - b.soAt);
  const cases: Case[] = [];
  raw.forEach((r, i) => {
    const id = `C${String(i + 1).padStart(3, '0')}`;
    const rng = mulberry32(r.seed);
    const fgCode = r.kind === 'PIPE' ? 'MAN-FG-PIPE01' : r.kind === 'CAP' ? 'MAN-FG-CAP01' : 'MAN-FG-NRV01';
    const woAt = nextWorkdayAt(r.soAt, 8, 40);
    const semis: WoPlan[] = [];
    let notBefore = 0;
    if (r.kind === 'CAP') {
      const sw = planWo(rng, 'MAN-SF-CAP-DISC', Math.ceil(r.qty * 1.01) + 5, woAt, 0, false, 0);
      semis.push(sw); notBefore = addWork(sw.receiptAt, 30);
    } else if (r.kind === 'NRV') {
      for (const code of ['MAN-SF-NRV-BODY', 'MAN-SF-NRV-DISC']) {
        const sw = planWo(rng, code, r.qty + 3, woAt, 0, false, code === 'MAN-SF-NRV-BODY' ? 2 : 0);
        semis.push(sw); notBefore = Math.max(notBefore, addWork(sw.receiptAt, 30));
      }
    }
    const fg = planWo(rng, fgCode, r.qty, woAt, notBefore, r.outsource, 9999);
    const c: Case = { ...r, id, semis, fg, defectTotal: r.qty - fg.outQty };
    if (r.mode === 'SO' && fg.receiptAt <= CUTOFF) {
      const planAt = normalize(nextWorkdayAt(fg.receiptAt, 10, 0));
      const at = addWork(planAt, 120 + Math.round(rng() * 200));
      if (rng() < 0.92 && at <= CUTOFF) c.ship = { planAt, at };
    }
    cases.push(c);
  });
  return cases;
}

// ─── 구매계획(원자재 소요 기반) ────────────────────────────────────────────────
type PurchasePlan = { key: string; supplier: string; orderAt: number; receiptAt: number; lines: Array<{ item: string; qty: number; price: number }>; split: boolean };
const SUPPLIER_OF: Record<string, string> = { 'MAN-RM-NRV-BAR': 'MAN-S01', 'MAN-RM-PIPE-STK': 'MAN-S01', 'MAN-RM-PLATE': 'MAN-S02', 'MAN-CS-POWDER': 'MAN-S02', 'MAN-CS-BOX': 'MAN-S03' };
const BASE_PRICE: Record<string, number> = { 'MAN-RM-NRV-BAR': 1100, 'MAN-RM-PIPE-STK': 4500, 'MAN-RM-PLATE': 1200, 'MAN-CS-POWDER': 8500, 'MAN-CS-BOX': 700 };
const STEP: Record<string, number> = { 'MAN-RM-NRV-BAR': 50, 'MAN-RM-PIPE-STK': 10, 'MAN-RM-PLATE': 20, 'MAN-CS-POWDER': 5, 'MAN-CS-BOX': 20 };
function requiredOf(itemCode: string, qty: number): Array<{ code: string; qty: number }> {
  const bom = ctx.bom.get(itemCode)!;
  return [...requiredScaledByItem(bom.lines, qty).entries()].map(([id, s]) => ({ code: ctx.itemCode.get(id)!, qty: Number(s) / 1e6 }));
}
function buildPurchases(cases: Case[]): PurchasePlan[] {
  const need = new Map<number, Map<string, number>>(); // period -> item -> qty
  const PERIOD = 14 * DAY;
  const add = (w: WoPlan) => {
    const p = Math.max(0, Math.floor((w.issueAt - START) / PERIOD));
    for (const r of requiredOf(w.itemCode, w.qty)) if (SUPPLIER_OF[r.code]) { const m = need.get(p) ?? new Map<string, number>(); m.set(r.code, (m.get(r.code) ?? 0) + r.qty); need.set(p, m); }
  };
  for (const c of cases) { c.semis.forEach(add); add(c.fg); }
  const out: PurchasePlan[] = [];
  const rng = mulberry32(777);
  const lastPeriod = Math.max(...need.keys());
  for (const [p, m] of [...need.entries()].sort((a, b) => a[0] - b[0])) {
    const periodStart = START + p * PERIOD;
    const orderAt = p === 0 ? kstAt('2026-08-12', 9, 40) : kstAt(kstKey(normalize(periodStart - 6 * DAY)), 9, 30);
    const bySup = new Map<string, Array<{ item: string; qty: number; price: number }>>();
    for (const [item, q] of m) {
      const factor = p >= lastPeriod - 1 ? 1.0 : 1.1;
      const step = STEP[item];
      const qty = Math.ceil((q * factor) / step) * step;
      const price = Math.round(BASE_PRICE[item] * (1 + (rng() - 0.3) * 0.05 + p * 0.004));
      bySup.set(SUPPLIER_OF[item], [...(bySup.get(SUPPLIER_OF[item]) ?? []), { item, qty, price }]);
    }
    for (const [supplier, lines] of bySup) {
      const rcv = p === 0 ? kstAt('2026-08-13', 9, 30) : normalize(addWork(orderAt, 3 * 8 * 60));
      out.push({ key: `P${String(p).padStart(2, '0')}-${supplier}`, supplier, orderAt, receiptAt: Math.min(rcv, CUTOFF), lines, split: rng() < 0.25 });
    }
  }
  return out.sort((a, b) => a.orderAt - b.orderAt);
}

// ─── 실행 헬퍼 ───────────────────────────────────────────────────────────────
const tagOf = (id: string, sfx = '') => `[DEMO3M:${id}${sfx}]`;
const dateOf = (t: number) => new RealDate(t);

async function ensureSalesOrder(c: Case) {
  const tag = tagOf(c.id);
  const found = await prisma.salesOrder.findFirst({ where: { tenantId: TENANT_ID, note: { contains: tag } }, include: { items: true } });
  if (found) return found;
  const code = c.kind === 'PIPE' ? 'MAN-FG-PIPE01' : c.kind === 'CAP' ? 'MAN-FG-CAP01' : 'MAN-FG-NRV01';
  const price = c.kind === 'PIPE' ? 6500 : c.kind === 'CAP' ? 3200 : 45000;
  await at(c.soAt, () => act.so().createSalesOrder(TENANT_ID, SITE_ID, {
    customerId: partnerId(c.customer), orderDate: dateOf(c.soAt), deliveryDate: dateOf(c.delivery), totalAmount: c.qty * price, currency: 'KRW',
    note: `${tag} 시연용 가상 수주(실제 생산실적 아님)`, items: [{ itemId: itemId(code), qty: c.qty, unitPrice: price, deliveryDate: dateOf(c.delivery) }],
  }));
  return prisma.salesOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: tag } }, include: { items: true } });
}
async function ensureProductionRequest(c: Case, so: { id: string; items: Array<{ id: string; itemId: string; qty: unknown }> }) {
  const existing = await prisma.productionPlanItem.findFirst({ where: { salesOrderItemId: { in: so.items.map((i) => i.id) }, plan: { tenantId: TENANT_ID, status: { not: 'CANCELLED' } } }, include: { plan: true } });
  if (existing) return existing;
  const res = await at(addWork(c.soAt, 30), () => act.so().requestProductionFromSalesOrder(so.id, so.items.map((i) => ({ salesOrderItemId: i.id, itemId: i.itemId, qty: num(i.qty) })), TENANT_ID, SITE_ID, `demo3m-${c.id.toLowerCase()}-prodreq-0001`));
  if (!res.ok) fail(`생산의뢰 실패(${c.id}): ${res.error}`);
  return prisma.productionPlanItem.findFirstOrThrow({ where: { salesOrderItemId: { in: so.items.map((i) => i.id) }, plan: { tenantId: TENANT_ID } }, include: { plan: true } });
}
async function ensureStockPlan(tag: string, atMs: number, lines: Array<{ item: string; qty: number }>, endMs: number) {
  const found = await prisma.productionPlan.findFirst({ where: { tenantId: TENANT_ID, note: { contains: tag } }, include: { items: true } });
  if (found) return found;
  await at(atMs, () => act.plan().createPlan({ siteId: SITE_ID, planNo: 'AUTO', planType: 'DAILY', startDate: iso(atMs), endDate: iso(endMs), note: `${tag} 시연용 가상 재고생산계획`, items: lines.map((l) => ({ itemId: itemId(l.item), plannedQty: l.qty })) }, TENANT_ID));
  return prisma.productionPlan.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: tag } }, include: { items: true } });
}
async function ensureWorkOrder(planItemId: string, w: WoPlan) {
  let wo = await prisma.workOrder.findFirst({ where: { tenantId: TENANT_ID, productionPlanItemId: planItemId, status: { not: 'CANCELLED' } } });
  const bom = await prisma.bOM.findFirstOrThrow({ where: { tenantId: TENANT_ID, itemId: itemId(w.itemCode), status: 'ACTIVE', isDefault: true } });
  const routing = await prisma.routing.findFirstOrThrow({ where: { tenantId: TENANT_ID, code: ROUTING_OF[w.itemCode] }, include: { operations: { orderBy: { seq: 'asc' }, include: { equipmentMaps: { orderBy: { id: 'asc' } } } } } });
  if (!wo) {
    const res = await at(w.woAt, () => act.wo().createWorkOrder({
      siteId: SITE_ID, itemId: itemId(w.itemCode), bomId: bom.id, routingId: routing.id, orderNo: 'AUTO', manufacturingNo: null, plannedQty: w.qty, status: 'DRAFT', dueDate: iso(w.woAt + 7 * DAY), productionPlanItemId: planItemId,
      operations: routing.operations.map((o) => { const eq = o.equipmentMaps[0]?.equipmentId; return { routingOperationId: o.id, seq: o.seq, plannedQty: w.qty, equipmentId: eq ?? null, assignments: eq ? [{ equipmentId: eq, assignedQty: w.qty }] : [] }; }),
    }, TENANT_ID));
    if (!res.success) fail(`작업지시 생성 실패(${w.itemCode}): ${(res as { error?: string }).error}`);
    wo = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, productionPlanItemId: planItemId, status: { not: 'CANCELLED' } } });
  }
  if (wo.status === 'DRAFT') {
    const r = await at(addWork(w.woAt, 10), () => act.wo().releaseWorkOrder(wo!.id));
    if (!r.success) fail(`작업지시 릴리즈 실패: ${r.error}`);
    wo = await prisma.workOrder.findFirstOrThrow({ where: { id: wo.id } });
  }
  return wo;
}
/** 자재출고: BOM 필요량(앱 계산식) 전량을 "시연 데이터 LOT" FIFO 로만 출고. 기존 S 시나리오 LOT 는 사용하지 않는다. */
async function ensureIssue(woId: string, w: WoPlan) {
  if ((await prisma.inventoryTransaction.count({ where: { tenantId: TENANT_ID, refType: 'WORK_ORDER', refId: woId, txType: 'ISSUE' } })) > 0) return;
  const items = [];
  for (const r of requiredOf(w.itemCode, w.qty)) {
    const id = itemId(r.code); const wh = whOfItem(r.code);
    if (ctx.lotTracked.get(id)) {
      const balances = await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID, itemId: id, warehouseId: wh, qtyAvailable: { gt: 0 }, lotId: { not: null } }, include: { lot: true }, orderBy: { updatedAt: 'asc' } });
      const mine = balances.filter((b) => b.lotId && !ctx.existingLots.has(b.lotId)).sort((a, b) => a.lot!.createdAt.getTime() - b.lot!.createdAt.getTime());
      let remain = r.qty; const lots: Array<{ lotId: string; warehouseId: string; quantity: number }> = [];
      for (const b of mine) { if (remain <= 0) break; const take = Math.min(remain, num(b.qtyAvailable)); lots.push({ lotId: b.lotId!, warehouseId: wh, quantity: r6(take) }); remain = r6(remain - take); }
      if (remain > 0) fail(`시연 LOT 재고 부족: ${r.code} 필요 ${r.qty}, 부족 ${remain}`);
      items.push({ itemId: id, warehouseId: wh, lots, issueQty: r.qty, requiredQty: r.qty, reservationId: null });
    } else {
      items.push({ itemId: id, warehouseId: wh, issueQty: r.qty, requiredQty: r.qty, reservationId: null });
    }
  }
  const res = await at(w.issueAt, () => act.issue().issueMaterialsForWorkOrder({ workOrderId: woId, siteId: SITE_ID, requestId: `demo3m-issue-${woId}`, items }, TENANT_ID));
  if (!res.ok) fail(`자재출고 실패(${w.itemCode}): ${res.error}`);
}
async function stagedInspection(woId: string, seq: number, stage: 'FIRST' | 'MID' | 'FINAL', qty: number, t: number) {
  if (t > CUTOFF) return;
  const op = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: woId, seq }, include: { workOrder: true } });
  const spec = await prisma.inspectionSpec.findFirst({ where: { tenantId: TENANT_ID, itemId: op.workOrder.itemId, routingOperationId: op.routingOperationId, status: 'ACTIVE' } });
  if (!spec) return;
  await at(t, () => act.stage().createStagedInspection({ workOrderOperationId: op.id, inspectionSpecId: spec.id, stage, result: 'PASS', inspectedQty: qty, lotId: null }));
}

/** 마지막 공정이 검사 공정이면 최종검사 PASS(양품 수량)가 최소 1건 있어야 한다(복구용 포함). */
async function ensureLastFinal(woId: string, w: WoPlan, op: OpPlan, spec: { hasSpec: boolean }) {
  if (!needsFinalAtLast(w.itemCode, op.seq, spec.hasSpec)) return;
  const row = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: woId, seq: op.seq } });
  if ((await prisma.qualityInspection.count({ where: { workOrderOperationId: row.id, stage: 'FINAL', result: 'PASS' } })) > 0) return;
  const g = await prisma.productionResult.aggregate({ where: { workOrderOperationId: row.id }, _sum: { goodQty: true } });
  await stagedInspection(woId, op.seq, 'FINAL', num(g._sum.goodQty), addWork(op.endAt, 10));
}

/** 공정 한 개를 계획대로 실행한다(재실행 시 이미 등록된 실적 건수만큼 건너뜀). 반환: false = 기준 시각에 걸려 중단. */
async function runOp(woId: string, w: WoPlan, op: OpPlan, spec: { hasSpec: boolean; seq: number }): Promise<boolean> {
  const row = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: woId, seq: op.seq }, include: { assignments: { orderBy: { seq: 'asc' } } } });
  if (row.status === 'COMPLETED') { await ensureLastFinal(woId, w, op, spec); return true; }
  if (op.outsourced) return true; // 외주 공정은 별도 처리
  const asg = row.assignments[0]?.id ?? null;
  if (op.startAt > CUTOFF) return false;
  if (row.status === 'PENDING') {
    const s = await at(op.startAt, () => act.pop().startOperation(row.id, asg));
    if (!s.success) fail(`공정 시작 실패(${w.itemCode} seq ${op.seq}): ${s.error}`);
    if (spec.hasSpec && op.seq !== 1 && DEFECT_MODEL[w.itemCode]?.[op.seq]) await stagedInspection(woId, op.seq, 'FIRST', 2, addWork(op.startAt, 10)).catch((e) => fail(`초물검사 실패: ${e.message}`));
  }
  const done = await prisma.productionResult.count({ where: { workOrderOperationId: row.id } });
  const isFinal = FINAL_OP[w.itemCode] === op.seq;
  for (let i = done; i < op.results.length; i++) {
    const r = op.results[i];
    let t = r.at;
    let good = r.good; let defect = r.defect; let details = r.details;
    if (t > CUTOFF) { // 기준 시각에 걸리면 진행중으로 둔다(부분 실적)
      if (i === op.results.length - 1 && op.results.length === 1 && good > 20) { t = CUTOFF - 5 * 60000; good = Math.floor(good * 0.5); defect = 0; details = []; } else return false;
    }
    const res = await at(t, () => act.pop().submitProductionResult({
      workOrderOperationId: row.id, assignmentId: asg, goodQty: good, defectQty: defect, reworkQty: 0,
      defectDetails: details.map((d) => ({ defectCodeId: ctx.defect.get(d.code)!, qty: d.qty })) as never,
    }));
    if (!res.success) fail(`생산실적 실패(${w.itemCode} seq ${op.seq}): ${res.error}`);
    if (spec.hasSpec && (defect === 0 || needsFinalAtLast(w.itemCode, op.seq, spec.hasSpec))) await stagedInspection(woId, op.seq, op.seq === 1 ? 'FIRST' : isFinal ? 'FINAL' : 'MID', good, addWork(t, 5));
    if (t === CUTOFF - 5 * 60000) return false;
  }
  return true;
}
async function runOutsourcing(c: Case, wo: { id: string; orderNo: string }, op: OpPlan) {
  const opRow = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: wo.id, seq: op.seq } });
  if (opRow.status === 'COMPLETED') return true;
  const tag = tagOf(c.id, '-OUT');
  const sendAt = addWork(op.startAt, 20); const recvAt = addWork(sendAt, 2 * 8 * 60 + 100 * 0); const inspAt = addWork(recvAt, 90);
  if (sendAt > CUTOFF) return false;
  let order = await prisma.purchaseOrder.findFirst({ where: { tenantId: TENANT_ID, note: { contains: tag }, supplierId: partnerId('MAN-O02') } });
  if (!order) {
    await at(sendAt, () => act.out().createOutsourcingOrder({ supplierId: partnerId('MAN-O02'), outsourcingProcessName: '분체도장', expectedDate: iso(sendAt + 4 * DAY), note: `${tag} 시연용 가상 외주(CAP 분체도장)` }));
    order = await prisma.purchaseOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: tag }, supplierId: partnerId('MAN-O02') } });
  }
  const wip = await prisma.wipUnit.findFirstOrThrow({ where: { tenantId: TENANT_ID, workOrderId: wo.id, parentWipUnitId: null }, orderBy: { createdAt: 'asc' } });
  if (wip.status !== 'OUTSOURCED' && wip.status !== 'RECEIVED') await at(addWork(sendAt, 10), () => act.out().issueWipUnitToOutsourcing({ wipUnitId: wip.id, outsourcingOrderId: order!.id }));
  const w2 = await prisma.wipUnit.findFirstOrThrow({ where: { id: wip.id } });
  if (w2.status === 'OUTSOURCED') { if (recvAt > CUTOFF) return false; await at(recvAt, () => act.out().receiveWipUnitFromOutsourcing({ wipUnitId: wip.id, note: '시연용 가상 입고' })); }
  const w3 = await prisma.wipUnit.findFirstOrThrow({ where: { id: wip.id } });
  if (w3.status === 'RECEIVED') { if (inspAt > CUTOFF) return false; await at(inspAt, () => act.out().inspectOutsourcedWipUnit({ wipUnitId: wip.id, acceptedQty: num(w3.qty), defectQty: 0, reworkQty: 0, note: '시연용 가상 입고검사' })); }
  return true;
}

async function ensureReceipt(woId: string, w: WoPlan) {
  const last = await prisma.workOrderOperation.findFirst({ where: { workOrderId: woId }, orderBy: { seq: 'desc' } });
  if (!last || last.status !== 'COMPLETED' || w.receiptAt > CUTOFF) return null;
  const done = await prisma.finishedGoodsReceipt.aggregate({ where: { tenantId: TENANT_ID, workOrderId: woId }, _sum: { receiptQty: true } });
  const target = w.outQty;
  const sofar = num(done._sum.receiptQty);
  if (sofar >= target - 1e-9) return sofar;
  const wh = w.itemCode.startsWith('MAN-FG-') ? WH.FG : WH.WIP;
  const r = await at(w.receiptAt, () => act.fg().createFinishedGoodsReceiptAction({ workOrderId: woId, itemId: itemId(w.itemCode), siteId: SITE_ID, warehouseId: wh, receiptQty: target - sofar }, TENANT_ID));
  if (!r.ok) fail(`입고 실패(${w.itemCode}): ${r.error}`);
  return target;
}

/** WO 하나(반제품 또는 완제품)를 계획 시각 순으로 끝까지(기준 시각까지) 진행한다. */
async function driveWo(c: Case, planItemId: string, w: WoPlan): Promise<boolean> {
  if (w.woAt > CUTOFF) return false;
  const wo = await ensureWorkOrder(planItemId, w);
  const rec = manifest.cases[c.id]; if (!rec.woIds.includes(wo.id)) { rec.woIds.push(wo.id); saveManifest(); }
  if (w.issueAt > CUTOFF) return false;
  await ensureIssue(wo.id, w);
  const meta = ctx.routing.get(w.itemCode)!;
  for (const op of w.ops) {
    if (op.outsourced) {
      const prev = await prisma.workOrderOperation.findFirstOrThrow({ where: { workOrderId: wo.id, seq: op.seq - 1 } });
      if (prev.status !== 'COMPLETED') return false;
      if (!(await runOutsourcing(c, wo, op))) return false;
      continue;
    }
    const ok = await runOp(wo.id, w, op, meta.find((m) => m.seq === op.seq)!);
    if (!ok) return false;
  }
  const rcv = await ensureReceipt(wo.id, w);
  return rcv !== null;
}

async function runCase(c: Case) {
  manifest.cases[c.id] ??= { planIds: [], woIds: [], poIds: [] };
  const rec = manifest.cases[c.id];
  const fgCode = c.fg.itemCode;
  let fgPlanItemId: string; let so: Awaited<ReturnType<typeof ensureSalesOrder>> | null = null;
  if (c.mode === 'SO') {
    so = await ensureSalesOrder(c); rec.soId = so.id;
    const pi = await ensureProductionRequest(c, so); fgPlanItemId = pi.id; if (!rec.planIds.includes(pi.planId)) rec.planIds.push(pi.planId);
  } else {
    const plan = await ensureStockPlan(tagOf(c.id), c.soAt, [{ item: fgCode, qty: c.qty }], c.soAt + 7 * DAY);
    fgPlanItemId = plan.items[0].id; if (!rec.planIds.includes(plan.id)) rec.planIds.push(plan.id);
  }
  if (c.semis.length) {
    const lines = c.semis.map((s) => ({ item: s.itemCode, qty: s.qty }));
    const sfPlan = await ensureStockPlan(tagOf(c.id, '-SF'), addWork(c.soAt, 90), lines, c.soAt + 5 * DAY);
    if (!rec.planIds.includes(sfPlan.id)) rec.planIds.push(sfPlan.id);
    for (const s of c.semis) { const pi = sfPlan.items.find((i) => i.itemId === itemId(s.itemCode))!; if (!(await driveWo(c, pi.id, s))) { saveManifest(); return 'semi-wip'; } }
  }
  const finished = await driveWo(c, fgPlanItemId, c.fg);
  saveManifest();
  if (!finished) return 'wip';
  if (so && c.ship) {
    const tag = tagOf(c.id, '-SHIP');
    let ship = await prisma.shipmentOrder.findFirst({ where: { tenantId: TENANT_ID, note: { contains: tag } } });
    if (!ship) {
      const woRow = await prisma.workOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, productionPlanItemId: fgPlanItemId, status: { not: 'CANCELLED' } } });
      const lot = await prisma.finishedGoodsReceipt.findFirstOrThrow({ where: { tenantId: TENANT_ID, workOrderId: woRow.id }, orderBy: { receiptAt: 'desc' } });
      if (!lot.lotId) fail('완제품 LOT 가 없습니다.');
      const qty = num((await prisma.finishedGoodsReceipt.aggregate({ where: { tenantId: TENANT_ID, workOrderId: woRow.id }, _sum: { receiptQty: true } }))._sum.receiptQty);
      await at(c.ship.planAt, () => act.ship().createShipment(TENANT_ID, { salesOrderId: so!.id, plannedDate: dateOf(c.ship!.planAt), warehouseId: WH.FG, note: `${tag} 시연용 가상 출하`, items: [{ salesOrderItemId: so!.items[0].id, itemId: itemId(fgCode), qty, lotId: lot.lotId! }] }));
      ship = await prisma.shipmentOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, note: { contains: tag } } });
    }
    if (ship.status === 'PLANNED') await at(c.ship.at, () => act.ship().confirmShipment(ship!.id));
    rec.shipmentId = ship.id; saveManifest();
  }
  return 'done';
}

async function runPurchase(p: PurchasePlan) {
  manifest.purchases ??= {};
  const tag = `[DEMO3M:${p.key}]`;
  let po = await prisma.purchaseOrder.findFirst({ where: { tenantId: TENANT_ID, supplierId: partnerId(p.supplier), note: { contains: tag } }, include: { items: true } });
  if (!po) {
    const total = p.lines.reduce((s, l) => s + l.qty * l.price, 0);
    const res = await at(p.orderAt, () => act.po().createPurchaseOrder(TENANT_ID, SITE_ID, { supplierId: partnerId(p.supplier), orderDate: dateOf(p.orderAt), expectedDate: dateOf(p.receiptAt), status: 'ORDERED', totalAmount: total, currency: 'KRW', note: `${tag} 시연용 가상 구매발주`, items: p.lines.map((l) => ({ itemId: itemId(l.item), qty: l.qty, unitPrice: l.price })) }));
    if (!res.success) fail(`구매발주 실패(${p.key}): ${(res as { error?: string }).error}`);
    po = await prisma.purchaseOrder.findFirstOrThrow({ where: { tenantId: TENANT_ID, supplierId: partnerId(p.supplier), note: { contains: tag } }, include: { items: true } });
  }
  manifest.purchases[p.key] = { poId: po.id };
  for (const line of p.lines) {
    const poItem = po.items.find((x) => x.itemId === itemId(line.item))!;
    const fresh = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: poItem.id } });
    const parts = p.split ? [Math.round(line.qty * 0.6 / STEP[line.item]) * STEP[line.item], 0] : [line.qty];
    if (p.split) parts[1] = line.qty - parts[0];
    let recvd = num(fresh.receivedQty);
    let cum = 0;
    for (const [i, part] of parts.entries()) {
      cum += part;
      if (recvd >= cum - 1e-9 || part <= 0) continue;
      const t = i === 0 ? p.receiptAt : addWork(p.receiptAt, 2 * 8 * 60);
      if (t > CUTOFF) continue;
      const r = await at(t, () => act.rcv().createReceivingInspection({
        purchaseOrderItemId: poItem.id, purchaseOrderId: po!.id, warehouseId: WH.RAW, siteId: SITE_ID, inspectorId: ctx.admin.profileId,
        receivedQty: cum - recvd, acceptedQty: cum - recvd, rejectedQty: 0, result: 'PASS', note: `${tag} 입고검사 합격`,
        requestId: `demo3m-${p.key}-${line.item.toLowerCase().replace(/[^a-z0-9]/g, '')}-${i}`.padEnd(16, '0'),
      }));
      if (!r.success) fail(`입고 실패(${p.key}/${line.item}): ${r.message}`);
      recvd = cum;
    }
  }
}

// ─── 계획 요약 출력 ───────────────────────────────────────────────────────────
function summarize(cases: Case[], purchases: PurchasePlan[]) {
  const wos = cases.flatMap((c) => [...c.semis, c.fg]);
  console.log(`\n  [계획] 케이스 ${cases.length}건 / 작업지시 ${wos.length}건 (완제품 ${cases.length}, 반제품 ${cases.reduce((s, c) => s + c.semis.length, 0)}) / 구매발주 ${purchases.length}건`);
  console.log(`         수주 연결 ${cases.filter((c) => c.mode === 'SO').length}건, 재고생산 ${cases.filter((c) => c.mode === 'STOCK').length}건, 출하 예정 ${cases.filter((c) => c.ship).length}건, 외주(CAP 분체도장) ${cases.filter((c) => c.outsource).length}건`);
  const byMonth = new Map<string, { n: number; plan: number; good: number; defect: number; processed: number }>();
  for (const c of cases) {
    const m = kstKey(c.fg.ops[0].startAt).slice(0, 7); const e = byMonth.get(m) ?? { n: 0, plan: 0, good: 0, defect: 0, processed: 0 };
    e.n++; e.plan += c.qty; e.good += c.fg.outQty; e.defect += c.defectTotal;
    for (const o of c.fg.ops) for (const r of o.results) e.processed += r.good + r.defect;
    byMonth.set(m, e);
  }
  for (const [m, e] of [...byMonth].sort()) console.log(`         ${m}  WO ${e.n}건  계획 ${e.plan}  최종양품 ${e.good}  불량 ${e.defect}  (공정 처리량 대비 ${(e.defect / Math.max(1, e.processed) * 100).toFixed(2)}%)`);
  const first = Math.min(...wos.map((w) => w.woAt)), last = Math.max(...wos.flatMap((w) => w.ops.map((o) => o.endAt)));
  console.log(`         작업지시 기간 ${new RealDate(first + KST).toISOString().slice(0, 16)} ~ ${new RealDate(last + KST).toISOString().slice(0, 16)} (KST)  / 기준 시각 이후 단계는 진행중으로 남김`);
  const tot = new Map<string, number>(); for (const p of purchases) for (const l of p.lines) tot.set(l.item, (tot.get(l.item) ?? 0) + l.qty);
  console.log(`         원자재 발주 합계: ${[...tot].map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

async function snapshotBaseline(): Promise<Manifest['baseline']> {
  const lots = await prisma.inventoryBalance.findMany({ where: { tenantId: TENANT_ID, lotId: { in: [...ctx.existingLots] } }, select: { lotId: true, qtyOnHand: true } });
  const box = await prisma.inventoryBalance.findFirst({ where: { tenantId: TENANT_ID, itemId: itemId('MAN-CS-BOX'), lotId: null } });
  const woOps: Record<string, string> = {};
  for (const wo of await prisma.workOrder.findMany({ where: { id: { in: manifest.existing.workOrderIds } }, include: { operations: true } })) woOps[wo.orderNo] = `${wo.status}|${num(wo.plannedQty)}|` + wo.operations.sort((a, b) => a.seq - b.seq).map((o) => `${o.status}:${num(o.completedQty)}`).join(',');
  const counts: Record<string, number> = {
    results: await prisma.productionResult.count({ where: { workOrderOperation: { workOrderId: { in: manifest.existing.workOrderIds } } } }),
    inspections: await prisma.qualityInspection.count({ where: { workOrderOperation: { workOrderId: { in: manifest.existing.workOrderIds } } } }),
    issueTx: await prisma.inventoryTransaction.count({ where: { refType: 'WORK_ORDER', refId: { in: manifest.existing.workOrderIds }, txType: 'ISSUE' } }),
  };
  return { lotBalances: Object.fromEntries(lots.map((l) => [l.lotId!, num(l.qtyOnHand)])), boxBalance: num(box?.qtyOnHand), woOps, counts };
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n[demo3m] 모드=${MODE} 대상=${TARGET}(${TARGETS[TARGET].host}:${TARGETS[TARGET].port}/${TARGETS[TARGET].db}) 테넌트=${TENANT_ID}`);
  await loadShiftTables();
  await initMaster();
  const cases = buildCases();
  const purchases = buildPurchases(cases);
  summarize(cases, purchases);
  if (MODE === 'dry-run') { console.log('\n[demo3m] dry-run 완료 — DB 쓰기 없음.'); return; }
  if (MODE === 'verify') { const { verifyAll } = await import('./seed-manual-3months-verify'); process.exitCode = (await verifyAll({ prisma, TENANT_ID, manifestFile: MANIFEST_FILE, ctx })) ? 0 : 1; return; }
  // apply
  if (fs.existsSync(MANIFEST_FILE)) manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  else {
    const exLots = await prisma.lot.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } });
    manifest = { version: 1, target: TARGET, createdAt: new RealDate().toISOString(), existing: { lotIds: exLots.map((l) => l.id), workOrderIds: (await prisma.workOrder.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } })).map((x) => x.id), salesOrderIds: (await prisma.salesOrder.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } })).map((x) => x.id), poIds: (await prisma.purchaseOrder.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } })).map((x) => x.id), planIds: (await prisma.productionPlan.findMany({ where: { tenantId: TENANT_ID }, select: { id: true } })).map((x) => x.id) }, baseline: { lotBalances: {}, boxBalance: 0, woOps: {}, counts: {} }, cases: {}, purchases: {}, mrp: {} };
    ctx.existingLots = new Set(manifest.existing.lotIds);
    manifest.baseline = await snapshotBaseline();
    saveManifest();
    log(`baseline 저장: 기존 LOT ${exLots.length}, 작업지시 ${manifest.existing.workOrderIds.length}`);
  }
  ctx.existingLots = new Set(manifest.existing.lotIds);
  const t0 = RealDate.now();
  if (PHASE === 'history' || PHASE === 'all') {
    let n = 0;
    for (const p of purchases) { await runPurchase(p); n++; if (n % 5 === 0) log(`구매발주 ${n}/${purchases.length}`); }
    let i = 0; const stat: Record<string, number> = {};
    for (const c of cases) {
      if (ONLY && !ONLY.includes(c.id)) continue;
      if (i++ >= LIMIT) break;
      const s = await runCase(c); stat[s] = (stat[s] ?? 0) + 1;
      log(`${c.id} ${c.kind} ${c.qty} ${c.mode} → ${s}  (${((RealDate.now() - t0) / 1000).toFixed(0)}s)`);
    }
    log(`케이스 결과: ${JSON.stringify(stat)}`);
  }
  if (PHASE === 'mrp' || PHASE === 'all') {
    try { const { applyMrp } = await import('./seed-manual-3months-mrp'); await applyMrp({ useReal: () => setSim(RealDate.now()), prisma, TENANT_ID, ctx, at, act, manifest, saveManifest, itemId, partnerId, SITE_ID, WH, iso, dateOf, requiredOf, STEP }); simOffset = 0; }
    catch (e) { if ((e as { code?: string }).code === 'MODULE_NOT_FOUND') log('MRP 단계 모듈이 아직 없습니다(건너뜀).'); else throw e; }
  }
  console.log(`\n[demo3m] apply 완료 (${((RealDate.now() - t0) / 1000).toFixed(0)}s)`);
}
main().catch((e) => { console.error('\n[demo3m] 실패:', e instanceof Error ? (process.env.DEMO3M_STACK ? e.stack : e.message) : e); process.exitCode = 1; }).finally(async () => { simOffset = 0; await prisma.$disconnect().catch(() => undefined); });
