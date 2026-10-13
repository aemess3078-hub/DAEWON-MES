import { getTenantId } from "@/lib/auth"
import { prisma } from "@/lib/db/prisma"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { TraceabilityClient } from "./traceability-client"

export const dynamic = "force-dynamic"

interface TraceabilityPageProps {
  searchParams: Promise<{ lotId?: string; lotNo?: string }>
}

export default async function TraceabilityPage({ searchParams }: TraceabilityPageProps) {
  const tenantId = await getTenantId()

  const enabled = await isFeatureEnabled(tenantId, "LOT_TRACKING")
  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">
          LOT 추적 기능이 활성화되어 있지 않습니다. 기능 관리 페이지에서 LOT_TRACKING을 활성화하세요.
        </p>
      </div>
    )
  }

  const params = await searchParams
  const lotFromId = params.lotId
    ? await prisma.lot.findFirst({
        where: { id: params.lotId, tenantId },
        select: { lotNo: true },
      })
    : null
  const initialLotNo = lotFromId?.lotNo ?? params.lotNo?.trim() ?? undefined

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          LOT 추적 조회
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          LOT 번호로 원자재부터 완제품까지 정/역추적합니다.
        </p>
      </div>

      <TraceabilityClient
        initialLotNo={initialLotNo}
        tenantId={tenantId}
      />
    </div>
  )
}
