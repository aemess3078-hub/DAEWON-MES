/**
 * 대원정밀 MES 전용 초기 seed (기준 골격만 — 데모/타 고객사 데이터 없음)
 *
 * NMES 데모 seed(prisma/seed.ts)는 데모 계정, 데모 품목/BOM/라우팅, 의료 추적성 데모 데이터를 만들기 때문에
 * 대원정밀 저장소에서 제거되었다. 이 파일이 유일한 운영 seed 이다.
 *
 * 생성하는 것:
 *   Tenant / Site / 최초 관리자(Profile, TenantUser=OWNER, UserCredential) /
 *   개발자 계정 test (SEED_DEVELOPER_PASSWORD 가 있을 때, OWNER, 전역) /
 *   공정(WorkCenter) / 창고·로케이션 / 기본 불량코드 / 공통코드 / RolePermission /
 *   FeatureDefinition(+의존성) / TenantFeature
 *
 * 생성하지 않는 것 (근거 자료 확보 전까지 의도적으로 비워 둠):
 *   품목, BOM, 라우팅, 검사기준, 설비, 거래처, LOT/Serial 번호 규칙(NumberingRule)
 *   → docs/DAEWON-TODO.md 참고
 *
 * 필수 환경변수 (값은 코드/저장소에 두지 않는다):
 *   DEFAULT_TENANT_ID        앱이 사용하는 Tenant ID 와 동일해야 한다(그대로 Tenant.id 로 사용).
 *   SEED_ADMIN_LOGIN_ID      최초 관리자 로그인 ID
 *   SEED_ADMIN_PASSWORD      최초 관리자 비밀번호(8자 이상). bcrypt 해시만 저장. 이 계정은 mustChangePw=false(운영 정책)
 *   DAEWON_SEED_CONFIRM=YES  실수로 실행되는 것을 막는 확인 플래그
 *
 * 선택:
 *   SEED_ADMIN_NAME, SEED_ADMIN_EMAIL
 *   SEED_DEVELOPER_LOGIN_ID(기본 test, 반드시 test), SEED_DEVELOPER_PASSWORD(8자 이상) — 개발/유지보수 전용 계정
 *
 * 개발자 계정만 추가(이미 seed 된 DB 에서 기준정보는 건드리지 않음):
 *   SEED_ONLY=developer 로 실행하면 Tenant 존재만 확인하고 개발자 계정 단계만 수행한다(관리자 변수 불필요).
 *
 * 실행(고객 Supabase 확보 및 migrate deploy 완료 후에만):
 *   npm run db:seed
 *
 * 멱등성: 모두 upsert / skipDuplicates 이며, 이미 존재하는 관리자 비밀번호는 덮어쓰지 않는다.
 */
import bcrypt from 'bcryptjs';
import {
  PrismaClient,
  TenantStatus,
  UserRole,
  SiteType,
  WorkCenterKind,
  DefectCategory,
} from '@prisma/client';
import { FEATURE_CATALOG, FEATURE_DEPENDENCIES } from './seed-data/feature-catalog';
import { ensureDefaultPermissions } from '../src/lib/auth/permission-init';
import { DAEWON_OUT_OF_SCOPE_RESOURCES } from '../src/lib/auth/permission-catalog';

const prisma = new PrismaClient();

// ─── 환경변수 / 안전장치 ──────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`[seed-daewon] 필수 환경변수 ${name} 가 설정되지 않았습니다.`);
  return v;
}

const ONLY_DEVELOPER = process.env.SEED_ONLY?.trim().toLowerCase() === 'developer';
const TENANT_ID = requireEnv('DEFAULT_TENANT_ID');
const ADMIN_LOGIN_ID = ONLY_DEVELOPER ? '' : requireEnv('SEED_ADMIN_LOGIN_ID').toLowerCase();
const ADMIN_PASSWORD = ONLY_DEVELOPER ? '' : requireEnv('SEED_ADMIN_PASSWORD');

