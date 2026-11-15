/**
 * 매뉴얼 로컬 환경 화면 검증(읽기 전용): 로컬 관리자 세션(JWT)으로 로컬 서버(기본 http://127.0.0.1:3001)의 화면을 열어
 * 시나리오 데이터가 보이는지 확인하고 스크린샷을 남긴다. 로컬 DB/서버 외에는 접속하지 않는다.
 * 실행: TS_NODE_TRANSPILE_ONLY=1 npx ts-node --compiler-options "{\"module\":\"commonjs\",\"moduleResolution\":\"node\",\"target\":\"es2020\"}" --project tsconfig.json scripts/manual-ui-verify.ts [스크린샷 폴더]
 */
import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { assertLocalTarget } from '../prisma/manual-seed-guard';
import { PrismaClient } from '@prisma/client';

const tenant = assertLocalTarget();
const BASE = process.env.UI_BASE ?? 'http://127.0.0.1:3001';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) throw new Error('로컬 서버가 아닙니다.');
const OUT = process.argv[2] ?? path.resolve(__dirname, '..', 'tmp-ui');
fs.mkdirSync(OUT, { recursive: true });

type Spec = { name: string; url: string; expect: string[]; denied?: boolean; click?: string[] };
const PAGES: Spec[] = [
  { name: '대시보드(숨김 라우트)', url: '/app/mes/dashboard', expect: [], denied: true },
  { name: '홈(/app/mes)', url: '/app/mes', expect: [] },
  { name: '모니터링 현황', url: '/app/lms/monitoring/status', expect: [] },
  { name: '거래처-고객', url: '/app/mes/customers', expect: ['한빛플랜트(가상)', '새롬설비(가상)', '미래산업(가상)'] },
  { name: '거래처-공급·외주', url: '/app/mes/vendors', expect: ['대한강재(가상)', '정열열처리(가상)', '고운도장(가상)'] },
  { name: '품목', url: '/app/mes/items', expect: ['MAN-FG-NRV01', 'MAN-FG-PIPE01', 'MAN-RM-PLATE', 'MAN-CS-BOX'] },
  { name: '품목단가(숨김 라우트)', url: '/app/mes/item-prices', expect: [], denied: true },
  { name: 'BOM', url: '/app/mes/bom', expect: ['MAN-FG-NRV01', 'MAN-SF-NRV-BODY'] },
  { name: '라우팅', url: '/app/mes/routing', expect: ['MAN-RT-NRV', 'MAN-RT-PIPE', 'MAN-RT-CAP'] },
  { name: '작업장', url: '/app/mes/work-centers', expect: ['WC-WELD', 'WC-COAT', 'WC-OUTS', 'WC-MACH'] },
  { name: '설비', url: '/app/mes/master/equipment', expect: ['CNC-1', 'CNC-8', 'CNC-9', 'MCT-6'] },
  { name: '검사기준', url: '/app/mes/master/inspection-standards', expect: ['MAN-FG-NRV01', 'MAN-FG-PIPE01'] },
  { name: 'LOT·제조번호 규칙', url: '/app/mes/lot-rules', expect: [] },
  { name: '수주관리', url: '/app/mes/sales-orders', expect: ['SO-2026-001', 'SO-2026-002', 'SO-2026-003'] },
  { name: '생산계획', url: '/app/mes/production-plan', expect: ['PP-REQ-20261111-001', 'PP-2026-W46'] },
  { name: 'MRP(조회 실행)', url: '/app/mes/mrp', expect: ['MAN-RM-NRV-BAR'], click: ['조회 / MRP 실행'] },
  { name: '구매발주', url: '/app/mes/purchase-orders', expect: ['PO-2026-000001', 'PO-2026-000004', 'PO-2026-000005'] },
  { name: '자재입고', url: '/app/mes/material-receipt', expect: [] },
  { name: '재고현황(자재)', url: '/app/mes/material/stock', expect: ['MAN-RM-NRV-BAR'] },
  { name: '재고현황', url: '/app/mes/inventory', expect: ['MAN-'] },
  { name: '재고수불', url: '/app/mes/inventory-transactions', expect: ['MAN-'] },
  { name: '작업지시', url: '/app/mes/work-orders', expect: ['WO-2026-001', 'WO-2026-008', 'MFG-2611-0003'] },
  { name: 'POP 작업선택', url: '/pop/work-select', expect: [] },
  { name: '생산진행현황', url: '/app/mes/process-progress', expect: ['WO-2026-004'] },
  { name: '생산실적', url: '/app/mes/production-results', expect: ['WO-2026-003'] },
  { name: '재공재고(WIP)', url: '/app/mes/production/wip-inventory', expect: ['MFG-2611-'] },
  { name: '외주관리', url: '/app/mes/production/outsourcing', expect: ['고운도장'] },
  { name: '단계별검사', url: '/app/mes/inspection-stages', expect: [] },
  { name: '최종검사', url: '/app/mes/final-inspection', expect: [] },
  { name: '재작업관리', url: '/app/mes/rework', expect: ['MFG-2611-0007'] },
  { name: '완제품 입고', url: '/app/mes/finished-goods-receipt', expect: [] },
  { name: '출하관리(출하 목록)', url: '/app/mes/shipments', expect: ['SH-2026-001'], click: ['출하 목록'] },
  { name: 'LOT 관리', url: '/app/mes/lot', expect: ['MFG-2611-0003'] },
  { name: '추적성(정추적)', url: '/app/mes/traceability', expect: [] },
  { name: '추적성(역추적)', url: '/app/mes/trace-reverse', expect: [] },
  { name: 'LOT 이력', url: '/app/mes/lot-history', expect: [] },
  { name: '제조이력추적(개발자 전용)', url: '/app/mes/manufacturing-traceability', expect: [], denied: true },
];

