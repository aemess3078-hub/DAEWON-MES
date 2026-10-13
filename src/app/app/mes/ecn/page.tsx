import { redirect } from "next/navigation"
import { getCurrentUser } from "@/lib/auth"
import { isDeveloperUser } from "@/lib/developer"
import { getECNs, getItemsForECN } from "@/lib/actions/ecn.actions"
import { ECNDataTable } from "./ecn-data-table"

export const dynamic = "force-dynamic"

export default async function ECNPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  const tenantId = user.tenantId

  // OWNER / ADMIN / MANAGER / 개발자 계정은 전체 조회 허용
  const isAdmin =
    isDeveloperUser(user) ||
    user.role === "OWNER" ||
    user.role === "ADMIN" ||
    user.role === "MANAGER"

  const [ecns, items] = await Promise.all([
    getECNs(tenantId, user.profileId, isAdmin),
    getItemsForECN(tenantId),
  ])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-[26px] font-bold">변경관리</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          BOM·라우팅 변경 요청, 승인, 적용을 관리합니다.
          {!isAdmin && (
            <span className="ml-2 text-amber-600">
              (본인이 등록한 변경요청만 표시됩니다)
            </span>
          )}
        </p>
      </div>
      <ECNDataTable
        ecns={ecns}
        items={items}
        tenantId={tenantId}
        userId={user.profileId}
        userRole={user.role}
        isAdmin={isAdmin}
      />
    </div>
  )
}