// 개발자 계정: src/lib/developer.ts 가 loginId === 'test' 로 개발자 여부를 판정한다. 비밀번호는 환경변수로만 받는다(소스에 두지 않음).
const DEVELOPER_LOGIN_ID = 'test';
const DEVELOPER_LOGIN_ID_INPUT = (process.env.SEED_DEVELOPER_LOGIN_ID?.trim() || DEVELOPER_LOGIN_ID).toLowerCase();
const DEVELOPER_PASSWORD = process.env.SEED_DEVELOPER_PASSWORD ?? '';

if (process.env.DAEWON_SEED_CONFIRM !== 'YES') {
  throw new Error('[seed-daewon] DAEWON_SEED_CONFIRM=YES 가 필요합니다. (대상 DB 를 확인한 뒤 설정)');
}
if (TENANT_ID === 'tenant-demo-001') {
  throw new Error('[seed-daewon] DEFAULT_TENANT_ID 가 NMES 데모 값(tenant-demo-001)입니다. 대원정밀 전용 ID 를 사용하세요.');
}
if (!ONLY_DEVELOPER && ADMIN_PASSWORD.length < 8) {
  throw new Error('[seed-daewon] SEED_ADMIN_PASSWORD 는 8자 이상이어야 합니다.');
}
if (DEVELOPER_LOGIN_ID_INPUT !== DEVELOPER_LOGIN_ID) {
  throw new Error("[seed-daewon] SEED_DEVELOPER_LOGIN_ID 는 'test' 여야 합니다(개발자 판정이 loginId 기준).");
}
if (ONLY_DEVELOPER && !DEVELOPER_PASSWORD) {
  throw new Error('[seed-daewon] SEED_ONLY=developer 에는 SEED_DEVELOPER_PASSWORD 가 필요합니다.');
}
if (DEVELOPER_PASSWORD && DEVELOPER_PASSWORD.length < 8) {
  throw new Error('[seed-daewon] SEED_DEVELOPER_PASSWORD 는 8자 이상이어야 합니다.');
}

// 고정 ID: 재실행 시 중복 생성을 막기 위한 deterministic ID (고객 식별 정보 없음)
const IDS = {
  site: 'site-daewon-factory-001',
  profileAdmin: 'profile-daewon-owner-001',
  tenantUserAdmin: 'tu-daewon-owner-global',
  profileDeveloper: 'profile-daewon-developer-001',
  tenantUserDeveloper: 'tu-daewon-developer-global',
  wh: { raw: 'wh-daewon-raw-001', wip: 'wh-daewon-wip-001', fg: 'wh-daewon-fg-001' },
} as const;

// ─── Seed Functions ──────────────────────────────────────────────────────────

async function seedTenant() {
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    create: { id: TENANT_ID, code: 'DAEWON', name: '대원정밀', status: TenantStatus.ACTIVE },
    update: { name: '대원정밀', status: TenantStatus.ACTIVE },
  });
}

async function seedSite() {
  await prisma.site.upsert({
    where: { id: IDS.site },
    create: { id: IDS.site, tenantId: TENANT_ID, code: 'FAC-01', name: '본공장', type: SiteType.FACTORY },
    update: {},
  });
}

// 최초 관리자: OWNER 역할(권한 전체 허용 + 사용자관리 전체 접근). 비밀번호는 환경변수로만 받는다.
async function seedOwnerAccount() {
  const email = (process.env.SEED_ADMIN_EMAIL?.trim() || `${ADMIN_LOGIN_ID}@daewon-mes.internal`).toLowerCase();
  const name = process.env.SEED_ADMIN_NAME?.trim() || '시스템 관리자';

  await prisma.profile.upsert({
    where: { id: IDS.profileAdmin },
    create: { id: IDS.profileAdmin, email, name },
    update: {},
  });

  await prisma.tenantUser.upsert({
    where: { id: IDS.tenantUserAdmin },
    create: {
      id: IDS.tenantUserAdmin,
      tenantId: TENANT_ID,
      profileId: IDS.profileAdmin,
      siteId: null,
      role: UserRole.OWNER,
      isActive: true,
    },
    update: {},
  });

  const existing = await prisma.userCredential.findUnique({ where: { profileId: IDS.profileAdmin } });
  if (existing) {
    console.log('    - 관리자 계정이 이미 있어 비밀번호는 변경하지 않습니다.');
    return;
  }
  await prisma.userCredential.create({
    data: {
      tenantId: TENANT_ID,
      loginId: ADMIN_LOGIN_ID,
      profileId: IDS.profileAdmin,
      passwordHash: await bcrypt.hash(ADMIN_PASSWORD, 12),
      // 운영 정책(소유자 결정): 업체 공통 유지보수 관리자 계정은 최초 로그인 시 비밀번호 변경을 강제하지 않는다.
      // (일반 사용자 계정은 기존대로 사용자관리에서 초기화/가입 승인 시 mustChangePw=true 정책 유지)
      // 주의: 비밀번호가 고정/공통 값이면 배포(인터넷 노출) 전에 반드시 변경할 것. 평문은 저장하지 않고 bcrypt 해시만 저장한다.
      mustChangePw: false,
      isLocked: false,
      failCount: 0,
    },
  });
  console.log(`    ✓ 최초 관리자 생성: loginId=${ADMIN_LOGIN_ID} (OWNER)`);
}

