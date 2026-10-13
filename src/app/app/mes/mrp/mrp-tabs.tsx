"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MrpDashboard } from "./mrp-dashboard"
import { OrderMrpPanel } from "./order-mrp-panel"

type Props = {
  plans: React.ComponentProps<typeof MrpDashboard>["plans"]
  tenantId: string
  siteId: string
}

/**
 * 수주기준 MRP(대원정밀 기본) + 기존 생산계획 MRP(그대로 유지).
 * 두 탭은 서로 다른 입력(수주 vs 생산계획)을 사용한다.
 */
export function MrpTabs({ plans, tenantId, siteId }: Props) {
  return (
    <Tabs defaultValue="order" className="space-y-6">
      <TabsList>
        <TabsTrigger value="order" className="text-[14px]">
          수주기준 MRP
        </TabsTrigger>
        <TabsTrigger value="plan" className="text-[14px]">
          생산계획 MRP
        </TabsTrigger>
      </TabsList>
      <TabsContent value="order" className="mt-0">
        <OrderMrpPanel />
      </TabsContent>
      <TabsContent value="plan" className="mt-0 space-y-4">
        <div>
          <h2 className="text-[20px] font-semibold">생산계획 기반 자재소요량</h2>
          <p className="text-[14px] text-muted-foreground mt-1">
            생산계획 기반 BOM 전개 → 자재 소요량 계산 → AI 발주 제안
          </p>
        </div>
        <MrpDashboard plans={plans} tenantId={tenantId} siteId={siteId} />
      </TabsContent>
    </Tabs>
  )
}
