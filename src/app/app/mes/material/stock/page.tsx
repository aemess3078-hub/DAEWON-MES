import { getGroupedMaterialInventoryBalances } from "@/lib/actions/inventory.actions"
import { MaterialStockDataTable } from "./material-stock-data-table"
import { formatQuantity } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function MaterialStockPage() {
  const groups = await getGroupedMaterialInventoryBalances()

  const totalItems = groups.length
  const totalLines = groups.reduce((s, g) => s + g.lotBalances.length, 0)
  const lotCount = groups.reduce((s, g) => s + g.lotCount, 0)
  const totalOnHand = groups.reduce((s, g) => s + g.totalQtyOnHand, 0)
  const totalAvailable = groups.reduce((s, g) => s + g.totalQtyAvailable, 0)
  const unlottedDeadStockBalances = groups.flatMap((g) =>
    g.isLotTracked
      ? g.lotBalances.filter((b) => !b.lotId && b.qtyOnHand > 0)
      : [],
  )
  const unlottedLines = unlottedDeadStockBalances.length
  const unlottedOnHand = unlottedDeadStockBalances.reduce((s, b) => s + b.qtyOnHand, 0)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          자재재고현황
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          원자재와 소모품의 LOT별 현재고를 조회합니다.
          품목 행을 클릭하면 LOT별 상세 재고를 확인할 수 있습니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <SummaryCard label="원자재 품목" value={formatQuantity(totalItems)} suffix="종" />
        <SummaryCard label="재고 라인" value={formatQuantity(totalLines)} suffix="건" />
        <SummaryCard label="관리 LOT" value={formatQuantity(lotCount)} suffix="개" />
        <SummaryCard label="총 현재고" value={formatQuantity(totalOnHand)} />
        <SummaryCard label="총 가용재고" value={formatQuantity(totalAvailable)} accent />
        <SummaryCard
          label="LOT 미지정 데드재고"
          value={formatQuantity(unlottedOnHand)}
          suffix={`/ ${formatQuantity(unlottedLines)}건`}
          description="LOT 관리 품목 중 LOT 없이 남아 있어 출고/출하 대상에서 제외되는 재고"
          warn
        />
      </div>

      <MaterialStockDataTable data={groups} />
    </div>
  )
}

function SummaryCard({
  label,
  value,
  suffix,
  description,
  accent,
  warn,
}: {
  label: string
  value: string
  suffix?: string
  description?: string
  accent?: boolean
  warn?: boolean
}) {
  const containerClass = warn
    ? "rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
    : "rounded-lg border border-border bg-card px-4 py-3"
  const labelClass = warn ? "text-[13px] text-amber-800" : "text-[13px] text-muted-foreground"
  const valueClass = warn
    ? "text-amber-800"
    : accent
      ? "text-emerald-700"
      : "text-foreground"
  return (
    <div className={containerClass}>
      <p className={labelClass}>{label}</p>
      <p className={`mt-1 text-[20px] font-semibold tabular-nums ${valueClass}`}>
        {value}
        {suffix ? (
          <span className={`ml-1 text-[14px] font-normal ${warn ? "text-amber-700" : "text-muted-foreground"}`}>
            {suffix}
          </span>
        ) : null}
      </p>
      {description ? (
        <p className={`mt-1 text-[12px] leading-snug ${warn ? "text-amber-700" : "text-muted-foreground"}`}>
          {description}
        </p>
      ) : null}
    </div>
  )
}
