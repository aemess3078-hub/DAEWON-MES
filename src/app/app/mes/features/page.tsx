export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { getCatalogWithStatus } from "@/lib/actions/feature.actions"
import { FeatureCatalogClient } from "./feature-catalog-client"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"

export default async function FeaturesPage() {
  const user = await getCurrentUser()
  if (!user || !isDeveloperUser(user)) notFound()

  const tenantId = user.tenantId
  const catalog = await getCatalogWithStatus(tenantId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            기능 관리
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            현재는 기능 제한을 적용하지 않고 모든 구현 메뉴를 활성 상태로 처리합니다.
          </p>
        </div>
      </div>
      <FeatureCatalogClient catalog={catalog} tenantId={tenantId} />
    </div>
  )
}
