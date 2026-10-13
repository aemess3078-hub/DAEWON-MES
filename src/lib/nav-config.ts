import type { NavItem } from '@/types/menu';

// ─────────────────────────────────────────────────────────────────────────────
// 대원정밀 MES 메뉴 구성
//
// - NMES 공통 메뉴 중 대원정밀 구축 범위에 해당하는 항목만 노출한다.
// - 범위 밖 기능은 코드/DB 모델/migration 을 삭제하지 않고 메뉴만 숨긴다.
//   숨긴 항목은 파일 하단 DAEWON_HIDDEN_NAV 에 목록으로 보존한다(재노출 시 참고용, 화면에서는 미사용).
// - 숨긴 메뉴의 URL 로 직접 접근하는 것은 막지 않는다(기존 RolePermission 으로만 제어).
// - item id / href 는 NMES 원본과 동일하게 유지한다(권한/기능 코드가 href 마지막 세그먼트에 의존).
// ─────────────────────────────────────────────────────────────────────────────

export const MES_NAV: NavItem[] = [
  {
    id: 'section-mes',
    parentId: null,
    label: 'MES',
    icon: 'Factory',
    displayOrder: 1,
    children: [
      // 1. 기준정보관리
      {
        id: 'nav-master',
        parentId: 'section-mes',
        label: '기준정보관리',
        icon: 'Database',
        displayOrder: 10,
        children: [
          { id: 'nav-customers', parentId: 'nav-master', label: '고객사관리', icon: 'Building2', href: '/app/mes/customers', displayOrder: 1, children: [] },
          { id: 'nav-vendors', parentId: 'nav-master', label: '거래처관리', icon: 'Handshake', href: '/app/mes/vendors', displayOrder: 2, children: [] },
          { id: 'nav-equipment-master', parentId: 'nav-master', label: '설비관리', icon: 'Cog', href: '/app/mes/master/equipment', displayOrder: 3, children: [] },
          { id: 'nav-work-centers', parentId: 'nav-master', label: '공정관리', icon: 'GitBranch', href: '/app/mes/work-centers', displayOrder: 4, children: [] },
          { id: 'nav-routing', parentId: 'nav-master', label: '라우팅관리', icon: 'Workflow', href: '/app/mes/routing', displayOrder: 5, children: [] },
          { id: 'nav-users', parentId: 'nav-master', label: '사용자관리', icon: 'Users', href: '/app/mes/users', displayOrder: 6, minRole: 'ADMIN', children: [] },
          { id: 'nav-sites', parentId: 'nav-master', label: '사업장관리', icon: 'Building2', href: '/app/mes/sites', displayOrder: 7, children: [] },
          { id: 'nav-locations', parentId: 'nav-master', label: '로케이션관리', icon: 'MapPin', href: '/app/mes/locations', displayOrder: 8, children: [] },
          { id: 'nav-items', parentId: 'nav-master', label: '품목관리', icon: 'Package', href: '/app/mes/items', displayOrder: 9, children: [] },
          { id: 'nav-bom', parentId: 'nav-master', label: 'BOM관리', icon: 'GitBranch', href: '/app/mes/bom', displayOrder: 10, children: [] },
          { id: 'nav-inspection-standards', parentId: 'nav-master', label: '검사표준관리', icon: 'FileCheck', href: '/app/mes/master/inspection-standards', displayOrder: 11, children: [] },
          // ── 대원정밀 목표 메뉴 외, 위 기준정보 입력에 필요한 보조 마스터(유지) ──
          { id: 'nav-item-categories', parentId: 'nav-master', label: '품목분류관리', icon: 'Tags', href: '/app/mes/master/item-categories', displayOrder: 12, children: [] },
          { id: 'nav-item-groups', parentId: 'nav-master', label: '품목군관리', icon: 'Layers', href: '/app/mes/master/item-groups', displayOrder: 13, children: [] },
          { id: 'nav-defects', parentId: 'nav-master', label: '불량코드관리', icon: 'AlertTriangle', href: '/app/mes/defects', displayOrder: 14, children: [] },
          { id: 'nav-common-codes', parentId: 'nav-master', label: '코드관리', icon: 'BookOpen', href: '/app/mes/common-codes', displayOrder: 15, developerOnly: true, children: [] },
          { id: 'nav-attachments', parentId: 'nav-master', label: '첨부파일관리', icon: 'Paperclip', href: '/app/mes/attachments', displayOrder: 16, children: [] },
          { id: 'nav-audit-log', parentId: 'nav-master', label: '감사로그', icon: 'History', href: '/app/mes/audit-log', displayOrder: 17, children: [] },
        ],
      },
      // 2. 수주납품관리
      {
        id: 'nav-sales',
        parentId: 'section-mes',
        label: '수주납품관리',
        icon: 'TrendingUp',
        displayOrder: 20,
        children: [
          { id: 'nav-sales-orders', parentId: 'nav-sales', label: '수주등록', icon: 'ClipboardList', href: '/app/mes/sales-orders', displayOrder: 1, children: [] },
          { id: 'nav-sales-status', parentId: 'nav-sales', label: '수주현황', icon: 'BarChart2', href: '/app/mes/sales/order-status', displayOrder: 2, children: [] },
          { id: 'nav-shipments', parentId: 'nav-sales', label: '납품정보등록', icon: 'Truck', href: '/app/mes/shipments', displayOrder: 3, children: [] },
          { id: 'nav-delivery-status', parentId: 'nav-sales', label: '납품현황', icon: 'FileBarChart', href: '/app/mes/sales/delivery-status', displayOrder: 4, children: [] },
        ],
      },
      // 3. 자재관리
      {
        id: 'nav-material',
        parentId: 'section-mes',
        label: '자재관리',
        icon: 'PackagePlus',
        displayOrder: 30,
        children: [
          { id: 'nav-purchase-orders', parentId: 'nav-material', label: '자재발주현황', icon: 'ShoppingCart', href: '/app/mes/purchase-orders', displayOrder: 1, children: [] },
          { id: 'nav-material-receipt', parentId: 'nav-material', label: '자재입고현황', icon: 'PackagePlus', href: '/app/mes/material-receipt', displayOrder: 2, children: [] },
          { id: 'nav-material-issue', parentId: 'nav-material', label: '자재출고현황', icon: 'FileInput', href: '/app/mes/material-issue', displayOrder: 3, children: [] },
          { id: 'nav-material-stock', parentId: 'nav-material', label: '자재재고현황', icon: 'Boxes', href: '/app/mes/material/stock', displayOrder: 4, children: [] },
          { id: 'nav-mrp', parentId: 'nav-material', label: '자재소요량계획(MRP)', icon: 'Calculator', href: '/app/mes/mrp', displayOrder: 5, children: [] },
        ],
      },
      // 4. 재고관리
      {
        id: 'nav-inventory-section',
        parentId: 'section-mes',
        label: '재고관리',
        icon: 'Boxes',
        displayOrder: 40,
        children: [
          { id: 'nav-inventory', parentId: 'nav-inventory-section', label: '재고현황', icon: 'Package', href: '/app/mes/inventory', displayOrder: 1, children: [] },
          { id: 'nav-inventory-txns', parentId: 'nav-inventory-section', label: '전체입출고내역', icon: 'ArrowLeftRight', href: '/app/mes/inventory-transactions', displayOrder: 2, children: [] },
          { id: 'nav-wip-inventory', parentId: 'nav-inventory-section', label: '재공품재고', icon: 'RefreshCw', href: '/app/mes/production/wip-inventory', displayOrder: 3, children: [] },
        ],
      },
      // 5. 생산관리
      {
        id: 'nav-production',
        parentId: 'section-mes',
        label: '생산관리',
        icon: 'Factory',
        displayOrder: 50,
        children: [
          { id: 'nav-prod-plan-output', parentId: 'nav-production', label: '생산계획관리', icon: 'CalendarDays', href: '/app/mes/production-plan', displayOrder: 1, children: [] },
          { id: 'nav-work-orders', parentId: 'nav-production', label: '작업지시', icon: 'ClipboardList', href: '/app/mes/work-orders', displayOrder: 2, children: [] },
          { id: 'nav-production-results', parentId: 'nav-production', label: '작업일지/실적', icon: 'FileText', href: '/app/mes/production-results', displayOrder: 3, children: [] },
          { id: 'nav-finished-goods-receipt', parentId: 'nav-production', label: '완제품입고', icon: 'PackagePlus', href: '/app/mes/finished-goods-receipt', displayOrder: 4, children: [] },
          { id: 'nav-outsourcing', parentId: 'nav-production', label: '외주관리', icon: 'Truck', href: '/app/mes/production/outsourcing', displayOrder: 5, children: [] },
        ],
      },
      // 6. 품질관리
      {
        id: 'nav-quality',
        parentId: 'section-mes',
        label: '품질관리',
        icon: 'ShieldCheck',
        displayOrder: 60,
        children: [
          { id: 'nav-defect-stats', parentId: 'nav-quality', label: '불량통계/자주검사', icon: 'BarChart2', href: '/app/mes/quality/defect-stats', displayOrder: 1, children: [] },
          // 초/중/종 검사(InspectionStage FIRST/MID/FINAL) 목록 화면
          { id: 'nav-inspection-stages', parentId: 'nav-quality', label: '초중종검사 LIST', icon: 'ClipboardCheck', href: '/app/mes/inspection-stages', displayOrder: 2, children: [] },
          { id: 'nav-work-standards', parentId: 'nav-quality', label: '작업표준서관리', icon: 'BookOpen', href: '/app/mes/quality/work-standards', displayOrder: 3, children: [] },
          { id: 'nav-change-management', parentId: 'nav-quality', label: '변경관리', icon: 'GitPullRequest', href: '/app/mes/ecn', displayOrder: 4, children: [] },
          // TODO(DAEWON): 계측기 검교정관리는 신규 개발 전. 준비중 배지로만 노출한다(href 없음 → 클릭 비활성).
          // 노출을 원치 않으면 이 항목만 제거하면 된다. docs/DAEWON-TODO.md 참고.
          { id: 'nav-calibration', parentId: 'nav-quality', label: '계측기검교정관리', icon: 'Gauge', displayOrder: 5, comingSoon: true, children: [] },
        ],
      },
      // 7. 이력관리
      {
        id: 'nav-history',
        parentId: 'section-mes',
        label: '이력관리',
        icon: 'Search',
        displayOrder: 70,
        children: [
          { id: 'nav-lot', parentId: 'nav-history', label: 'LOT관리', icon: 'Tag', href: '/app/mes/lot', displayOrder: 1, children: [] },
          { id: 'nav-traceability', parentId: 'nav-history', label: 'LOT/제조이력추적', icon: 'Network', href: '/app/mes/traceability', displayOrder: 2, children: [] },
        ],
      },
    ],
  },

  // 8. 모니터링
  // NOTE: 설비 연계 방식(NCWatch 등) 미확정 — 화면은 노출하되 설비 데이터가 들어오기 전에는 비어 있을 수 있다.
  {
    id: 'section-monitoring',
    parentId: null,
    label: '모니터링',
    icon: 'Monitor',
    displayOrder: 2,
    children: [
      { id: 'nav-lms-status', parentId: 'section-monitoring', label: '현황모니터링', icon: 'Monitor', href: '/app/lms/monitoring/status', displayOrder: 1, children: [] },
      { id: 'nav-lms-analysis', parentId: 'section-monitoring', label: '분석모니터링', icon: 'Activity', href: '/app/mes/equipment-monitor', displayOrder: 2, children: [] },
    ],
  },

  // 설비연동 설정 (개발자 전용) — 설비 연계 방식 확정 전까지 코드/모델 유지, 일반 사용자에게는 비노출.
  {
    id: 'section-lms',
    parentId: null,
    label: '설비연동',
    icon: 'Cpu',
    displayOrder: 3,
    developerOnly: true,
    children: [
      { id: 'nav-gateways', parentId: 'section-lms', label: 'Edge Gateway', icon: 'Wifi', href: '/app/mes/gateways', displayOrder: 1, children: [] },
      { id: 'nav-equipment-connections', parentId: 'section-lms', label: '설비 연결 설정', icon: 'Cable', href: '/app/mes/equipment-connections', displayOrder: 2, children: [] },
      { id: 'nav-tags', parentId: 'section-lms', label: '태그 사전', icon: 'Tag', href: '/app/mes/tags', displayOrder: 3, children: [] },
    ],
  },

  // 시스템 (개발자 전용)
  {
    id: 'section-system',
    parentId: null,
    label: '시스템',
    icon: 'Settings',
    displayOrder: 4,
    developerOnly: true,
    children: [
      { id: 'nav-features', parentId: 'section-system', label: '기능 관리', icon: 'Puzzle', href: '/app/mes/features', displayOrder: 1, children: [] },
      // TODO(DAEWON): LOT 채번 규칙 미확정. 규칙 확정 전까지 이 화면에서 임의 규칙을 만들지 않는다.
      { id: 'nav-lot-rules', parentId: 'section-system', label: '번호 규칙', icon: 'Fingerprint', href: '/app/mes/lot-rules', displayOrder: 2, children: [] },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 대원정밀에서 메뉴만 숨긴 항목 (참고용 목록 — 화면/라우트/DB 는 그대로 존재)
// ─────────────────────────────────────────────────────────────────────────────
export const DAEWON_HIDDEN_NAV: ReadonlyArray<{ id: string; label: string; href: string; reason: string }> = [
  // 영업/프로젝트 (청운커팅 사업계획서 전용)
  { id: 'nav-project-orders', label: '프로젝트 오더', href: '/app/mes/project-orders', reason: '범위 밖(청운 전용)' },
  { id: 'nav-project-prices', label: '프로젝트 단가관리', href: '/app/mes/project-prices', reason: '범위 밖(청운 전용)' },
  { id: 'nav-project-progress', label: '프로젝트 진행현황', href: '/app/mes/project-progress', reason: '범위 밖(청운 전용)' },
  { id: 'nav-project-issues', label: '이슈 관리', href: '/app/mes/project-issues', reason: '범위 밖(청운 전용)' },
  // 자재/생산 부가
  { id: 'nav-material-return', label: '반품관리', href: '/app/mes/material-return', reason: '목표 메뉴 외' },
  { id: 'nav-prod-equip-output', label: '설비별생산현황', href: '/app/mes/production/equipment-output', reason: '목표 메뉴 외' },
  { id: 'nav-rework', label: '재작업/보류관리', href: '/app/mes/rework', reason: '목표 메뉴 외' },
  { id: 'nav-manufacturing-traceability', label: '제조번호 추적성', href: '/app/mes/manufacturing-traceability', reason: 'CNS 제조번호 체계 의존 — LOT 규칙 확정 후 재검토' },
  // 품질 부가
  { id: 'nav-quality-dashboard', label: '품질현황', href: '/app/mes/quality/dashboard', reason: '목표 메뉴 외' },
  { id: 'nav-inspection', label: '공정검사', href: '/app/mes/inspection', reason: '목표 메뉴 외' },
  { id: 'nav-spc', label: 'SPC 통계분석', href: '/app/mes/spc', reason: '목표 메뉴 외' },
  { id: 'nav-cause-analysis', label: '원인분석', href: '/app/mes/quality/cause-analysis', reason: '목표 메뉴 외' },
  { id: 'nav-corrective-action', label: '조치관리', href: '/app/mes/quality/corrective-action', reason: '목표 메뉴 외' },
  { id: 'nav-recurrence-prevention', label: '재발방지관리', href: '/app/mes/quality/recurrence-prevention', reason: '목표 메뉴 외' },
  // 기준정보 부가
  { id: 'nav-mold-management', label: '금형·치공구관리', href: '/app/mes/master/molds', reason: '목표 메뉴 외' },
  { id: 'nav-downtime-reasons', label: '비가동사유', href: '/app/mes/master/downtime-reasons', reason: '목표 메뉴 외' },
  { id: 'nav-backups', label: '백업관리', href: '/app/mes/backups', reason: 'Supabase Management 토큰 필요 — 필요 시 재노출' },
  // KPI / 리포트 / 대시보드
  { id: 'nav-kpi-dashboard', label: 'KPI 대시보드', href: '/app/mes/kpi', reason: '목표 메뉴 외' },
  { id: 'nav-production-progress', label: '생산현황', href: '/app/mes/production-progress', reason: 'NewMES 브랜드 전용 화면(NEXT_PUBLIC_BRAND=newmes)' },
  { id: 'nav-report-production-daily', label: '생산일보', href: '/app/mes/reports/production-daily', reason: '목표 메뉴 외' },
  { id: 'nav-report-quality', label: '품질리포트', href: '/app/mes/reports/quality', reason: '목표 메뉴 외' },
  { id: 'nav-report-equipment', label: '설비리포트', href: '/app/mes/reports/equipment', reason: '목표 메뉴 외' },
  // 설비관리(LMS) 부가
  { id: 'nav-lms-errors', label: '에러보기', href: '/app/lms/equipment/errors', reason: '설비 연계 방식 미확정' },
  { id: 'nav-lms-params', label: '파라미터보기', href: '/app/lms/equipment/parameters', reason: '설비 연계 방식 미확정' },
  { id: 'nav-lms-repair-req', label: '설비수리관리', href: '/app/mes/equipment-repair', reason: '목표 메뉴 외' },
  { id: 'nav-lms-problem-types', label: '설비문제유형등록', href: '/app/mes/equipment-problems', reason: '목표 메뉴 외' },
  { id: 'nav-lms-daily-check', label: '정기점검', href: '/app/mes/equipment-check', reason: '목표 메뉴 외' },
  { id: 'nav-lms-check-status', label: '설비일상점검현황', href: '/app/mes/equipment-check-status', reason: '목표 메뉴 외' },
  { id: 'nav-lms-tools', label: '공구관리', href: '/app/mes/equipment-tools', reason: '목표 메뉴 외(청운 전용)' },
  { id: 'nav-lms-stats-integrated', label: '설비 통합통계', href: '/app/mes/equipment-statistics', reason: 'LMS 통계 — 범위 밖' },
  { id: 'nav-lms-stats-capacity', label: '설비 능력통계', href: '/app/lms/statistics/capacity', reason: 'LMS 통계 — 범위 밖' },
  // 지원
  { id: 'nav-support-requests', label: '요청사항', href: '/app/mes/support-requests', reason: 'NMES 개발 지원용' },
  // 라우트는 있으나 원본 NMES 에서도 메뉴에 없던 화면: quotations, costing, item-prices, approval, erp,
  //   lms/statistics/{downtime,energy,errors,production,work-time} 등 — 변경 없음.
];
