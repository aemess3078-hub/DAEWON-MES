export const dynamic = "force-dynamic"

import { notFound } from "next/navigation"
import { getCodeGroups } from "@/lib/actions/common-code.actions"
import { CommonCodeManager } from "./common-code-manager"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { getCurrentUser, getTenantId } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"

export default async function CommonCodesPage() {
  const user = await getCurrentUser()
  if (!isDeveloperUser(user)) notFound()
  const tenantId = await getTenantId()
  const enabled = await isFeatureEnabled(tenantId, "COMMON_CODE")

  if (!enabled) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">이 기능은 활성화되어 있지 않습니다.</p>
      </div>
    )
  }

  const groups = await getCodeGroups()

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">코드관리</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          시스템에서 사용하는 공통 코드를 관리합니다
        </p>
      </div>
      <CommonCodeManager groups={groups} tenantId={tenantId} />
    </div>
  )
}
