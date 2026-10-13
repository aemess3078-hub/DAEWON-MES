// NMES prisma/seed.ts 의 seedFeatures() 카탈로그를 그대로 옮긴 것(내용 변경 없음).
// FeatureDefinition 은 테넌트와 무관한 전역 카탈로그이며, 메뉴 코드 → 기능 매핑에 사용된다.

export const FEATURE_CATALOG = [
  // MASTER
  { code: 'ITEM', name: '품목관리', description: '품목 마스터 데이터 관리', category: 'MASTER', icon: 'Package', menuCodes: ['items', 'item-categories', 'item-groups', 'sites', 'locations'], isCore: true, displayOrder: 10 },
  { code: 'BOM', name: 'BOM 관리', description: '자재명세서(BOM) 관리', category: 'MASTER', icon: 'GitBranch', menuCodes: ['bom'], isCore: false, displayOrder: 20 },
  { code: 'ROUTING', name: '공정/라우팅', description: '생산 공정 및 라우팅 관리', category: 'MASTER', icon: 'Network', menuCodes: ['routing', 'work-centers'], isCore: false, displayOrder: 30 },
  { code: 'EQUIPMENT', name: '설비관리', description: '생산 설비 마스터 관리', category: 'MASTER', icon: 'Cpu', menuCodes: ['equipment'], isCore: false, displayOrder: 40 },
  // PRODUCTION
  { code: 'WORK_ORDER', name: '작업지시', description: '작업지시 생성 및 관리', category: 'PRODUCTION', icon: 'ClipboardList', menuCodes: ['work-orders', 'work-queue'], isCore: false, displayOrder: 50 },
  { code: 'PRODUCTION_PLAN', name: '생산계획', description: '일간/주간/월간 생산계획', category: 'PRODUCTION', icon: 'CalendarDays', menuCodes: ['production-plan'], isCore: false, displayOrder: 60 },
  { code: 'PRODUCTION_RESULT', name: '작업실적', description: '공정별 생산실적 입력', category: 'PRODUCTION', icon: 'BarChart2', menuCodes: ['production-results', 'equipment-output', 'finished-goods-receipt'], isCore: false, displayOrder: 70 },
  // MATERIAL
  { code: 'INVENTORY', name: '재고관리', description: '자재/제품 재고 관리', category: 'MATERIAL', icon: 'Boxes', menuCodes: ['inventory', 'inventory-transactions', 'stock', 'wip-inventory'], isCore: false, displayOrder: 80 },
  { code: 'LOT_TRACKING', name: 'LOT/시리얼 추적', description: 'LOT/시리얼 단위 이력 추적 및 번호 규칙 설정', category: 'MATERIAL', icon: 'ScanLine', menuCodes: ['lot', 'lot-rules', 'traceability', 'lot-history', 'manufacturing-traceability'], isCore: false, displayOrder: 90 },
  // QUALITY
  { code: 'QUALITY_INSPECTION', name: '공정검사', description: '생산 공정 품질 검사', category: 'QUALITY', icon: 'CheckCircle', menuCodes: ['inspection', 'work-standards'], isCore: false, displayOrder: 100 },
  { code: 'DEFECT_MANAGEMENT', name: '불량관리', description: '불량 분석 및 관리', category: 'QUALITY', icon: 'AlertTriangle', menuCodes: ['defects', 'ecn', 'defect-stats'], isCore: false, displayOrder: 110 },
  // EQUIPMENT
  { code: 'EQUIPMENT_CONNECTION', name: '설비연동', description: 'PLC/설비 데이터 연동', category: 'EQUIPMENT', icon: 'Wifi', menuCodes: ['gateways', 'equipment-connections'], isCore: false, displayOrder: 120 },
  { code: 'TAG_MANAGEMENT', name: '태그관리', description: '설비 데이터 태그 관리', category: 'EQUIPMENT', icon: 'Tag', menuCodes: ['tags'], isCore: false, displayOrder: 130 },
  // SYSTEM
  { code: 'COMMON_CODE', name: '공통코드', description: '시스템 공통 코드 관리', category: 'SYSTEM', icon: 'BookOpen', menuCodes: ['common-codes'], isCore: true, displayOrder: 140 },
  { code: 'PERMISSION', name: '권한관리', description: '역할별 권한 관리', category: 'SYSTEM', icon: 'Shield', menuCodes: ['users'], isCore: true, displayOrder: 150 },
  { code: 'FEATURE_MANAGEMENT', name: '기능관리', description: '테넌트 기능 ON/OFF 관리', category: 'SYSTEM', icon: 'Puzzle', menuCodes: ['features'], isCore: true, displayOrder: 160 },
  // SALES
  { code: 'SALES_ORDER', name: '수주관리', description: '수주/출하 관리', category: 'SALES', icon: 'ClipboardList', menuCodes: ['sales-orders', 'shipments', 'order-status', 'delivery-status'], isCore: false, displayOrder: 151 },
  { code: 'SHIPMENT', name: '출하관리', description: '출하 관리', category: 'SALES', icon: 'Truck', menuCodes: ['shipments'], isCore: false, displayOrder: 152 },
  // PURCHASE
  { code: 'PURCHASE_ORDER', name: '발주관리', description: '발주/입고 관리', category: 'PURCHASE', icon: 'FileInput', menuCodes: ['purchase-orders', 'material-receipt', 'material-issue', 'outsourcing'], isCore: false, displayOrder: 161 },
  { code: 'ITEM_PRICE', name: '단가관리', description: '품목 단가 관리', category: 'PURCHASE', icon: 'CircleDollarSign', menuCodes: ['item-prices'], isCore: false, displayOrder: 162 },
  // MRP
  { code: 'MRP', name: 'MRP 소요량', description: '자재 소요량 계획 및 AI 발주 제안', category: 'PRODUCTION', icon: 'Calculator', menuCodes: ['mrp'], isCore: false, displayOrder: 141 },
  // QUOTATION
  { code: 'QUOTATION', name: '견적관리', description: '고객 견적서 관리 및 수주 전환', category: 'SALES', icon: 'FileText', menuCodes: ['quotations'], isCore: false, displayOrder: 50 },
  // ANALYTICS
  { code: 'COSTING', name: '원가분석', description: 'BOM 기반 표준원가와 실적 기반 실제원가 비교', category: 'ANALYTICS', icon: 'Calculator', menuCodes: ['costing'], isCore: false, displayOrder: 90 },
  // PARTNER
  { code: 'PARTNER_MANAGEMENT', name: '고객사/거래처 관리', description: '고객사 및 거래처 마스터 관리', category: 'MASTER', icon: 'Handshake', menuCodes: ['customers', 'vendors'], isCore: false, displayOrder: 15 },
  // LMS + 모니터링 + 검사
  { code: 'EQUIPMENT_MANAGEMENT', name: '설비관리(LMS)', description: '설비 수리요청, 일상점검, 문제유형 관리', category: 'EQUIPMENT', icon: 'Wrench', menuCodes: ['equipment-repair', 'equipment-check', 'equipment-problems', 'equipment-check-status', 'equipment-statistics', 'molds', 'parameters', 'errors', 'capacity'], isCore: false, displayOrder: 125 },
  { code: 'EQUIPMENT_MONITOR', name: '설비 현황 모니터링', description: '실시간 설비 가동 상태 모니터링', category: 'EQUIPMENT', icon: 'Activity', menuCodes: ['equipment-monitor', 'status'], isCore: false, displayOrder: 126 },
  { code: 'INSPECTION_STAGES', name: '초·중·종 검사', description: '초물/중간/종물 단계별 품질검사', category: 'QUALITY', icon: 'ListChecks', menuCodes: ['inspection-stages', 'inspection-standards'], isCore: false, displayOrder: 105 },
  { code: 'DASHBOARD', name: '생산현황 대시보드', description: 'KPI 및 생산현황 종합 대시보드', category: 'ANALYTICS', icon: 'LayoutDashboard', menuCodes: ['dashboard', 'kpi'], isCore: false, displayOrder: 80 },
] as const;

export const FEATURE_DEPENDENCIES = [
  { from: 'BOM', to: 'ITEM', required: true },
  { from: 'ROUTING', to: 'ITEM', required: true },
  { from: 'WORK_ORDER', to: 'ITEM', required: true },
  { from: 'WORK_ORDER', to: 'BOM', required: true },
  { from: 'WORK_ORDER', to: 'ROUTING', required: true },
  { from: 'PRODUCTION_PLAN', to: 'ITEM', required: true },
  { from: 'PRODUCTION_PLAN', to: 'WORK_ORDER', required: false },
  { from: 'PRODUCTION_RESULT', to: 'WORK_ORDER', required: true },
  { from: 'INVENTORY', to: 'ITEM', required: true },
  { from: 'LOT_TRACKING', to: 'INVENTORY', required: true },
  { from: 'QUALITY_INSPECTION', to: 'WORK_ORDER', required: true },
  { from: 'DEFECT_MANAGEMENT', to: 'QUALITY_INSPECTION', required: true },
  { from: 'TAG_MANAGEMENT', to: 'EQUIPMENT', required: true },
  { from: 'TAG_MANAGEMENT', to: 'EQUIPMENT_CONNECTION', required: true },
] as const;