// 개발자/유지보수 계정(test): OWNER 전체 권한 + 코드 상 개발자 판정(loginId === 'test')으로 범위 밖 화면과
// 개발자 전용 화면(gateways/equipment-connections/tags/lot-rules/features/common-codes)까지 접근한다.
// 멱등: 이미 있으면 아무것도 바꾸지 않는다(비밀번호도 덮어쓰지 않음). 평문은 저장/로그 출력하지 않고 bcrypt 해시만 저장한다.
async function seedDeveloperAccount() {
  if (!DEVELOPER_PASSWORD) {
    console.log('    - SEED_DEVELOPER_PASSWORD 가 없어 개발자 계정은 건너뜁니다.');
    return;
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID }, select: { id: true } });
  if (!tenant) throw new Error(`[seed-daewon] Tenant ${TENANT_ID} 가 없습니다. 기본 seed 를 먼저 실행하세요.`);

  const email = 'test@daewon-mes.internal';
  const emailOwner = await prisma.profile.findUnique({ where: { email }, select: { id: true } });
  if (emailOwner && emailOwner.id !== IDS.profileDeveloper) {
    throw new Error('[seed-daewon] 개발자 이메일이 다른 프로필에서 사용 중입니다. 중단합니다.');
  }
  const existingByLogin = await prisma.userCredential.findUnique({
    where: { tenantId_loginId: { tenantId: TENANT_ID, loginId: DEVELOPER_LOGIN_ID } },
    select: { profileId: true },
  });
  if (existingByLogin && existingByLogin.profileId !== IDS.profileDeveloper) {
    throw new Error("[seed-daewon] loginId 'test' 가 다른 프로필에 이미 있습니다. 중단합니다.");
  }

  await prisma.profile.upsert({
    where: { id: IDS.profileDeveloper },
    create: { id: IDS.profileDeveloper, email, name: '개발자(유지보수)' },
    update: {},
  });
  await prisma.tenantUser.upsert({
    where: { id: IDS.tenantUserDeveloper },
    create: {
      id: IDS.tenantUserDeveloper,
      tenantId: TENANT_ID,
      profileId: IDS.profileDeveloper,
      siteId: null,
      role: UserRole.OWNER,
      isActive: true,
    },
    update: {},
  });
  if (existingByLogin) {
    console.log('    - 개발자 계정이 이미 있어 비밀번호는 변경하지 않습니다.');
    return;
  }
  await prisma.userCredential.create({
    data: {
      tenantId: TENANT_ID,
      loginId: DEVELOPER_LOGIN_ID,
      profileId: IDS.profileDeveloper,
      passwordHash: await bcrypt.hash(DEVELOPER_PASSWORD, 12),
      mustChangePw: false, // 운영 정책(소유자 결정): 개발자 계정은 비밀번호 변경을 강제하지 않는다.
      isLocked: false,
      failCount: 0,
    },
  });
  console.log(`    ✓ 개발자 계정 생성: loginId=${DEVELOPER_LOGIN_ID} (OWNER, 전역)`);
}

