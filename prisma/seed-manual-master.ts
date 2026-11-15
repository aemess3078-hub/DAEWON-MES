/**
 * 대원정밀 MES 사용자 매뉴얼 제작용 기준정보 seed (로컬 매뉴얼 DB 전용)
 *
 * 이 파일은 prisma/seed-daewon.ts 를 대체/수정하지 않는다. 기본 seed 가 끝난 로컬 매뉴얼 DB 위에
 * 매뉴얼·업무 테스트용 "기준정보"만 추가한다. (구매/입고/생산계획/작업지시/POP/외주/출하 이력은 만들지 않는다.)
 *
 * 생성: 거래처 / 품목분류 / 품목 / 품목-공급업체 / BOM / 라우팅(+품목연결) / 설비(+공정매핑) / 검사기준 / LOT·제조번호 규칙
 * 모든 값은 가상 테스트 데이터이며 코드는 MAN- 접두어(설비만 사용자가 지정한 CNC-1 등)로 식별한다.
 * 실제 대원정밀 거래처·단가·규격이 아니다.
 *
 * 안전장치: DATABASE_URL / DIRECT_URL 이 모두 127.0.0.1:5432/daewon_mes_manual 이 아니거나,
 *          DEFAULT_TENANT_ID 가 tenant-daewon-manual 이 아니면 DB 접속 전에 중단한다. 접속 문자열은 출력하지 않는다.
 *
 * 실행:
 *   npx ts-node --compiler-options "{\"module\":\"commonjs\",\"target\":\"es2020\"}" --project tsconfig.json prisma/seed-manual-master.ts          # 적용
 *   npx ts-node ... prisma/seed-manual-master.ts --verify                                                                 # 조회/관계 검증만(쓰기 없음)
 *
 * 멱등: 자연키 upsert. 단일 트랜잭션이라 실패 시 전부 롤백. 삭제는 하지 않는다.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// ─── 안전장치 (DB 접속 전) ────────────────────────────────────────────────────

const EXPECT = { host: '127.0.0.1', port: '5432', db: 'daewon_mes_manual', tenant: 'tenant-daewon-manual' } as const;

function loadDotEnv() {
  // DEFAULT_TENANT_ID 는 Next.js 규칙대로 .env.local 에 있다. 이미 설정된 process.env 값이 우선이고,
  // 여기서 채운 process.env 값을 Prisma 도 그대로 사용하므로 검증한 값과 실제 접속 대상이 일치한다.
  for (const name of ['.env.local', '.env']) {
    const file = path.resolve(__dirname, '..', name);
    if (!fs.existsSync(file)) continue;
    for (const rawLine of fs.readFileSync(file, "utf8").split(String.fromCharCode(10))) { const line = rawLine.trim();
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#]*?)"?\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

function assertLocalTarget(): string {
  loadDotEnv();
  for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
    const raw = process.env[name];
    if (!raw) throw new Error(`[manual-seed] ${name} 가 없습니다. 중단합니다.`);
    let u: URL;
    try { u = new URL(raw); } catch { throw new Error(`[manual-seed] ${name} 형식을 해석할 수 없습니다. 중단합니다.`); }
    const dbName = u.pathname.replace(/^\//, '');
    if (u.hostname !== EXPECT.host || (u.port || '5432') !== EXPECT.port || dbName !== EXPECT.db) {
      throw new Error(`[manual-seed] ${name} 대상이 로컬 매뉴얼 DB(${EXPECT.host}:${EXPECT.port}/${EXPECT.db})가 아닙니다. 중단합니다.`);
    }
  }
  const tenant = process.env.DEFAULT_TENANT_ID?.trim();
  if (tenant !== EXPECT.tenant) {
    throw new Error(`[manual-seed] DEFAULT_TENANT_ID 가 ${EXPECT.tenant} 가 아닙니다. 중단합니다.`);
  }
  return tenant;
}

const TENANT_ID = assertLocalTarget();
const VERIFY_ONLY = process.argv.includes('--verify');
const prisma = new PrismaClient();

// ─── 고정 참조 (기본 seed 가 만든 값) ─────────────────────────────────────────

const SITE_ID = 'site-daewon-factory-001';
const WC = {
  MACH: 'wc-daewon-machining-001',
  INSP: 'wc-daewon-inspection-001',
  WASH: 'wc-daewon-washing-001',
  PACK: 'wc-daewon-packaging-001',
} as const;
const WH = { RAW: 'wh-daewon-raw-001', WIP: 'wh-daewon-wip-001', FG: 'wh-daewon-fg-001' } as const;

const TEST_TAG = '[매뉴얼 테스트용 가상 데이터]';

// ─── 데이터 정의 ──────────────────────────────────────────────────────────────

type PartnerDef = { code: string; name: string; type: 'CUSTOMER' | 'SUPPLIER'; bizNo: string; ceo: string; phone: string; contact: string; remark: string };
const PARTNERS: PartnerDef[] = [
  { code: 'MAN-C01', name: '한빛플랜트(가상)', type: 'CUSTOMER', bizNo: '000-00-00001', ceo: '김가상', phone: '02-0000-0001', contact: '이담당', remark: `${TEST_TAG} 고객사 — NON-RETURN VALVE 수주 시나리오용` },
  { code: 'MAN-C02', name: '새롬설비(가상)', type: 'CUSTOMER', bizNo: '000-00-00002', ceo: '박가상', phone: '02-0000-0002', contact: '최담당', remark: `${TEST_TAG} 고객사 — PIPE 수주 시나리오용` },
  { code: 'MAN-C03', name: '미래산업(가상)', type: 'CUSTOMER', bizNo: '000-00-00003', ceo: '정가상', phone: '02-0000-0003', contact: '강담당', remark: `${TEST_TAG} 고객사 — PROTECTIVE CAP 수주 시나리오용` },
  { code: 'MAN-S01', name: '대한강재(가상)', type: 'SUPPLIER', bizNo: '000-00-00011', ceo: '오가상', phone: '031-000-0011', contact: '윤담당', remark: `${TEST_TAG} 원자재 공급사 — 강관·봉강` },
  { code: 'MAN-S02', name: '동양철판(가상)', type: 'SUPPLIER', bizNo: '000-00-00012', ceo: '서가상', phone: '031-000-0012', contact: '임담당', remark: `${TEST_TAG} 원자재 공급사 — 철판·분체도료` },
  { code: 'MAN-S03', name: '삼정포장자재(가상)', type: 'SUPPLIER', bizNo: '000-00-00013', ceo: '한가상', phone: '031-000-0013', contact: '조담당', remark: `${TEST_TAG} 부자재 공급사 — 포장박스` },
  { code: 'MAN-O01', name: '정열열처리(가상)', type: 'SUPPLIER', bizNo: '000-00-00021', ceo: '신가상', phone: '032-000-0021', contact: '배담당', remark: `${TEST_TAG} 외주가공업체 — 열처리` },
  { code: 'MAN-O02', name: '고운도장(가상)', type: 'SUPPLIER', bizNo: '000-00-00022', ceo: '문가상', phone: '032-000-0022', contact: '홍담당', remark: `${TEST_TAG} 외주가공업체 — 분체도장` },
];

type ItemType = 'RAW_MATERIAL' | 'SEMI_FINISHED' | 'FINISHED' | 'CONSUMABLE';
type Uom = 'EA' | 'KG' | 'M';
const CATEGORIES: Array<{ code: string; name: string; itemType: ItemType; order: number }> = [
  { code: 'MAN-CAT-RM', name: '[매뉴얼] 원자재', itemType: 'RAW_MATERIAL', order: 901 },
  { code: 'MAN-CAT-SF', name: '[매뉴얼] 반제품', itemType: 'SEMI_FINISHED', order: 902 },
  { code: 'MAN-CAT-FG', name: '[매뉴얼] 완제품', itemType: 'FINISHED', order: 903 },
  { code: 'MAN-CAT-CS', name: '[매뉴얼] 부자재', itemType: 'CONSUMABLE', order: 904 },
];
const CAT_BY_TYPE: Record<ItemType, string> = { RAW_MATERIAL: 'MAN-CAT-RM', SEMI_FINISHED: 'MAN-CAT-SF', FINISHED: 'MAN-CAT-FG', CONSUMABLE: 'MAN-CAT-CS' };
const WH_BY_TYPE: Record<ItemType, string> = { RAW_MATERIAL: WH.RAW, CONSUMABLE: WH.RAW, SEMI_FINISHED: WH.WIP, FINISHED: WH.FG };

type ItemDef = { code: string; name: string; type: ItemType; uom: Uom; spec: string; lot: boolean; safety: number };
const ITEMS: ItemDef[] = [
  { code: 'MAN-FG-NRV01', name: 'NON-RETURN VALVE', type: 'FINISHED', uom: 'EA', spec: '[가상 규격] 체크밸브 테스트 모델 / 용접·도장형', lot: true, safety: 0 },
  { code: 'MAN-FG-PIPE01', name: 'PIPE', type: 'FINISHED', uom: 'EA', spec: '[가상 규격] 강관 절단·가공품 / 길이 250mm 테스트값', lot: true, safety: 0 },
  { code: 'MAN-FG-CAP01', name: 'PROTECTIVE CAP', type: 'FINISHED', uom: 'EA', spec: '[가상 규격] 보호캡 / 원형 판재 가공·분체도장', lot: true, safety: 0 },
  { code: 'MAN-SF-NRV-BODY', name: 'NRV 밸브 바디(가공)', type: 'SEMI_FINISHED', uom: 'EA', spec: '[가상 규격] 봉강 CNC 가공 바디', lot: true, safety: 0 },
  { code: 'MAN-SF-NRV-DISC', name: 'NRV 디스크(가공)', type: 'SEMI_FINISHED', uom: 'EA', spec: '[가상 규격] 철판 가공 디스크', lot: true, safety: 0 },
  { code: 'MAN-SF-CAP-DISC', name: 'CAP 원판(절단·가공)', type: 'SEMI_FINISHED', uom: 'EA', spec: '[가상 규격] 철판 절단 후 원형·센터홀 가공 원판', lot: true, safety: 0 },
  { code: 'MAN-RM-PIPE-STK', name: '강관 원재(PIPE용)', type: 'RAW_MATERIAL', uom: 'M', spec: '[가상 규격] 탄소강관 길이단위 구매', lot: true, safety: 40 },
  { code: 'MAN-RM-PLATE', name: '철판 원재', type: 'RAW_MATERIAL', uom: 'KG', spec: '[가상 규격] 탄소강 판재 t3.0 중량단위 구매', lot: true, safety: 150 },
  { code: 'MAN-RM-NRV-BAR', name: '봉강 원재(밸브 바디용)', type: 'RAW_MATERIAL', uom: 'KG', spec: '[가상 규격] 탄소강 봉강 중량단위 구매', lot: true, safety: 200 },
  { code: 'MAN-CS-POWDER', name: '분체도료', type: 'CONSUMABLE', uom: 'KG', spec: '[가상 규격] 에폭시 분체도료 회색', lot: true, safety: 20 },
  { code: 'MAN-CS-BOX', name: '포장박스', type: 'CONSUMABLE', uom: 'EA', spec: '[가상 규격] 골판지 박스 (다품 포장)', lot: false, safety: 50 },
];

// 상위 품목 → 구성품(소요량 qtyPer, 손실률 scrapRate). 다단계: NRV/CAP → 반제품 → 원자재
type BomDef = { parent: string; version: string; lines: Array<{ comp: string; qty: number; scrap: number }> };
const BOMS: BomDef[] = [
  { parent: 'MAN-FG-PIPE01', version: '1.0', lines: [{ comp: 'MAN-RM-PIPE-STK', qty: 0.25, scrap: 0.02 }, { comp: 'MAN-CS-BOX', qty: 0.05, scrap: 0 }] },
  { parent: 'MAN-FG-CAP01', version: '1.0', lines: [{ comp: 'MAN-SF-CAP-DISC', qty: 1, scrap: 0.01 }, { comp: 'MAN-CS-POWDER', qty: 0.02, scrap: 0.1 }, { comp: 'MAN-CS-BOX', qty: 0.04, scrap: 0 }] },
  { parent: 'MAN-SF-CAP-DISC', version: '1.0', lines: [{ comp: 'MAN-RM-PLATE', qty: 0.15, scrap: 0.05 }] },
  { parent: 'MAN-FG-NRV01', version: '1.0', lines: [{ comp: 'MAN-SF-NRV-BODY', qty: 1, scrap: 0 }, { comp: 'MAN-SF-NRV-DISC', qty: 1, scrap: 0 }, { comp: 'MAN-CS-POWDER', qty: 0.05, scrap: 0.1 }, { comp: 'MAN-CS-BOX', qty: 0.1, scrap: 0 }] },
  { parent: 'MAN-SF-NRV-BODY', version: '1.0', lines: [{ comp: 'MAN-RM-NRV-BAR', qty: 2.5, scrap: 0.03 }] },
  { parent: 'MAN-SF-NRV-DISC', version: '1.0', lines: [{ comp: 'MAN-RM-PLATE', qty: 0.4, scrap: 0.04 }] },
];

// 품목 ↔ 공급업체 (MRP 발주제안 테스트용: 기본 1개 + 대체 1개)
const ITEM_SUPPLIERS: Array<{ item: string; partner: string; isDefault: boolean; priority: number; leadDays: number; moq: number; multiple: number }> = [
  { item: 'MAN-RM-PIPE-STK', partner: 'MAN-S01', isDefault: true, priority: 100, leadDays: 5, moq: 20, multiple: 10 },
  { item: 'MAN-RM-NRV-BAR', partner: 'MAN-S01', isDefault: true, priority: 100, leadDays: 7, moq: 100, multiple: 50 },
  { item: 'MAN-RM-PLATE', partner: 'MAN-S02', isDefault: true, priority: 100, leadDays: 4, moq: 100, multiple: 25 },
  { item: 'MAN-RM-PLATE', partner: 'MAN-S01', isDefault: false, priority: 200, leadDays: 8, moq: 200, multiple: 50 },
  { item: 'MAN-CS-POWDER', partner: 'MAN-S02', isDefault: true, priority: 100, leadDays: 3, moq: 10, multiple: 5 },
  { item: 'MAN-CS-BOX', partner: 'MAN-S03', isDefault: true, priority: 100, leadDays: 2, moq: 100, multiple: 50 },
];

// 라우팅: 공정(단계)별 작업장. 표준시간은 분 단위 테스트값.
type OpDef = { name: string; wc: keyof typeof WC; min: number };
type RoutingDef = { code: string; name: string; item: string; ops: OpDef[]; note: string };
const ROUTINGS: RoutingDef[] = [
  {
    code: 'MAN-RT-PIPE', name: 'PIPE 제조 라우팅', item: 'MAN-FG-PIPE01',
    note: '실제 공정자료 기반 대표 시나리오(공정 순서). 표준시간은 가상값',
    ops: [
      { name: '원자재 검사', wc: 'INSP', min: 10 },
      { name: 'PIPE 절단', wc: 'MACH', min: 3 },
      { name: '절단면 다듬기', wc: 'MACH', min: 2 },
      { name: '앞부분 가공 및 지름검사', wc: 'MACH', min: 5 },
      { name: '뒷부분 가공 및 높이검사', wc: 'MACH', min: 5 },
      { name: '완제품 검사', wc: 'INSP', min: 2 },
      { name: '세척·개별포장', wc: 'WASH', min: 2 },
      { name: '박스포장', wc: 'PACK', min: 1 },
    ],
  },
  {
    code: 'MAN-RT-CAP', name: 'PROTECTIVE CAP 제조 라우팅', item: 'MAN-FG-CAP01',
    note: '실제 공정자료 기반 대표 시나리오(공정 순서). 분체도장은 기존 작업장 중 세척 작업장에 배정(별도 도장 작업장 없음). 표준시간은 가상값',
    ops: [
      { name: '원자재 검사', wc: 'INSP', min: 10 },
      { name: '철판 절단', wc: 'MACH', min: 3 },
      { name: '원형·센터홀 가공', wc: 'MACH', min: 4 },
      { name: '헤라시보리 가공 및 검사', wc: 'MACH', min: 6 },
      { name: '분체도장', wc: 'WASH', min: 8 },
      { name: '박스포장', wc: 'PACK', min: 1 },
    ],
  },
  {
    code: 'MAN-RT-NRV', name: 'NON-RETURN VALVE 제조 라우팅(테스트 구성)', item: 'MAN-FG-NRV01',
    note: '[테스트용 구성] 실제 공정 순서 미확인. 가공·용접·외주(열처리·도장)·검사·포장 테스트 목적. 열처리/도장 외주는 외주관리에서 외주처(MAN-O01/O02) 선택',
    ops: [
      { name: '[테스트] 부품 조립 준비·용접', wc: 'MACH', min: 15 },
      { name: '[테스트] 열처리 (외주)', wc: 'MACH', min: 0 },
      { name: '[테스트] 도장 (외주)', wc: 'WASH', min: 0 },
      { name: '[테스트] 완제품 검사(외관·기능)', wc: 'INSP', min: 10 },
      { name: '[테스트] 세척', wc: 'WASH', min: 5 },
      { name: '[테스트] 포장', wc: 'PACK', min: 3 },
    ],
  },
  {
    code: 'MAN-RT-NRV-BODY', name: 'NRV 밸브 바디 가공 라우팅(테스트 구성)', item: 'MAN-SF-NRV-BODY',
    note: '[테스트용 구성] 반제품 라우팅. 실제 공정 미확인. 표준시간은 가상값',
    ops: [
      { name: '[테스트] 소재 검사', wc: 'INSP', min: 8 },
      { name: '[테스트] 봉강 절단', wc: 'MACH', min: 4 },
      { name: '[테스트] CNC 가공', wc: 'MACH', min: 20 },
      { name: '[테스트] 가공 치수검사', wc: 'INSP', min: 5 },
    ],
  },
];

// 설비(테스트용, 외부 연동 없음 — NCWatch/PLC/게이트웨이 연결 안 함)
const EQUIPMENTS: Array<{ code: string; name: string; maps: Array<{ routing: string; seq: number }> }> = [
  { code: 'CNC-1', name: 'CNC 선반 1호기(테스트)', maps: [{ routing: 'MAN-RT-PIPE', seq: 2 }, { routing: 'MAN-RT-PIPE', seq: 3 }, { routing: 'MAN-RT-CAP', seq: 2 }] },
  { code: 'CNC-8', name: 'CNC 선반 8호기(테스트)', maps: [{ routing: 'MAN-RT-PIPE', seq: 4 }, { routing: 'MAN-RT-CAP', seq: 3 }] },
  { code: 'CNC-9', name: 'CNC 선반 9호기(테스트)', maps: [{ routing: 'MAN-RT-PIPE', seq: 5 }, { routing: 'MAN-RT-CAP', seq: 4 }] },
  { code: 'MCT-6', name: '머시닝센터 6호기(테스트)', maps: [{ routing: 'MAN-RT-NRV-BODY', seq: 2 }, { routing: 'MAN-RT-NRV-BODY', seq: 3 }, { routing: 'MAN-RT-NRV', seq: 1 }] },
];

// 검사기준: (품목, 라우팅 공정) 단위. 규격/한계값은 전부 가상 테스트값.
type InspItem = { name: string; type: 'NUMERIC' | 'TEXT' | 'BOOLEAN' | 'SELECT'; lo?: number; hi?: number; unit?: string };
type SpecDef = { item: string; routing: string; seq: number; label: string; items: InspItem[] };
const RAW_VISUAL: InspItem[] = [
  { name: '[테스트] 표면 녹·스크래치 유무(외관)', type: 'BOOLEAN' },
  { name: '[테스트] 성적서·재질 일치 확인', type: 'BOOLEAN' },
];
const SPECS: SpecDef[] = [
  { item: 'MAN-FG-PIPE01', routing: 'MAN-RT-PIPE', seq: 1, label: '원자재 외관검사', items: RAW_VISUAL },
  { item: 'MAN-FG-PIPE01', routing: 'MAN-RT-PIPE', seq: 4, label: '앞부분 지름 치수검사', items: [{ name: '[테스트] 앞부분 외경', type: 'NUMERIC', lo: 59.9, hi: 60.1, unit: 'mm' }] },
  { item: 'MAN-FG-PIPE01', routing: 'MAN-RT-PIPE', seq: 5, label: '뒷부분 높이 치수검사', items: [{ name: '[테스트] 전체 높이', type: 'NUMERIC', lo: 249.8, hi: 250.2, unit: 'mm' }] },
  {
    item: 'MAN-FG-PIPE01', routing: 'MAN-RT-PIPE', seq: 6, label: '완제품 외관·기능검사',
    items: [{ name: '[테스트] 외관(버·찍힘) 유무', type: 'BOOLEAN' }, { name: '[테스트] 내경 통과 확인(기능)', type: 'BOOLEAN' }],
  },
  { item: 'MAN-FG-CAP01', routing: 'MAN-RT-CAP', seq: 1, label: '원자재 외관검사', items: RAW_VISUAL },
  { item: 'MAN-FG-CAP01', routing: 'MAN-RT-CAP', seq: 4, label: '헤라시보리 가공 치수검사', items: [{ name: '[테스트] 외경', type: 'NUMERIC', lo: 79.8, hi: 80.2, unit: 'mm' }, { name: '[테스트] 센터홀 직경', type: 'NUMERIC', lo: 9.9, hi: 10.1, unit: 'mm' }] },
  { item: 'MAN-SF-NRV-BODY', routing: 'MAN-RT-NRV-BODY', seq: 1, label: '원자재 외관검사', items: RAW_VISUAL },
  { item: 'MAN-SF-NRV-BODY', routing: 'MAN-RT-NRV-BODY', seq: 4, label: '가공 치수검사', items: [{ name: '[테스트] 바디 내경', type: 'NUMERIC', lo: 49.9, hi: 50.1, unit: 'mm' }, { name: '[테스트] 바디 길이', type: 'NUMERIC', lo: 119.7, hi: 120.3, unit: 'mm' }] },
  {
    item: 'MAN-FG-NRV01', routing: 'MAN-RT-NRV', seq: 4, label: '완제품 외관·기능검사',
    items: [
      { name: '[테스트] 도장 외관(얼룩·박리) 유무', type: 'BOOLEAN' },
      { name: '[테스트] 역류방지 기능(누설 없음)', type: 'BOOLEAN' },
      { name: '[테스트] 시험압력 유지', type: 'NUMERIC', lo: 1.5, hi: 2.0, unit: 'MPa' },
    ],
  },
];

// 번호 규칙: 시스템은 LOT / SERIAL(제조번호) 2종만 지원(테넌트당 1건). 문서번호(PO/수주/계획/작업지시/출하)는 코드에서 자동 생성되어 규칙 테이블이 없다.
const NUMBERING_RULES: Array<{ type: 'LOT' | 'SERIAL'; tokens: Prisma.InputJsonValue }> = [
  { type: 'LOT', tokens: [{ id: 'm1', type: 'CONTEXT', key: 'ITEM_CODE' }, { id: 'm2', type: 'DATE', format: 'YY' }, { id: 'm3', type: 'DATE', format: 'MM' }, { id: 'm4', type: 'SEPARATOR', value: '-' }, { id: 'm5', type: 'SEQ', digits: 3 }] },
  { type: 'SERIAL', tokens: [{ id: 'm1', type: 'FIXED', value: 'MFG' }, { id: 'm2', type: 'SEPARATOR', value: '-' }, { id: 'm3', type: 'DATE', format: 'YY' }, { id: 'm4', type: 'DATE', format: 'MM' }, { id: 'm5', type: 'SEPARATOR', value: '-' }, { id: 'm6', type: 'SEQ', digits: 4 }] },
];

// ─── 사전 검증 (순수 함수, DB 불필요) ─────────────────────────────────────────

function validateStatic() {
  const codes = new Set(ITEMS.map((i) => i.code));
  const byCode = new Map(ITEMS.map((i) => [i.code, i]));
  const adj = new Map<string, string[]>();
  for (const b of BOMS) {
    if (!codes.has(b.parent)) throw new Error(`BOM 상위 품목 없음: ${b.parent}`);
    const p = byCode.get(b.parent)!;
    if (p.type !== 'FINISHED' && p.type !== 'SEMI_FINISHED') throw new Error(`BOM 상위는 완제품/반제품이어야 함: ${b.parent}`);
    const seen = new Set<string>();
    for (const l of b.lines) {
      if (!codes.has(l.comp)) throw new Error(`BOM 구성품 없음: ${l.comp}`);
      if (l.comp === b.parent) throw new Error(`BOM 자기참조: ${b.parent}`);
      if (seen.has(l.comp)) throw new Error(`BOM 구성품 중복: ${b.parent}/${l.comp}`);
      if (byCode.get(l.comp)!.type === 'FINISHED') throw new Error(`완제품은 구성품 불가: ${l.comp}`);
      if (!(l.qty > 0) || l.scrap < 0 || l.scrap >= 1) throw new Error(`BOM 수량/손실률 범위 오류: ${b.parent}/${l.comp}`);
      seen.add(l.comp);
    }
    adj.set(b.parent, b.lines.map((l) => l.comp));
  }
  // 순환 참조 검사 (DFS 3색)
  const state = new Map<string, 1 | 2>();
  const visit = (n: string, stack: string[]) => {
    if (state.get(n) === 2) return;
    if (state.get(n) === 1) throw new Error(`BOM 순환 참조: ${[...stack, n].join(' → ')}`);
    state.set(n, 1);
    for (const c of adj.get(n) ?? []) visit(c, [...stack, n]);
    state.set(n, 2);
  };
  for (const k of adj.keys()) visit(k, []);
  const routingByCode = new Map(ROUTINGS.map((r) => [r.code, r]));
  for (const r of ROUTINGS) if (!codes.has(r.item)) throw new Error(`라우팅 품목 없음: ${r.item}`);
  for (const e of EQUIPMENTS) for (const m of e.maps) {
    const r = routingByCode.get(m.routing);
    if (!r || m.seq < 1 || m.seq > r.ops.length) throw new Error(`설비 공정매핑 오류: ${e.code}/${m.routing}/${m.seq}`);
    if (r.ops[m.seq - 1].wc !== 'MACH') throw new Error(`설비 ${e.code} 는 가공 작업장 공정에만 매핑해야 함: ${m.routing}/${m.seq}`);
  }
  for (const s of SPECS) {
    const r = routingByCode.get(s.routing);
    if (!r || s.seq < 1 || s.seq > r.ops.length) throw new Error(`검사기준 공정 오류: ${s.item}/${s.routing}/${s.seq}`);
    if (r.item !== s.item) throw new Error(`검사기준 품목이 라우팅 품목과 다름: ${s.item}/${s.routing}`);
    if (!['INSP', 'MACH'].includes(r.ops[s.seq - 1].wc)) throw new Error(`검사기준은 검사/가공(공정내 검사) 작업장 공정에 연결해야 함: ${s.routing}/${s.seq}`);
    for (const it of s.items) if (it.type === 'NUMERIC' && !(it.lo! < it.hi!)) throw new Error(`검사항목 한계값 오류: ${it.name}`);
  }
  for (const is of ITEM_SUPPLIERS) if (!codes.has(is.item) || !PARTNERS.some((p) => p.code === is.partner && p.type === 'SUPPLIER')) throw new Error(`품목-공급업체 참조 오류: ${is.item}/${is.partner}`);
}

// ─── 적용 ─────────────────────────────────────────────────────────────────────

type Tally = Record<string, { created: number; updated: number }>;
const tally: Tally = {};
const bump = (k: string, existed: boolean) => {
  (tally[k] ??= { created: 0, updated: 0 })[existed ? 'updated' : 'created']++;
};

async function apply(tx: Prisma.TransactionClient) {
  // 선행 조건: 기본 seed 결과 존재 확인
  const tenant = await tx.tenant.findUnique({ where: { id: TENANT_ID } });
  if (!tenant) throw new Error('Tenant 가 없습니다. 기본 seed 를 먼저 실행하세요.');
  const site = await tx.site.findUnique({ where: { id: SITE_ID } });
  if (!site || site.tenantId !== TENANT_ID) throw new Error('Site 가 없습니다.');
  for (const id of Object.values(WC)) if (!(await tx.workCenter.findUnique({ where: { id } }))) throw new Error(`WorkCenter 없음: ${id}`);
  for (const id of Object.values(WH)) if (!(await tx.warehouse.findUnique({ where: { id } }))) throw new Error(`Warehouse 없음: ${id}`);

  // 거래처
  const partnerId = new Map<string, string>();
  for (const p of PARTNERS) {
    const where = { tenantId_code: { tenantId: TENANT_ID, code: p.code } };
    const existed = !!(await tx.businessPartner.findUnique({ where }));
    const data = {
      name: p.name, partnerType: p.type, status: 'ACTIVE' as const, businessNumber: p.bizNo, ceoName: p.ceo, phone: p.phone,
      email: `${p.code.toLowerCase()}@example.invalid`, address: '가상 주소 (매뉴얼 테스트용)', contactName: p.contact, contactPhone: p.phone, remark: p.remark,
    };
    const row = await tx.businessPartner.upsert({ where, create: { tenantId: TENANT_ID, code: p.code, ...data }, update: data });
    partnerId.set(p.code, row.id);
    bump('거래처', existed);
  }

  // 품목분류
  const catId = new Map<string, string>();
  for (const c of CATEGORIES) {
    const where = { tenantId_code: { tenantId: TENANT_ID, code: c.code } };
    const existed = !!(await tx.itemCategory.findUnique({ where }));
    const row = await tx.itemCategory.upsert({
      where, create: { tenantId: TENANT_ID, code: c.code, name: c.name, itemType: c.itemType, displayOrder: c.order }, update: { name: c.name, itemType: c.itemType, displayOrder: c.order },
    });
    catId.set(c.code, row.id);
    bump('품목분류', existed);
  }

  // 품목
  const itemId = new Map<string, string>();
  for (const i of ITEMS) {
    const where = { tenantId_code: { tenantId: TENANT_ID, code: i.code } };
    const existed = !!(await tx.item.findUnique({ where }));
    const data = {
      name: i.name, itemType: i.type, uom: i.uom, spec: i.spec, status: 'ACTIVE' as const, categoryId: catId.get(CAT_BY_TYPE[i.type])!,
      isLotTracked: i.lot, isSerialTracked: false, lotNumberingType: 'DEFAULT' as const, lotPrefix: null, manualLotPolicy: 'ALLOWED' as const,
      defaultWarehouseId: WH_BY_TYPE[i.type], safetyStock: i.safety,
    };
    const row = await tx.item.upsert({ where, create: { tenantId: TENANT_ID, code: i.code, ...data }, update: data });
    itemId.set(i.code, row.id);
    bump('품목', existed);
  }

  // 품목-공급업체
  for (const s of ITEM_SUPPLIERS) {
    const where = { tenantId_itemId_supplierId: { tenantId: TENANT_ID, itemId: itemId.get(s.item)!, supplierId: partnerId.get(s.partner)! } };
    const existed = !!(await tx.itemSupplier.findUnique({ where }));
    const data = { isDefault: s.isDefault, priority: s.priority, leadTimeDays: s.leadDays, moq: s.moq, orderMultiple: s.multiple, isActive: true };
    await tx.itemSupplier.upsert({ where, create: { tenantId: TENANT_ID, itemId: itemId.get(s.item)!, supplierId: partnerId.get(s.partner)!, ...data }, update: data });
    bump('품목-공급업체', existed);
  }

  // BOM
  for (const b of BOMS) {
    const where = { tenantId_itemId_version: { tenantId: TENANT_ID, itemId: itemId.get(b.parent)!, version: b.version } };
    const existed = !!(await tx.bOM.findUnique({ where }));
    const bom = await tx.bOM.upsert({
      where, create: { tenantId: TENANT_ID, itemId: itemId.get(b.parent)!, version: b.version, isDefault: true, status: 'ACTIVE' }, update: { isDefault: true, status: 'ACTIVE' },
    });
    bump('BOM', existed);
    for (const [idx, l] of b.lines.entries()) {
      const w = { bomId_seq: { bomId: bom.id, seq: idx + 1 } };
      const ex = !!(await tx.bOMItem.findUnique({ where: w }));
      const d = { componentItemId: itemId.get(l.comp)!, qtyPer: l.qty, scrapRate: l.scrap };
      await tx.bOMItem.upsert({ where: w, create: { bomId: bom.id, seq: idx + 1, ...d }, update: d });
      bump('BOM 구성품', ex);
    }
    // 시드 정의에 없는 잔여 라인(이전 실행 잔재)은 이 seed 소유 BOM 에 한해 정리하지 않고 검증 단계에서 경고한다.
  }

  // 라우팅 + 공정 + 품목연결
  const opId = new Map<string, string>(); // `${routing}:${seq}`
  for (const r of ROUTINGS) {
    const where = { tenantId_code: { tenantId: TENANT_ID, code: r.code } };
    const existed = !!(await tx.routing.findUnique({ where }));
    const routing = await tx.routing.upsert({
      where, create: { tenantId: TENANT_ID, code: r.code, name: r.name, version: '1.0', status: 'ACTIVE', scope: 'ITEM_SPECIFIC' }, update: { name: r.name, version: '1.0', status: 'ACTIVE', scope: 'ITEM_SPECIFIC' },
    });
    bump('라우팅', existed);
    for (const [idx, o] of r.ops.entries()) {
      const seq = idx + 1;
      const w = { routingId_seq: { routingId: routing.id, seq } };
      const ex = !!(await tx.routingOperation.findUnique({ where: w }));
      const d = { workCenterId: WC[o.wc], operationCode: `OP${String(seq * 10).padStart(2, '0')}`, name: o.name, standardTime: o.min };
      const op = await tx.routingOperation.upsert({ where: w, create: { routingId: routing.id, seq, ...d }, update: d });
      opId.set(`${r.code}:${seq}`, op.id);
      bump('라우팅 공정', ex);
    }
    const lw = { itemId_routingId: { itemId: itemId.get(r.item)!, routingId: routing.id } };
    const lex = !!(await tx.itemRouting.findUnique({ where: lw }));
    await tx.itemRouting.upsert({ where: lw, create: { tenantId: TENANT_ID, itemId: itemId.get(r.item)!, routingId: routing.id, isDefault: true }, update: { isDefault: true } });
    bump('품목-라우팅 연결', lex);
  }

  // 설비 + 공정 매핑
  for (const e of EQUIPMENTS) {
    const where = { siteId_code: { siteId: SITE_ID, code: e.code } };
    const existed = !!(await tx.equipment.findUnique({ where }));
    const d = { name: e.name, equipmentType: 'MACHINE' as const, status: 'ACTIVE' as const, workCenterId: WC.MACH };
    const eq = await tx.equipment.upsert({ where, create: { tenantId: TENANT_ID, siteId: SITE_ID, code: e.code, ...d }, update: d });
    bump('설비', existed);
    for (const m of e.maps) {
      const w = { equipmentId_routingOperationId: { equipmentId: eq.id, routingOperationId: opId.get(`${m.routing}:${m.seq}`)! } };
      const ex = !!(await tx.equipmentOperationMap.findUnique({ where: w }));
      await tx.equipmentOperationMap.upsert({ where: w, create: { equipmentId: eq.id, routingOperationId: w.equipmentId_routingOperationId.routingOperationId }, update: {} });
      bump('설비-공정 매핑', ex);
    }
  }

  // 검사기준
  for (const s of SPECS) {
    const where = { tenantId_itemId_routingOperationId_version: { tenantId: TENANT_ID, itemId: itemId.get(s.item)!, routingOperationId: opId.get(`${s.routing}:${s.seq}`)!, version: '1.0' } };
    const existed = !!(await tx.inspectionSpec.findUnique({ where }));
    const spec = await tx.inspectionSpec.upsert({
      where, create: { tenantId: TENANT_ID, itemId: where.tenantId_itemId_routingOperationId_version.itemId, routingOperationId: where.tenantId_itemId_routingOperationId_version.routingOperationId, version: '1.0', status: 'ACTIVE' }, update: { status: 'ACTIVE' },
    });
    bump('검사기준', existed);
    for (const [idx, it] of s.items.entries()) {
      const w = { inspectionSpecId_seq: { inspectionSpecId: spec.id, seq: idx + 1 } };
      const ex = !!(await tx.inspectionItem.findUnique({ where: w }));
      const d = { name: it.name, inputType: it.type, lowerLimit: it.lo ?? null, upperLimit: it.hi ?? null, unit: it.unit ?? null };
      await tx.inspectionItem.upsert({ where: w, create: { inspectionSpecId: spec.id, seq: idx + 1, ...d }, update: d });
      bump('검사항목', ex);
    }
  }

  // 번호 규칙 (테넌트·유형당 1건). 이미 있으면 사용자가 구성한 규칙이므로 덮어쓰지 않는다.
  for (const n of NUMBERING_RULES) {
    const where = { tenantId_type: { tenantId: TENANT_ID, type: n.type } };
    const existing = await tx.numberingRule.findUnique({ where });
    if (existing) {
      bump(`채번규칙(${n.type})`, true);
      console.log(`    - ${n.type} 규칙이 이미 있어 변경하지 않습니다.`);
      continue;
    }
    await tx.numberingRule.create({ data: { tenantId: TENANT_ID, type: n.type, tokens: n.tokens, isActive: true } });
    bump(`채번규칙(${n.type})`, false);
  }
}

// ─── 관계 검증 (읽기 전용) ────────────────────────────────────────────────────

async function verify(): Promise<boolean> {
  let ok = true;
  const check = (cond: boolean, msg: string) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) ok = false; };
  const codeLike = { startsWith: 'MAN-' };

  const partners = await prisma.businessPartner.findMany({ where: { tenantId: TENANT_ID, code: codeLike } });
  check(partners.length === PARTNERS.length, `거래처 ${partners.length}/${PARTNERS.length} (고객 ${partners.filter((p) => p.partnerType === 'CUSTOMER').length}, 공급/외주 ${partners.filter((p) => p.partnerType === 'SUPPLIER').length})`);
  const items = await prisma.item.findMany({ where: { tenantId: TENANT_ID, code: codeLike } });
  check(items.length === ITEMS.length, `품목 ${items.length}/${ITEMS.length} (${(['FINISHED', 'SEMI_FINISHED', 'RAW_MATERIAL', 'CONSUMABLE'] as const).map((t) => `${t} ${items.filter((i) => i.itemType === t).length}`).join(', ')})`);
  check(items.every((i) => i.categoryId && i.defaultWarehouseId), '모든 품목에 분류·기본창고 연결');
  check(items.some((i) => /NON-RETURN VALVE|PIPE|PROTECTIVE CAP/.test(i.name)) && ['NON-RETURN VALVE', 'PIPE', 'PROTECTIVE CAP'].every((n) => items.some((i) => i.name === n && i.itemType === 'FINISHED')), '완제품 3종 존재(한글 이름 포함 UTF-8 검증은 아래)');
  check(items.some((i) => i.name === 'NRV 밸브 바디(가공)') && partners.some((p) => p.name === '한빛플랜트(가상)'), '한글 UTF-8 왕복 저장 확인');

  const boms = await prisma.bOM.findMany({ where: { tenantId: TENANT_ID, item: { code: codeLike } }, include: { item: true, bomItems: { include: { componentItem: true }, orderBy: { seq: 'asc' } } } });
  check(boms.length === BOMS.length, `BOM ${boms.length}/${BOMS.length}`);
  for (const b of BOMS) {
    const row = boms.find((x) => x.item.code === b.parent);
    const match = !!row && row.status === 'ACTIVE' && row.bomItems.length === b.lines.length && b.lines.every((l, i) => row.bomItems[i].componentItem.code === l.comp && Number(row.bomItems[i].qtyPer) === l.qty);
    check(match, `BOM ${b.parent} 구성 일치 (${b.lines.map((l) => l.comp.replace('MAN-', '')).join(', ')})`);
  }
  // DB 기준 순환 참조/다단계 검사 + 전개 출력
  const adj = new Map(boms.map((b) => [b.item.code, b.bomItems.map((x) => ({ code: x.componentItem.code, qty: Number(x.qtyPer) }))]));
  const state = new Map<string, number>();
  let cyc = false;
  const dfs = (n: string) => { if (state.get(n) === 2) return; if (state.get(n) === 1) { cyc = true; return; } state.set(n, 1); for (const c of adj.get(n) ?? []) dfs(c.code); state.set(n, 2); };
  for (const k of adj.keys()) dfs(k);
  check(!cyc, 'DB BOM 순환 참조 없음');
  const explode = (code: string, mult: number, depth: number, out: string[]) => {
    for (const c of adj.get(code) ?? []) { out.push(`${'  '.repeat(depth)}${c.code} × ${+(mult * c.qty).toFixed(6)}`); explode(c.code, mult * c.qty, depth + 1, out); }
  };
  for (const fg of ['MAN-FG-NRV01', 'MAN-FG-CAP01']) { const out: string[] = []; explode(fg, 1, 1, out); console.log(`    ${fg} 1EA 전개:\n      ${out.join('\n      ')}`); }

  const routings = await prisma.routing.findMany({ where: { tenantId: TENANT_ID, code: codeLike }, include: { operations: { include: { workCenter: true }, orderBy: { seq: 'asc' } }, items: { include: { item: true } } } });
  check(routings.length === ROUTINGS.length, `라우팅 ${routings.length}/${ROUTINGS.length}`);
  for (const r of ROUTINGS) {
    const row = routings.find((x) => x.code === r.code);
    const match = !!row && row.status === 'ACTIVE' && row.operations.length === r.ops.length && r.ops.every((o, i) => row.operations[i].seq === i + 1 && row.operations[i].name === o.name && row.operations[i].workCenterId === WC[o.wc]) && row.items.length === 1 && row.items[0].item.code === r.item && row.items[0].isDefault;
    check(match, `라우팅 ${r.code}: ${row?.operations.map((o) => `${o.seq}.${o.name}[${o.workCenter.code}]`).join(' → ')}`);
  }

  const eqs = await prisma.equipment.findMany({ where: { tenantId: TENANT_ID, code: { in: EQUIPMENTS.map((e) => e.code) } }, include: { workCenter: true, operationMaps: { include: { routingOperation: { include: { routing: true } } } } } });
  check(eqs.length === EQUIPMENTS.length && eqs.every((e) => e.workCenter.kind === 'MACHINING' && e.status === 'ACTIVE' && e.equipmentType === 'MACHINE'), `설비 ${eqs.length}/${EQUIPMENTS.length} — 가공 작업장/ACTIVE/MACHINE`);
  for (const e of eqs) console.log(`    ${e.code} → ${e.operationMaps.map((m) => `${m.routingOperation.routing.code}#${m.routingOperation.seq}`).join(', ')}`);
  check((await prisma.equipmentConnection.count({ where: { equipment: { code: { in: EQUIPMENTS.map((e) => e.code) }, tenantId: TENANT_ID } } })) === 0 && (await prisma.ncwatchEquipmentMapping.count({ where: { equipment: { code: { in: EQUIPMENTS.map((e) => e.code) }, tenantId: TENANT_ID } } })) === 0, '설비 외부 연동(EquipmentConnection/NCWatch 매핑) 없음');

  const specs = await prisma.inspectionSpec.findMany({ where: { tenantId: TENANT_ID, item: { code: codeLike } }, include: { item: true, routingOperation: { include: { routing: true, workCenter: true } }, inspectionItems: true } });
  check(specs.length === SPECS.length, `검사기준 ${specs.length}/${SPECS.length} (검사항목 ${specs.reduce((a, s) => a + s.inspectionItems.length, 0)})`);
  check(specs.every((s) => s.status === 'ACTIVE' && ['INSPECTION', 'MACHINING'].includes(s.routingOperation.workCenter.kind) && s.routingOperation.routing.code.startsWith('MAN-RT-')), '검사기준 모두 ACTIVE · 검사(또는 공정내 검사가 있는 가공) 공정에 연결');

  const rules = await prisma.numberingRule.findMany({ where: { tenantId: TENANT_ID } });
  check(['LOT', 'SERIAL'].every((t) => rules.some((r) => r.type === t && r.isActive)), `채번규칙 ${rules.map((r) => r.type).join(', ')} 활성`);

  const sup = await prisma.itemSupplier.findMany({ where: { tenantId: TENANT_ID, item: { code: codeLike } }, include: { item: true } });
  const defaults = new Map<string, number>();
  sup.filter((s) => s.isActive && s.isDefault).forEach((s) => defaults.set(s.item.code, (defaults.get(s.item.code) ?? 0) + 1));
  check(sup.length === ITEM_SUPPLIERS.length && [...defaults.values()].every((n) => n === 1), `품목-공급업체 ${sup.length}/${ITEM_SUPPLIERS.length}, 품목당 기본 공급사 1개`);
  const purchasable = items.filter((i) => i.itemType === 'RAW_MATERIAL' || i.itemType === 'CONSUMABLE');
  check(purchasable.every((i) => defaults.has(i.code)), '원자재·부자재 전부 기본 공급사 보유(MRP 발주제안 가능)');
  return ok;
}

async function snapshotCounts() {
  const q = async (sql: string) => Number((await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(sql))[0].n);
  return {
    Profile: await q('select count(*) n from "Profile"'),
    UserCredential: await q('select count(*) n from "UserCredential"'),
    WorkCenter: await q('select count(*) n from "WorkCenter"'),
    Warehouse: await q('select count(*) n from "Warehouse"'),
    DefectCode: await q('select count(*) n from "DefectCode"'),
    RolePermission: await q('select count(*) n from "RolePermission"'),
  };
}

async function main() {
  console.log(`▶ 매뉴얼 기준정보 seed ${VERIFY_ONLY ? '(검증만)' : '(적용)'} — ${EXPECT.host}:${EXPECT.port}/${EXPECT.db}, tenant=${TENANT_ID}`);
  validateStatic();
  console.log('  ✓ 정적 검증 통과 (BOM 순환/자기참조/중복, 라우팅·설비·검사기준 참조)');
  if (VERIFY_ONLY) {
    const ok = await verify();
    if (!ok) process.exitCode = 1;
    return;
  }
  const before = await snapshotCounts();
  await prisma.$transaction(apply, { timeout: 120_000, maxWait: 10_000 });
  const after = await snapshotCounts();
  console.log('\n  === 생성/갱신 건수 ===');
  for (const [k, v] of Object.entries(tally)) console.log(`  ${k.padEnd(18)} 신규 ${v.created}  갱신(기존 동일 코드) ${v.updated}`);
  const untouched = JSON.stringify(before) === JSON.stringify(after);
  console.log(`\n  기존 기본 seed 데이터(Profile/UserCredential/WorkCenter/Warehouse/DefectCode/RolePermission) 건수 변동 없음: ${untouched ? 'YES' : 'NO ' + JSON.stringify({ before, after })}`);
  console.log('\n  === 관계 검증 ===');
  const ok = await verify();
  if (!ok) { process.exitCode = 1; console.error('✗ 검증 실패 항목이 있습니다.'); } else console.log('\n✅ 완료');
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); }).finally(() => prisma.$disconnect());
