import { getProductionKPIs } from "@/lib/actions/equipment-monitor.actions"
import { prisma } from "@/lib/db/prisma"
import { getTenantId } from "@/lib/auth"
import { isMissingDbObjectError } from "@/lib/db/prisma-error"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Gauge,
  Package,
  Wrench,
  ClipboardCheck,
  TrendingUp,
} from "lucide-react"
import Link from "next/link"
import { formatQuantity } from "@/lib/utils"
import { kstDateKeyToNextUtcStart, kstDateKeyToUtcStart, kstDefaultDateRange, toKstDateKey } from "@/lib/date/kst"

export const dynamic = "force-dynamic"

async function getExtendedKPIs() {
  const tenantId = await getTenantId()
  const todayKey = toKstDateKey(new Date())
  const todayStart = kstDateKeyToUtcStart(todayKey)
  const tomorrowStart = kstDateKeyToNextUtcStart(todayKey)

  // 운영 DB에 일부 테이블이 아직 없거나(P2021) 컬럼 드리프트(P2022)가 있어도
  // 첫 화면이 죽지 않도록 개별 쿼리를 방어한다. 누락 시 빈/0 값으로 표시한다.
  type OpenRepair = { id: string; title: string; equipment: { name: string }; priority: string }
  async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (isMissingDbObjectError(error)) return fallback
      throw error
    }
  }

  const [kpis, inspectionsToday, openRepairs, defectRate30d] = await Promise.all([
    getProductionKPIs(),
    safe(
      () => prisma.qualityInspection.count({
        where: {
          workOrderOperation: { workOrder: { tenantId } },
          inspectedAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      0,
    ),
    safe<OpenRepair[]>(
      () => prisma.equipmentRepairRequest.findMany({
        where: { tenantId, status: { in: ["OPEN", "IN_PROGRESS"] }, priority: { in: ["HIGH", "CRITICAL"] } },
        select: { id: true, title: true, equipment: { select: { name: true } }, priority: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      [],
    ),
    (async () => {
      const range = kstDefaultDateRange(30)
      const fromDate = kstDateKeyToUtcStart(range.from)
      const toExclusive = kstDateKeyToNextUtcStart(range.to)
      const [good, defect] = await Promise.all([
        safe(() => prisma.productionResult.aggregate({
          where: {
            workOrderOperation: { workOrder: { tenantId } },
            endedAt: { gte: fromDate, lt: toExclusive },
          },
          _sum: { goodQty: true },
        }), { _sum: { goodQty: null } }),
        safe(() => prisma.productionResult.aggregate({
          where: {
            workOrderOperation: { workOrder: { tenantId } },
            endedAt: { gte: fromDate, lt: toExclusive },
          },
          _sum: { defectQty: true },
        }), { _sum: { defectQty: null } }),
      ])
      const g = Number(good._sum?.goodQty ?? 0)
      const d = Number(defect._sum?.defectQty ?? 0)
      return g + d > 0 ? ((d / (g + d)) * 100).toFixed(2) : "0.00"
    })(),
  ])

  return { kpis, inspectionsToday, openRepairs, defectRate30d }
}

export default async function DashboardPage() {
  // 첫 진입 화면은 어떤 경우에도 오류 화면으로 떨어지지 않도록 최종 방어한다.
  const DEFAULT_KPIS = {
    kpis: {
      activeWorkOrders: 0,
      todayGoodQty: 0,
      todayDefectQty: 0,
      defectRate: "0.0",
      openRepairs: 0,
      failedChecks: 0,
      equipmentAvailability: "0.0",
    },
    inspectionsToday: 0,
    openRepairs: [] as Awaited<ReturnType<typeof getExtendedKPIs>>["openRepairs"],
    defectRate30d: "0.00",
  }
  const { kpis, inspectionsToday, openRepairs, defectRate30d } = await getExtendedKPIs().catch(
    (e) => {
      console.error("[dashboard] KPI 조회 실패 — 기본값으로 렌더:", e)
      return DEFAULT_KPIS
    },
  )

  const PRIORITY_COLOR: Record<string, string> = {
    CRITICAL: "text-red-600",
    HIGH: "text-orange-600",
    MEDIUM: "text-yellow-600",
    LOW: "text-slate-500",
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            생산현황 대시보드
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1">
            오늘의 주요 생산·품질·설비 지표를 한눈에 확인합니다.
          </p>
        </div>
        <Link
          href="/kiosk"
          target="_blank"
          className="inline-flex items-center gap-2 text-[14px] px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
        >
          <Activity className="h-4 w-4" />
          스마트TV 현황판
        </Link>
      </div>

      {/* Main KPI Grid */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Activity className="h-4 w-4 text-blue-600" />
              </div>
              <p className="text-[14px] text-muted-foreground">진행 작업지시</p>
            </div>
            <p className="text-[32px] font-bold">{formatQuantity(kpis.activeWorkOrders)}</p>
            <p className="text-[13px] text-muted-foreground mt-1">건 진행 중</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-green-50 rounded-lg">
                <Package className="h-4 w-4 text-green-600" />
              </div>
              <p className="text-[14px] text-muted-foreground">오늘 양품 생산</p>
            </div>
            <p className="text-[32px] font-bold text-green-700">{formatQuantity(kpis.todayGoodQty)}</p>
            <p className="text-[13px] text-muted-foreground mt-1">ea</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-orange-50 rounded-lg">
                <Gauge className="h-4 w-4 text-orange-600" />
              </div>
              <p className="text-[14px] text-muted-foreground">불량률 (오늘)</p>
            </div>
            <p className={`text-[32px] font-bold ${Number(kpis.defectRate) > 3 ? "text-red-600" : "text-foreground"}`}>
              {kpis.defectRate}%
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">30일 평균: {defectRate30d}%</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-emerald-50 rounded-lg">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-[14px] text-muted-foreground">설비 가동률</p>
            </div>
            <p className="text-[32px] font-bold text-emerald-700">{kpis.equipmentAvailability}%</p>
            <p className="text-[13px] text-muted-foreground mt-1">설비 가동 현황</p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-red-50 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </div>
              <p className="text-[14px] text-muted-foreground">오늘 불량 수량</p>
            </div>
            <p className="text-[28px] font-bold text-red-600">{formatQuantity(kpis.todayDefectQty)}</p>
            <p className="text-[13px] text-muted-foreground mt-1">ea</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-purple-50 rounded-lg">
                <ClipboardCheck className="h-4 w-4 text-purple-600" />
              </div>
              <p className="text-[14px] text-muted-foreground">오늘 검사 건수</p>
            </div>
            <p className="text-[28px] font-bold">{formatQuantity(inspectionsToday)}</p>
            <p className="text-[13px] text-muted-foreground mt-1">건 검사 완료</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 bg-yellow-50 rounded-lg">
                <Wrench className="h-4 w-4 text-yellow-600" />
              </div>
              <p className="text-[14px] text-muted-foreground">수리 대기</p>
            </div>
            <p className="text-[28px] font-bold text-yellow-700">{formatQuantity(kpis.openRepairs)}</p>
            <p className="text-[13px] text-muted-foreground mt-1">건 미완료</p>
          </CardContent>
        </Card>
      </div>

      {/* Priority Repairs */}
      {openRepairs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-[18px] flex items-center gap-2">
              <Wrench className="h-4 w-4 text-red-600" />
              긴급/우선 수리 요청
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {openRepairs.map((repair) => (
                <div
                  key={repair.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/40"
                >
                  <div>
                    <p className="text-[14px] font-medium">{repair.title}</p>
                    <p className="text-[13px] text-muted-foreground">{repair.equipment.name}</p>
                  </div>
                  <span className={`text-[13px] font-semibold ${PRIORITY_COLOR[repair.priority]}`}>
                    {repair.priority === "CRITICAL" ? "긴급" : "높음"}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Link href="/app/mes/equipment-repair" className="text-[13px] text-primary hover:underline">
                수리요청 전체 보기 →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { href: "/app/mes/equipment-monitor", label: "설비 모니터링", icon: Activity },
          { href: "/app/mes/inspection-stages", label: "초·중·종 검사", icon: ClipboardCheck },
          { href: "/app/mes/equipment-repair", label: "수리요청 관리", icon: Wrench },
          { href: "/app/mes/work-orders", label: "작업지시", icon: Package },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex items-center gap-3 p-4 rounded-lg border hover:bg-muted/50 transition-colors"
          >
            <link.icon className="h-5 w-5 text-muted-foreground" />
            <span className="text-[14px] font-medium">{link.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
