export const dynamic = "force-dynamic"

import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { getTenantId } from "@/lib/auth"
import { getResourcePermissions } from "@/lib/auth/role-permissions"
import { getStockCountDetail } from "@/lib/actions/stock-count.actions"
import { isFeatureEnabled } from "@/lib/services/feature.service"
import { StockCountDetailClient } from "../stock-count-detail-client"

interface Props {
  params: Promise<{ id: string }>
}

export default async function StockCountDetailPage({ params }: Props) {
  const { id } = await params
  const tenantId = await getTenantId()
  if (!(await isFeatureEnabled(tenantId, "INVENTORY"))) notFound()
  const permissions = await getResourcePermissions("INVENTORY")
  if (!permissions.canRead) notFound()

  const detail = await getStockCountDetail(id)
  if (!detail) notFound()

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app/mes/stock-count" className="inline-flex items-center gap-1 text-[14px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          재고실사 목록
        </Link>
        <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-foreground">재고실사 {detail.countNo}</h1>
      </div>
      <StockCountDetailClient detail={detail} canUpdate={permissions.canUpdate} />
    </div>
  )
}
