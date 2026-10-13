export const dynamic = "force-dynamic"

import { getSites } from "@/lib/actions/site.actions"
import { SiteDataTable } from "./site-data-table"

export default async function SitesPage() {
  const sites = await getSites()

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[27px] font-bold tracking-tight">사업장관리</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          공장/창고 사이트를 등록하고 소속 로케이션을 확인합니다
        </p>
      </div>
      <SiteDataTable data={sites} />
    </div>
  )
}
