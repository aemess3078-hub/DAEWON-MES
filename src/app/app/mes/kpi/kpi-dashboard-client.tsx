"use client"

import { useState, useTransition, useRef, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import type {
  KpiDashboardData,
  KpiFilterOptions,
  ManufacturingLeadTimeKpi,
  DefectRateKpi,
  LaborEffortKpi,
  DeliveryLeadTimeKpi,
  UphKpi,
  EquipmentAvailabilityKpi,
} from "@/lib/actions/kpi.actions"
import { formatQuantity } from "@/lib/utils"

type KpiId =
  | "manufacturingLeadTime"
  | "defectRate"
  | "laborEffort"
  | "deliveryLeadTime"
  | "powerUsage"
  | "uph"
  | "equipmentAvailability"

interface Props {
  data: KpiDashboardData
  filterOptions: KpiFilterOptions
}

// ─── 공통 테이블 ──────────────────────────────────────────────────────────────

function SimpleTable({
  headers,
  rows,
  emptyMessage = "데이터 없음",
}: {
  headers: string[]
  rows: (string | number | null)[][]
  emptyMessage?: string
}) {
  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-[14px] text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h) => (
              <th
                key={h}
                className="px-3 py-2 text-left text-[13px] font-medium text-muted-foreground whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 text-foreground whitespace-nowrap">
                  {cell ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtDate(iso: string) {
  return iso.slice(0, 10)
}

// ─── 상세 컴포넌트 ────────────────────────────────────────────────────────────

function ManufacturingLeadTimeDetail({ data }: { data: ManufacturingLeadTimeKpi }) {
  return (
    <div className="space-y-3">
      <p className="text-[14px] font-medium text-foreground">최근 완료 작업지시</p>
      <SimpleTable
        headers={["작업번호", "품목", "시작일", "완료일", "리드타임"]}
        rows={data.rows.map((r) => [
          r.orderNo,
          r.itemName,
          fmtDate(r.createdAt),
          fmtDate(r.completedAt),
          `${r.leadTimeDays}일`,
        ])}
        emptyMessage="조회 기간 내 완료된 작업지시 없음"
      />
    </div>
  )
}

function DefectRateDetail({ data }: { data: DefectRateKpi }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="rounded-md border border-border bg-muted/20 py-3">
          <p className="text-[13px] text-muted-foreground">검사 건수</p>
          <p className="text-[20px] font-semibold tabular-nums text-foreground mt-1">
            {formatQuantity(data.inspectionCount)}
          </p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 py-3">
          <p className="text-[13px] text-muted-foreground">검사 수량</p>
          <p className="text-[20px] font-semibold tabular-nums text-foreground mt-1">
            {formatQuantity(data.inspectedQty)}
          </p>
        </div>
        <div className="rounded-md border border-border bg-muted/20 py-3">
          <p className="text-[13px] text-muted-foreground">불량 수량</p>
          <p className="text-[20px] font-semibold tabular-nums text-foreground mt-1">
            {formatQuantity(data.defectQty)}
          </p>
        </div>
      </div>
      <div>
        <p className="text-[14px] font-medium text-foreground mb-2">불량 유형 TOP 5</p>
        <SimpleTable
          headers={["불량 유형", "수량", "비율"]}
          rows={data.topDefects.map((d) => [d.name, formatQuantity(d.qty), `${d.pct}%`])}
          emptyMessage="불량 데이터 없음"
        />
      </div>
    </div>
  )
}

function LaborEffortDetail({ data }: { data: LaborEffortKpi }) {
  return (
    <div className="space-y-3">
      <p className="text-[14px] font-medium text-foreground">일별 작업공수</p>
      <SimpleTable
        headers={["날짜", "작업시간(h)", "양품수"]}
        rows={data.rows.map((r) => [r.date, r.hours, formatQuantity(r.goodQty)])}
        emptyMessage="조회 기간 내 작업 실적 없음"
      />
    </div>
  )
}

function DeliveryLeadTimeDetail({ data }: { data: DeliveryLeadTimeKpi }) {
  return (
    <div className="space-y-3">
      <p className="text-[14px] font-medium text-foreground">최근 납품 내역</p>
      <SimpleTable
        headers={["납품번호", "수주일", "납품일", "리드타임"]}
        rows={data.rows.map((r) => [
          r.shipmentNo,
          fmtDate(r.orderDate),
          fmtDate(r.deliveredDate),
          `${r.leadTimeDays}일`,
        ])}
        emptyMessage="조회 기간 내 납품 완료 건 없음"
      />
    </div>
  )
}

function UphDetail({ data }: { data: UphKpi }) {
  return (
    <div className="space-y-3">
      <p className="text-[14px] font-medium text-foreground">일별 UPH</p>
      <SimpleTable
        headers={["날짜", "품목코드", "품목명", "양품수", "작업시간(h)", "UPH"]}
        rows={data.rows.map((r) => [
          r.date,
          r.itemCode,
          r.itemName,
          formatQuantity(r.goodQty),
          r.hours,
          r.uph != null ? r.uph : "—",
        ])}
        emptyMessage="조회 기간 내 생산 실적 없음"
      />
    </div>
  )
}

function EquipmentAvailabilityDetail({ data }: { data: EquipmentAvailabilityKpi }) {
  return (
    <div className="space-y-3">
      <p className="text-[14px] font-medium text-foreground">설비별 가동률</p>
      <SimpleTable
        headers={["설비코드", "설비명", "가동시간(분)", "가동률"]}
        rows={data.rows.map((r) => [
          r.code,
          r.name,
          r.runMinutes > 0 ? r.runMinutes.toLocaleString() : "—",
          r.rate != null ? `${(r.rate * 100).toFixed(1)}%` : "—",
        ])}
        emptyMessage="설비 가동 이벤트 데이터 없음"
      />
    </div>
  )
}

// ─── 메인 대시보드 ────────────────────────────────────────────────────────────

export function KpiDashboardClient({ data, filterOptions }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [activeKpi, setActiveKpi] = useState<KpiId | null>(null)
  const [from, setFrom] = useState(data.filter.from)
  const [to, setTo] = useState(data.filter.to)
  const [itemId, setItemId] = useState(data.filter.itemId ?? "")
  const [equipmentIds, setEquipmentIds] = useState<string[]>(data.filter.equipmentIds ?? [])
  const [equipDropOpen, setEquipDropOpen] = useState(false)
  const detailRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeKpi) {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    }
  }, [activeKpi])

  useEffect(() => {
    if (!equipDropOpen) return
    const close = () => setEquipDropOpen(false)
    document.addEventListener("click", close)
    return () => document.removeEventListener("click", close)
  }, [equipDropOpen])

  function handleFilterApply() {
    const params = new URLSearchParams()
    params.set("from", from)
    params.set("to", to)
    if (itemId) params.set("itemId", itemId)
    if (equipmentIds.length) params.set("equipmentIds", equipmentIds.join(","))
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  function toggleEquipment(id: string) {
    setEquipmentIds((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    )
  }

  function toggleKpi(id: KpiId) {
    setActiveKpi((prev) => (prev === id ? null : id))
  }

  type CardDef = {
    id: KpiId
    label: string
    value: string | null
    subtitle: string
    meta: string
    unavailable?: boolean
    unavailableReason?: string
  }

  const cards: CardDef[] = [
    {
      id: "manufacturingLeadTime",
      label: "제조리드타임",
      value:
        data.manufacturingLeadTime.avgDays != null
          ? `${data.manufacturingLeadTime.avgDays}일`
          : null,
      subtitle: "평균 리드타임",
      meta: `완료 ${formatQuantity(data.manufacturingLeadTime.orderCount)}건`,
    },
    {
      id: "defectRate",
      label: "품질불량률",
      value:
        data.defectRate.defectRate != null
          ? `${(data.defectRate.defectRate * 100).toFixed(2)}%`
          : null,
      subtitle: "불량률 (검사 기준)",
      meta: `검사 ${formatQuantity(data.defectRate.inspectionCount)}건`,
    },
    {
      id: "laborEffort",
      label: "작업공수",
      value:
        data.laborEffort.totalHours != null
          ? `${data.laborEffort.totalHours}h`
          : null,
      subtitle: "총 작업시간",
      meta: `실적 ${formatQuantity(data.laborEffort.resultCount)}건`,
    },
    {
      id: "deliveryLeadTime",
      label: "수주/납품리드타임",
      value:
        data.deliveryLeadTime.avgDays != null
          ? `${data.deliveryLeadTime.avgDays}일`
          : null,
      subtitle: "평균 납품 리드타임",
      meta: `납품 ${formatQuantity(data.deliveryLeadTime.count)}건`,
    },
    {
      id: "powerUsage",
      label: "전력사용량",
      value: null,
      subtitle: "",
      meta: "",
      unavailable: true,
      unavailableReason: data.powerUsage.reason,
    },
    {
      id: "uph",
      label: "UPH",
      value: data.uph.avgUph != null ? String(data.uph.avgUph) : null,
      subtitle: "시간당 생산량",
      meta: `양품 ${formatQuantity(data.uph.totalGoodQty)}개 · ${data.uph.totalHours}h`,
    },
    {
      id: "equipmentAvailability",
      label: "설비가동률",
      value:
        data.equipmentAvailability.avgRate != null
          ? `${(data.equipmentAvailability.avgRate * 100).toFixed(1)}%`
          : null,
      subtitle: "평균 가동률",
      meta: `설비 ${formatQuantity(data.equipmentAvailability.equipmentCount)}대`,
    },
  ]

  const selectedItem = filterOptions.items.find((i) => i.id === itemId)
  const selectedEquipNames = filterOptions.equipments
    .filter((e) => equipmentIds.includes(e.id))
    .map((e) => e.name)

  return (
    <div className="space-y-6">
      {/* 필터 영역 */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        {/* 기간 필터 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[14px] text-muted-foreground w-10">기간</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-[14px] bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-[14px] text-muted-foreground">~</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-[14px] bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        {/* 품목 필터 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[14px] text-muted-foreground w-10">품목</span>
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-[14px] bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[200px]"
          >
            <option value="">전체 품목</option>
            {filterOptions.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.code})
              </option>
            ))}
          </select>
          {selectedItem && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[13px]">
              {selectedItem.name}
              <button onClick={() => setItemId("")} className="hover:text-blue-900">✕</button>
            </span>
          )}
        </div>
        {/* 설비 필터 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[14px] text-muted-foreground w-10">설비</span>
          <div className="relative">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEquipDropOpen((o) => !o) }}
              className="border border-border rounded-md px-3 py-1.5 text-[14px] bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[200px] text-left flex items-center justify-between gap-2"
            >
              <span className="truncate">
                {equipmentIds.length === 0
                  ? "전체 설비"
                  : `${equipmentIds.length}개 선택`}
              </span>
              <span className="text-[12px]">▼</span>
            </button>
            {equipDropOpen && (
              <div
                className="absolute z-20 top-full left-0 mt-1 w-64 max-h-60 overflow-y-auto rounded-md border border-border bg-background shadow-md"
                onClick={(e) => e.stopPropagation()}
              >
                {filterOptions.equipments.length === 0 ? (
                  <p className="px-3 py-2 text-[13px] text-muted-foreground">설비 없음</p>
                ) : (
                  filterOptions.equipments.map((eq) => (
                    <label
                      key={eq.id}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 cursor-pointer text-[14px]"
                    >
                      <input
                        type="checkbox"
                        checked={equipmentIds.includes(eq.id)}
                        onChange={() => toggleEquipment(eq.id)}
                        className="rounded border-border"
                      />
                      <span>{eq.name} ({eq.code})</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
          {selectedEquipNames.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selectedEquipNames.map((name) => (
                <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[13px]">
                  {name}
                  <button
                    onClick={() => {
                      const eq = filterOptions.equipments.find((e) => e.name === name)
                      if (eq) toggleEquipment(eq.id)
                    }}
                    className="hover:text-violet-900"
                  >✕</button>
                </span>
              ))}
              <button
                onClick={() => setEquipmentIds([])}
                className="text-[12px] text-muted-foreground hover:text-foreground"
              >
                전체 해제
              </button>
            </div>
          )}
        </div>
        {/* 조회 버튼 */}
        <div className="flex justify-end">
          <button
            onClick={handleFilterApply}
            disabled={isPending}
            className="px-4 py-1.5 rounded-md text-[14px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? "조회중…" : "조회"}
          </button>
        </div>
      </div>

      {/* KPI 카드 그리드 */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map((card) => {
          const isActive = activeKpi === card.id
          return (
            <button
              key={card.id}
              onClick={() => !card.unavailable && toggleKpi(card.id)}
              disabled={card.unavailable}
              className={[
                "text-left rounded-lg border bg-card px-5 py-4 transition-all",
                card.unavailable
                  ? "opacity-60 cursor-default border-border"
                  : isActive
                    ? "border-primary shadow-sm ring-1 ring-primary"
                    : "border-border hover:border-primary/50 hover:shadow-sm cursor-pointer",
              ].join(" ")}
            >
              <p className="text-[13px] font-medium text-muted-foreground mb-3">
                {card.label}
              </p>

              {card.unavailable ? (
                <p className="text-[14px] text-muted-foreground">
                  {card.unavailableReason}
                </p>
              ) : card.value != null ? (
                <>
                  <p className="text-[26px] font-semibold tabular-nums text-foreground leading-tight">
                    {card.value}
                  </p>
                  <p className="text-[13px] text-muted-foreground mt-1">{card.subtitle}</p>
                </>
              ) : (
                <p className="text-[14px] text-muted-foreground">데이터 없음</p>
              )}

              {!card.unavailable && (
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[12px] text-muted-foreground">{card.meta}</span>
                  <span className="text-[12px] text-primary">
                    {isActive ? "▲ 접기" : "▼ 상세"}
                  </span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* 아코디언 상세 패널 */}
      {activeKpi && (
        <div
          ref={detailRef}
          className="rounded-lg border border-primary/30 bg-card p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <p className="text-[18px] font-semibold text-foreground">
              {cards.find((c) => c.id === activeKpi)?.label} 상세
            </p>
            <button
              onClick={() => setActiveKpi(null)}
              className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
            >
              닫기 ✕
            </button>
          </div>

          <hr className="border-border" />

          {activeKpi === "manufacturingLeadTime" && (
            <ManufacturingLeadTimeDetail data={data.manufacturingLeadTime} />
          )}
          {activeKpi === "defectRate" && (
            <DefectRateDetail data={data.defectRate} />
          )}
          {activeKpi === "laborEffort" && (
            <LaborEffortDetail data={data.laborEffort} />
          )}
          {activeKpi === "deliveryLeadTime" && (
            <DeliveryLeadTimeDetail data={data.deliveryLeadTime} />
          )}
          {activeKpi === "uph" && <UphDetail data={data.uph} />}
          {activeKpi === "equipmentAvailability" && (
            <EquipmentAvailabilityDetail data={data.equipmentAvailability} />
          )}
        </div>
      )}
    </div>
  )
}
