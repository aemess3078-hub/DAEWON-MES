import {
  getSpcProfiles,
  getSpcProfileTargets,
  getSpcFilterOptions,
  getSpcAnalysis,
  type SpcAnalysisFilter,
} from "@/lib/actions/spc.actions"
import { kstDefaultDateRange, isValidKstDateRange } from "@/lib/date/kst"
import { SpcClient } from "./spc-client"

export const dynamic = "force-dynamic"

interface SpcPageProps {
  searchParams?: Promise<{
    profileId?: string
    from?: string
    to?: string
    siteId?: string
    manufacturingNo?: string
    equipmentId?: string
  }>
}

export default async function SpcPage({ searchParams }: SpcPageProps) {
  const params = searchParams ? await searchParams : {}
  const { from: defaultFrom, to: defaultTo } = kstDefaultDateRange(30)

  const rawFrom = params.from?.trim()
  const rawTo = params.to?.trim()
  const bothValid = !!rawFrom && !!rawTo && isValidKstDateRange(rawFrom, rawTo)

  const filter: SpcAnalysisFilter = {
    spcProfileId: params.profileId?.trim() || "",
    from: bothValid ? rawFrom! : defaultFrom,
    to: bothValid ? rawTo! : defaultTo,
    siteId: params.siteId?.trim() || undefined,
    manufacturingNo: params.manufacturingNo?.trim() || undefined,
    equipmentId: params.equipmentId?.trim() || undefined,
  }

  const [profiles, targets, filterOptions, analysis] = await Promise.all([
    getSpcProfiles(),
    getSpcProfileTargets(),
    getSpcFilterOptions(),
    getSpcAnalysis(filter),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          SPC 통계분석
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          검사항목별 실측값을 기준으로 관리도(I-MR)·공정능력(Cp/Cpk)·Histogram을 조회합니다.
        </p>
      </div>

      <SpcClient
        initialFilter={{
          profileId: filter.spcProfileId,
          from: filter.from!,
          to: filter.to!,
          siteId: filter.siteId ?? "",
          manufacturingNo: filter.manufacturingNo ?? "",
          equipmentId: filter.equipmentId ?? "",
        }}
        profiles={profiles}
        targets={targets}
        filterOptions={filterOptions}
        analysis={analysis}
      />
    </div>
  )
}
