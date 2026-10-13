import {
  getEquipmentCapacityStats,
  getEquipmentOptions,
} from "@/lib/actions/equipment-statistics.actions"
import { CapacityClient } from "./capacity-client"
import { Card, CardContent } from "@/components/ui/card"
import { AlertTriangle, Cpu, Gauge, TrendingUp } from "lucide-react"
import { formatQuantity } from "@/lib/utils"

export const dynamic = "force-dynamic"

interface Props {
  searchParams?: Promise<{
    from?: string
    to?: string
    equipmentId?: string
  }>
}

export default async function CapacityPage({ searchParams }: Props) {
  const params = searchParams ? await searchParams : {}

  const [data, equipmentOptions] = await Promise.all([
    getEquipmentCapacityStats({
      from: params.from?.trim() || undefined,
      to: params.to?.trim() || undefined,
      equipmentId: params.equipmentId?.trim() || undefined,
    }),
    getEquipmentOptions(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          설비 처리능력(CAPA) 분석
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          설비별 UPH와 달성률을 분석하고 병목 설비를 식별합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg shrink-0">
              <Cpu className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <p className="text-[13px] text-muted-foreground">분석 설비</p>
              <p className="text-[22px] font-semibold leading-tight">
                {formatQuantity(data.totalEquipmentCount)}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">대</span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg shrink-0">
              <Gauge className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-[13px] text-muted-foreground">평균 UPH</p>
              <p className="text-[22px] font-semibold leading-tight text-blue-700">
                {data.avgUPH !== null ? data.avgUPH.toLocaleString() : "-"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-emerald-50 rounded-lg shrink-0">
              <TrendingUp className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-[13px] text-muted-foreground">평균 달성률</p>
              <p className="text-[22px] font-semibold leading-tight text-emerald-700">
                {data.avgAchievementRate !== null ? `${data.avgAchievementRate}%` : "-"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className={data.bottleneckCount > 0 ? "border-red-300" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg shrink-0 ${data.bottleneckCount > 0 ? "bg-red-50" : "bg-slate-50"}`}>
              <AlertTriangle className={`h-5 w-5 ${data.bottleneckCount > 0 ? "text-red-600" : "text-slate-400"}`} />
            </div>
            <div>
              <p className="text-[13px] text-muted-foreground">병목 설비</p>
              <p className={`text-[22px] font-semibold leading-tight ${data.bottleneckCount > 0 ? "text-red-600" : "text-slate-500"}`}>
                {formatQuantity(data.bottleneckCount)}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">대</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <CapacityClient data={data} equipmentOptions={equipmentOptions} />
    </div>
  )
}