// 공정: 대원정밀 업무 흐름(원자재 → 가공 → 검사 → 세척/포장 → 출하)의 구분만 반영.
// 세부 공정(MCT/CNC 공정명 등)은 고객 확인 후 화면에서 등록한다.
async function seedWorkCenters() {
  const centers: Array<{ id: string; code: string; name: string; kind: WorkCenterKind }> = [
    { id: 'wc-daewon-machining-001', code: 'WC-MACH', name: '가공', kind: WorkCenterKind.MACHINING },
    { id: 'wc-daewon-inspection-001', code: 'WC-INSP', name: '검사', kind: WorkCenterKind.INSPECTION },
    { id: 'wc-daewon-washing-001', code: 'WC-WASH', name: '세척', kind: WorkCenterKind.ASSEMBLY },
    { id: 'wc-daewon-packaging-001', code: 'WC-PACK', name: '포장', kind: WorkCenterKind.PACKAGING },
    { id: 'wc-daewon-fgstore-001', code: 'WC-STORE', name: '완제품입고', kind: WorkCenterKind.STORAGE },
  ];
  for (const wc of centers) {
    await prisma.workCenter.upsert({
      where: { id: wc.id },
      create: { ...wc, siteId: IDS.site },
      update: {},
    });
  }
}

// 설비: 대원정밀 CNC/MCT 기종·대수 확인 전까지 비워 둔다. (설비관리 화면에서 등록)
// TODO(DAEWON): 설비 목록 확보 후 여기 또는 화면 등록/엑셀로 반영. docs/DAEWON-TODO.md 참고.

async function seedWarehouses() {
  const warehouses = [
    { id: IDS.wh.raw, code: 'WH-RAW', name: '원자재 창고', locId: 'loc-daewon-raw-001', locCode: 'RAW-DEFAULT' },
    { id: IDS.wh.wip, code: 'WH-WIP', name: '재공품 창고', locId: 'loc-daewon-wip-001', locCode: 'WIP-DEFAULT' },
    { id: IDS.wh.fg, code: 'WH-FG', name: '완제품 창고', locId: 'loc-daewon-fg-001', locCode: 'FG-DEFAULT' },
  ];
  for (const wh of warehouses) {
    await prisma.warehouse.upsert({
      where: { id: wh.id },
      create: { id: wh.id, code: wh.code, name: wh.name, tenantId: TENANT_ID, siteId: IDS.site },
      update: {},
    });
    // 기본 로케이션 1개씩만. 실제 랙/구역 체계는 고객 확인 후 로케이션관리에서 등록.
    await prisma.location.upsert({
      where: { id: wh.locId },
      create: { id: wh.locId, warehouseId: wh.id, code: wh.locCode, name: '기본', locationType: 'FLOOR' },
      update: {},
    });
  }
}

// 기본 불량코드: 일반 기계가공 품질 분류 템플릿(NMES 공통). 대원정밀 불량 유형 확인 후 조정.
async function seedDefectCodes() {
  const codes: Array<{ id: string; code: string; name: string; defectCategory: DefectCategory }> = [
    { id: 'dc-daewon-dim-001', code: 'DIM-001', name: '치수 초과', defectCategory: DefectCategory.DIMENSIONAL },
    { id: 'dc-daewon-dim-002', code: 'DIM-002', name: '치수 미달', defectCategory: DefectCategory.DIMENSIONAL },
    { id: 'dc-daewon-vis-001', code: 'VIS-001', name: '표면 스크래치', defectCategory: DefectCategory.VISUAL },
    { id: 'dc-daewon-func-001', code: 'FUN-001', name: '작동 불량', defectCategory: DefectCategory.FUNCTIONAL },
    { id: 'dc-daewon-mat-001', code: 'MAT-001', name: '재질 부적합', defectCategory: DefectCategory.MATERIAL },
  ];
  for (const dc of codes) {
    await prisma.defectCode.upsert({
      where: { id: dc.id },
      create: { ...dc, tenantId: TENANT_ID },
      update: {},
    });
  }
}