async function main() {
  const prisma = new PrismaClient();
  const cred = await prisma.userCredential.findFirst({
    where: { tenantId: tenant, NOT: { loginId: 'test' }, profile: { tenantUsers: { some: { tenantId: tenant, role: 'OWNER', isActive: true } } } },
    include: { profile: true },
  });
  await prisma.$disconnect();
  if (!cred) throw new Error('로컬 관리자를 찾을 수 없습니다.');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const jwtLib = require('../src/lib/jwt') as typeof import('../src/lib/jwt');
  const token = jwtLib.signAuthToken({ profileId: cred.profileId, tenantId: tenant, loginId: cred.loginId, email: cred.profile.email, name: cred.profile.name, role: 'OWNER', mustChangePw: false });
  const browser = await chromium.launch({ channel: process.env.UI_CHANNEL ?? 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, locale: 'ko-KR' });
  await context.addCookies([{ name: jwtLib.NMES_SESSION_COOKIE, value: token, url: BASE }]);
  const page = await context.newPage();
  const rows: Array<{ name: string; status: string; detail: string }> = [];
  for (const p of PAGES) {
    try {
      const resp = await page.goto(BASE + p.url, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(800);
      for (const label of p.click ?? []) {
        await page.getByRole('button', { name: label }).first().click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2500);
      }
      const finalUrl = new URL(page.url()).pathname;
      const text = (await page.locator('body').innerText()).split(/\s+/).join(' ');
      const code = resp?.status() ?? 0;
      const base = `${String(rows.length + 1).padStart(2, '0')}-${p.name.replace(/[^\w가-힣]/g, '_')}`;
      await page.screenshot({ path: path.join(OUT, `${base}.png`) });
      fs.writeFileSync(path.join(OUT, `${base}.txt`), text);
      const missing = p.expect.filter((e) => !text.includes(e));
      const notFound = code === 404 || /페이지를 찾을 수 없|not found|404/i.test(text.slice(0, 400));
      const redirected = finalUrl !== p.url;
      if (p.denied) rows.push({ name: p.name, status: notFound || redirected ? 'DENIED(예상)' : 'OPEN', detail: `HTTP ${code} ${finalUrl}` });
      else if (redirected || code >= 400 || notFound) rows.push({ name: p.name, status: 'FAIL', detail: `HTTP ${code} → ${finalUrl}` });
      else if (missing.length) rows.push({ name: p.name, status: 'MISSING', detail: `없음: ${missing.join(', ')}` });
      else rows.push({ name: p.name, status: 'OK', detail: p.expect.length ? `확인 ${p.expect.length}건 표시` : `HTTP ${code} 렌더링(본문 ${text.length}자)` });
    } catch (e) {
      rows.push({ name: p.name, status: 'ERROR', detail: (e instanceof Error ? e.message : String(e)).split('\n')[0] });
    }
  }
  await browser.close();
  for (const r of rows) console.log(`${r.status.padEnd(14)} ${r.name.padEnd(24)} ${r.detail}`);
  if (rows.some((r) => ['FAIL', 'MISSING', 'ERROR'].includes(r.status))) process.exitCode = 1;
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
