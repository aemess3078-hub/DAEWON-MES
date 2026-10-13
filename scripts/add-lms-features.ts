import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // 새 FeatureDefinition 추가
  const newFeatures = [
    {
      code: 'EQUIPMENT_MANAGEMENT',
      name: '설비관리(LMS)',
      description: '설비 수리요청, 일상점검, 문제유형 관리',
      category: 'EQUIPMENT',
      icon: 'Wrench',
      menuCodes: ['equipment-repair', 'equipment-check', 'equipment-problems'],
      isCore: false,
      displayOrder: 125,
    },
    {
      code: 'EQUIPMENT_MONITOR',
      name: '설비 현황 모니터링',
      description: '실시간 설비 가동 상태 모니터링',
      category: 'EQUIPMENT',
      icon: 'Activity',
      menuCodes: ['equipment-monitor'],
      isCore: false,
      displayOrder: 126,
    },
    {
      code: 'INSPECTION_STAGES',
      name: '초·중·종 검사',
      description: '초물/중간/종물 단계별 품질검사',
      category: 'QUALITY',
      icon: 'ListChecks',
      menuCodes: ['inspection-stages'],
      isCore: false,
      displayOrder: 105,
    },
    {
      code: 'DASHBOARD',
      name: '생산현황 대시보드',
      description: 'KPI 및 생산현황 종합 대시보드',
      category: 'ANALYTICS',
      icon: 'LayoutDashboard',
      menuCodes: ['dashboard'],
      isCore: false,
      displayOrder: 80,
    },
  ]

  for (const f of newFeatures) {
    await prisma.featureDefinition.upsert({
      where: { code: f.code },
      update: f,
      create: f,
    })
    console.log(`✓ Feature upserted: ${f.code}`)
  }

  // 데모 테넌트에 활성화
  const tenant = await prisma.tenant.findFirst()
  if (!tenant) {
    console.error('테넌트를 찾을 수 없습니다.')
    return
  }

  const codesToEnable = [
    'EQUIPMENT_MANAGEMENT',
    'EQUIPMENT_MONITOR',
    'INSPECTION_STAGES',
    'DASHBOARD',
    // 기존에 누락됐을 수 있는 것들도 포함
    'EQUIPMENT_CONNECTION',
    'TAG_MANAGEMENT',
    'QUOTATION',
    'COSTING',
    'INVENTORY',
    'LOT_TRACKING',
  ]

  for (const code of codesToEnable) {
    const feat = await prisma.featureDefinition.findUnique({ where: { code } })
    if (!feat) {
      console.warn(`Feature not found: ${code}`)
      continue
    }
    await prisma.tenantFeature.upsert({
      where: { tenantId_featureId: { tenantId: tenant.id, featureId: feat.id } },
      update: { isEnabled: true },
      create: { tenantId: tenant.id, featureId: feat.id, isEnabled: true },
    })
    console.log(`✓ Enabled for tenant: ${code}`)
  }

  console.log('\n완료! 새로고침하면 메뉴가 보입니다.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