// 공통코드: 시스템 동작에 쓰이는 일반 코드만(원가 설정/반려사유 등 NMES 데모 값은 제외).
async function seedCodeGroups() {
  const groups = [
    {
      id: 'cg-daewon-stop-reason', groupCode: 'STOP_REASON', groupName: '작업중단사유', isSystem: true,
      codes: [
        { id: 'cc-daewon-sr-01', code: 'MATERIAL_SHORT', name: '자재 부족', displayOrder: 1 },
        { id: 'cc-daewon-sr-02', code: 'EQUIPMENT_FAIL', name: '설비 고장', displayOrder: 2 },
        { id: 'cc-daewon-sr-03', code: 'QUALITY_HOLD', name: '품질 보류', displayOrder: 3 },
        { id: 'cc-daewon-sr-04', code: 'BREAK', name: '휴식', displayOrder: 4 },
        { id: 'cc-daewon-sr-99', code: 'OTHER', name: '기타', displayOrder: 99 },
      ],
    },
    {
      id: 'cg-daewon-location-type', groupCode: 'LOCATION_TYPE', groupName: '로케이션유형', isSystem: true,
      codes: [
        { id: 'cc-daewon-lt-01', code: 'RAW', name: '원자재 구역', displayOrder: 1 },
        { id: 'cc-daewon-lt-02', code: 'WIP', name: '재공 구역', displayOrder: 2 },
        { id: 'cc-daewon-lt-03', code: 'FG', name: '완제품 구역', displayOrder: 3 },
        { id: 'cc-daewon-lt-04', code: 'QC', name: '검사 구역', displayOrder: 4 },
        { id: 'cc-daewon-lt-05', code: 'SHIP', name: '출하 구역', displayOrder: 5 },
      ],
    },
    {
      id: 'cg-daewon-downtime-reason', groupCode: 'DOWNTIME_REASON', groupName: '비가동사유', isSystem: true,
      codes: [
        { id: 'cc-daewon-dr-01', code: 'EQUIP_FAIL', name: '설비고장', displayOrder: 1 },
        { id: 'cc-daewon-dr-02', code: 'TOOL_CHANGE', name: '공구교체', displayOrder: 2 },
        { id: 'cc-daewon-dr-03', code: 'MATERIAL_WAIT', name: '자재대기', displayOrder: 3 },
        { id: 'cc-daewon-dr-04', code: 'OPERATOR_WAIT', name: '작업자대기', displayOrder: 4 },
        { id: 'cc-daewon-dr-06', code: 'QUALITY_CHECK', name: '품질확인', displayOrder: 6 },
        { id: 'cc-daewon-dr-07', code: 'PLANNED_STOP', name: '계획정지', displayOrder: 7 },
        { id: 'cc-daewon-dr-99', code: 'OTHER', name: '기타', displayOrder: 99 },
      ],
    },
  ];
  for (const group of groups) {
    await prisma.codeGroup.upsert({
      where: { id: group.id },
      create: {
        id: group.id, tenantId: TENANT_ID, groupCode: group.groupCode,
        groupName: group.groupName, isSystem: group.isSystem, isActive: true,
      },
      update: {},
    });
    for (const c of group.codes) {
      await prisma.commonCode.upsert({
        where: { id: c.id },
        create: { id: c.id, groupId: group.id, code: c.code, name: c.name, displayOrder: c.displayOrder, isActive: true },
        update: {},
      });
    }
  }
}

// RolePermission: 기본값의 유일한 정의는 src/lib/auth/permission-catalog.ts (사용자관리 화면의 ensurePermissionMatrix 와 공용).
// 대원정밀 구축 범위 밖 리소스(QUOTATION, COSTING, PROJECT_*, ITEM_PRICE)는 MANAGER/OPERATOR/VIEWER 에 부여하지 않는다
// (화면은 src/lib/auth/daewon-scope.ts 의 라우트 정책으로도 차단된다. OWNER/ADMIN 행은 호환을 위해 유지).
// skipDuplicates 라 반복 실행해도 중복 행이 생기지 않고, 이미 저장된 설정은 덮어쓰지 않는다.
async function seedRolePermissions() {
  const created = await ensureDefaultPermissions(prisma, TENANT_ID, { withheldFromNonAdmin: DAEWON_OUT_OF_SCOPE_RESOURCES });
  console.log(`    ✓ 신규 권한 행 ${created}개 (기존 행은 유지)`);
}

