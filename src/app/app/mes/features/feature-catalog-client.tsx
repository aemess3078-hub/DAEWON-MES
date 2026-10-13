"use client"

import { Badge } from "@/components/ui/badge"

const CATEGORY_LABELS: Record<string, string> = {
  MASTER: "기준정보",
  PRODUCTION: "생산관리",
  MATERIAL: "자재/재고",
  QUALITY: "품질검사",
  EQUIPMENT: "설비관리",
  SYSTEM: "시스템",
  SALES: "영업관리",
  PURCHASE: "구매관리",
  ANALYTICS: "분석",
}

type CatalogItem = {
  id: string
  code: string
  name: string
  description: string | null
  category: string
  icon: string | null
  isCore: boolean
  isEnabled: boolean
  displayOrder: number
  dependencies: { dependsOn: { code: string; name: string }; isRequired: boolean }[]
}

type Props = { catalog: CatalogItem[]; tenantId: string }

export function FeatureCatalogClient({ catalog }: Props) {
  const categories = Array.from(new Set(catalog.map((feature) => feature.category)))

  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-800">
        운영 감리 기간에는 기능 ON/OFF 제한을 적용하지 않습니다. 아래 기능은 모두 활성 상태로 처리됩니다.
      </div>

      {categories.map((category) => (
        <section key={category} className="space-y-4">
          <h2 className="text-[18px] font-semibold text-slate-700">
            {CATEGORY_LABELS[category] ?? category}
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {catalog
              .filter((feature) => feature.category === category)
              .map((feature) => (
                <div key={feature.id} className="rounded-lg border border-blue-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-semibold text-slate-800">
                          {feature.name}
                        </span>
                        {feature.isCore && (
                          <Badge variant="secondary" className="text-[13px]">
                            필수
                          </Badge>
                        )}
                        <Badge className="border border-blue-200 bg-blue-100 text-[13px] text-blue-700 hover:bg-blue-100">
                          활성
                        </Badge>
                      </div>
                      {feature.description && (
                        <p className="mt-1 text-[13px] text-slate-500">
                          {feature.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {feature.dependencies.length > 0 && (
                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="mb-1.5 text-[13px] text-slate-500">의존 기능</p>
                      <div className="flex flex-wrap gap-1">
                        {feature.dependencies.map((dep) => (
                          <span
                            key={dep.dependsOn.code}
                            className="rounded-full border border-slate-100 bg-slate-50 px-2 py-0.5 text-[13px] text-slate-600"
                          >
                            {dep.isRequired ? "필수: " : "선택: "}
                            {dep.dependsOn.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </section>
      ))}
    </div>
  )
}
