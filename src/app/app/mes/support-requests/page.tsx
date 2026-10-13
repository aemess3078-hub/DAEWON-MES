export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"
import { getSupportRequests } from "@/lib/actions/support-request.actions"
import { SupportRequestsClient } from "./support-requests-client"

export default async function SupportRequestsPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  // tenantId는 인증된 사용자(JWT) 기준 사용.
  // 평문 "tenantId" 쿠키 fallback은 tenant-demo-001로 잘못 조회되는 버그가 있었음.
  const tenantId = user.tenantId

  // 관리자: ADMIN 이상 역할 또는 개발자 계정
  const isAdmin =
    isDeveloperUser(user) ||
    user.role === "OWNER" ||
    user.role === "ADMIN" ||
    user.role === "MANAGER"

  const items = await getSupportRequests(tenantId, user.profileId, isAdmin)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
            요청사항 / 오류 신고
          </h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            요청사항이나 오류를 등록하면 담당자에게 전달됩니다. 처리 상태는 아래 목록에서 확인할 수 있습니다.
          </p>
        </div>
      </div>

      <SupportRequestsClient
        initialData={items}
        tenantId={tenantId}
        currentProfileId={user.profileId}
        isAdmin={isAdmin}
      />
    </div>
  )
}