// FeatureDefinition 은 전역 카탈로그. 메뉴 코드 매핑(getEnabledMenuCodes)과 하위 호환을 위해 전부 등록하고,
// 대원정밀 범위 밖 기능(QUOTATION/COSTING)은 TenantFeature 활성화 목록에서만 제외한다.
async function seedFeatures() {
  for (const f of FEATURE_CATALOG) {
    const data = { ...f, menuCodes: [...f.menuCodes] };
    await prisma.featureDefinition.upsert({ where: { code: f.code }, update: data, create: data });
  }

  const all = await prisma.featureDefinition.findMany();
  const featureMap = Object.fromEntries(all.map((f) => [f.code, f.id]));
  for (const dep of FEATURE_DEPENDENCIES) {
    if (!featureMap[dep.from] || !featureMap[dep.to]) continue;
    await prisma.featureDependency.upsert({
      where: { featureId_dependsOnId: { featureId: featureMap[dep.from], dependsOnId: featureMap[dep.to] } },
      update: { isRequired: dep.required },
      create: { featureId: featureMap[dep.from], dependsOnId: featureMap[dep.to], isRequired: dep.required },
    });
  }

  const enableCodes = [
    'ITEM', 'BOM', 'ROUTING', 'EQUIPMENT', 'WORK_ORDER', 'PRODUCTION_PLAN', 'PRODUCTION_RESULT',
    'QUALITY_INSPECTION', 'DEFECT_MANAGEMENT', 'COMMON_CODE', 'PERMISSION', 'FEATURE_MANAGEMENT',
    'SALES_ORDER', 'SHIPMENT', 'PURCHASE_ORDER', 'ITEM_PRICE', 'MRP', 'PARTNER_MANAGEMENT',
    'EQUIPMENT_MANAGEMENT', 'EQUIPMENT_MONITOR', 'INSPECTION_STAGES', 'DASHBOARD',
    'EQUIPMENT_CONNECTION', 'TAG_MANAGEMENT', 'INVENTORY', 'LOT_TRACKING',
  ];
  for (const code of enableCodes) {
    const featureId = featureMap[code];
    if (!featureId) continue;
    await prisma.tenantFeature.upsert({
      where: { tenantId_featureId: { tenantId: TENANT_ID, featureId } },
      update: { isEnabled: true },
      create: { tenantId: TENANT_ID, featureId, isEnabled: true },
    });
  }
}

async function main() {
  console.log('▶ 대원정밀 MES 기준 seed 시작...\n');
  console.log(`  tenantId=${TENANT_ID}`);
  const steps: Array<[string, () => Promise<void>]> = ONLY_DEVELOPER
    ? [['개발자 계정 test (SEED_ONLY=developer — 기준정보는 변경하지 않음)', seedDeveloperAccount]]
    : [
    ['Tenant', seedTenant],
    ['Site', seedSite],
    ['최초 관리자 (Profile / TenantUser / UserCredential)', seedOwnerAccount],
    ['개발자 계정 test (SEED_DEVELOPER_PASSWORD 가 있을 때)', seedDeveloperAccount],
    ['WorkCenters(공정)', seedWorkCenters],
    ['Warehouses + 기본 Locations', seedWarehouses],
    ['DefectCodes(기본)', seedDefectCodes],
    ['CodeGroups + CommonCodes', seedCodeGroups],
    ['RolePermissions', seedRolePermissions],
    ['FeatureDefinitions + Dependencies + TenantFeatures', seedFeatures],
  ];
  let i = 1;
  for (const [label, fn] of steps) {
    console.log(`  [${i++}/${steps.length}] ${label}`);
    await fn();
  }
  console.log('\n✅ 완료. ' + (ONLY_DEVELOPER ? '(개발자 계정 단계만 실행, 기준정보 변경 없음)' : '(품목/BOM/라우팅/설비/검사기준/LOT 규칙은 생성하지 않음)'));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
