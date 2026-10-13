"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  BarChart,
  Bar,
} from "recharts"
import { Plus, Pencil, Trash2, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Switch } from "@/components/ui/switch"
import { FormSheet } from "@/components/common/form-sheet/form-sheet"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type {
  SpcProfileRow,
  SpcProfileTargetSpec,
  SpcFilterOptions,
  SpcAnalysisResult,
} from "@/lib/actions/spc.actions"
import {
  createSpcProfile,
  updateSpcProfile,
  deleteSpcProfile,
} from "@/lib/actions/spc.actions"

// ─── 상수/유틸 ────────────────────────────────────────────────────────────────

const NONE_VALUE = "__ALL__"

const CAPABILITY_STATUS_LABEL: Record<string, string> = {
  DATA_INSUFFICIENT: "데이터 부족(N<30)",
  ZERO_VARIANCE: "분산 없음(표준편차 0)",
  NO_SPEC_LIMIT: "규격 없음",
}

function fmt(value: number | null | undefined, digits = 3): string {
  if (value == null || Number.isNaN(value)) return "—"
  return value.toFixed(digits)
}

function fmtPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—"
  return `${(value * 100).toFixed(digits)}%`
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─── 타입 ─────────────────────────────────────────────────────────────────────

type FilterState = {
  profileId: string
  from: string
  to: string
  siteId: string
  manufacturingNo: string
  equipmentId: string
}

interface SpcClientProps {
  initialFilter: FilterState
  profiles: SpcProfileRow[]
  targets: SpcProfileTargetSpec[]
  filterOptions: SpcFilterOptions
  analysis: SpcAnalysisResult
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function SpcClient({
  initialFilter,
  profiles,
  targets,
  filterOptions,
  analysis,
}: SpcClientProps) {
  const router = useRouter()
  const [filter, setFilter] = useState<FilterState>(initialFilter)
  const [isPending, startTransition] = useTransition()
  const [manageOpen, setManageOpen] = useState(false)
  const [profileSheetOpen, setProfileSheetOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<SpcProfileRow | null>(null)

  function pushFilter(next: FilterState) {
    setFilter(next)
    const params = new URLSearchParams()
    if (next.profileId) params.set("profileId", next.profileId)
    params.set("from", next.from)
    params.set("to", next.to)
    if (next.siteId) params.set("siteId", next.siteId)
    if (next.manufacturingNo) params.set("manufacturingNo", next.manufacturingNo)
    if (next.equipmentId) params.set("equipmentId", next.equipmentId)
    startTransition(() => router.push(`/app/mes/spc?${params.toString()}`))
  }

  function resetFilter() {
    pushFilter({
      profileId: filter.profileId,
      from: initialFilter.from,
      to: initialFilter.to,
      siteId: "",
      manufacturingNo: "",
      equipmentId: "",
    })
  }

  async function handleDeleteProfile(profile: SpcProfileRow) {
    if (!confirm(`"${profile.name}" Profile을 삭제하시겠습니까?`)) return
    try {
      await deleteSpcProfile(profile.id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  const activeProfiles = profiles.filter((p) => p.isActive)

  return (
    <div className="space-y-6">
      {/* ─── 조회조건 ─────────────────────────────────────────────────── */}
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-[14px] font-medium text-foreground">조회조건</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}>
            SPC Profile 관리
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-[13px]">SPC Profile / 검사항목</Label>
            <Select
              value={filter.profileId || NONE_VALUE}
              onValueChange={(v) =>
                pushFilter({ ...filter, profileId: v === NONE_VALUE ? "" : v })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Profile을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>선택 안 함</SelectItem>
                {activeProfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} — [{p.itemCode}] {p.itemName} / {p.routingOperationName} / {p.inspectionItemName} / v{p.specVersion}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">시작일</Label>
            <Input
              type="date"
              value={filter.from}
              onChange={(e) => setFilter({ ...filter, from: e.target.value })}
              onBlur={() => pushFilter(filter)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">종료일</Label>
            <Input
              type="date"
              value={filter.to}
              onChange={(e) => setFilter({ ...filter, to: e.target.value })}
              onBlur={() => pushFilter(filter)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">사업장</Label>
            <Select
              value={filter.siteId || NONE_VALUE}
              onValueChange={(v) => pushFilter({ ...filter, siteId: v === NONE_VALUE ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">설비</Label>
            <Select
              value={filter.equipmentId || NONE_VALUE}
              onValueChange={(v) => pushFilter({ ...filter, equipmentId: v === NONE_VALUE ? "" : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>전체</SelectItem>
                {filterOptions.equipments.map((eq) => (
                  <SelectItem key={eq.id} value={eq.id}>{eq.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="space-y-1.5 w-64">
            <Label className="text-[13px]">제조번호</Label>
            <Input
              placeholder="제조번호로 좁혀보기"
              value={filter.manufacturingNo}
              onChange={(e) => setFilter({ ...filter, manufacturingNo: e.target.value })}
              onBlur={() => pushFilter(filter)}
            />
          </div>
          <Button variant="ghost" size="sm" className="mt-6" onClick={resetFilter}>
            필터 초기화
          </Button>
        </div>
      </div>

      {!filter.profileId ? (
        <div className="rounded-lg border bg-card p-10 text-center text-[15px] text-muted-foreground">
          {activeProfiles.length === 0
            ? "등록된 SPC Profile이 없습니다. 상단 'SPC Profile 관리'에서 먼저 등록해 주세요."
            : "조회할 SPC Profile / 검사항목을 선택해 주세요."}
        </div>
      ) : analysis.n === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-[15px] text-muted-foreground">
          선택한 조건(기간·필터)에 해당하는 NUMERIC 측정값이 없습니다.
        </div>
      ) : (
        <>
          {analysis.specStatus === "MIXED_SPEC_LIMITS" && (
            <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 text-[13px] text-orange-800">
              선택한 기간의 측정값에서 규격(LSL/USL) 스냅샷이 서로 달라 공정능력(Cp/Cpk) 계산을 중단했습니다.
              측정값 자체(평균/표준편차/관리도)는 정상 표시됩니다.
            </div>
          )}

          <KpiRow analysis={analysis} />

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartCard title="I 관리도 (Individuals)">
              <IChart analysis={analysis} />
            </ChartCard>
            <ChartCard title="MR 관리도 (Moving Range)">
              <MrChart analysis={analysis} />
            </ChartCard>
            <ChartCard title="측정값 추이">
              <TrendChart analysis={analysis} />
            </ChartCard>
            <ChartCard title="Histogram">
              <HistogramChart analysis={analysis} />
            </ChartCard>
          </div>

          <DetailTable analysis={analysis} />
        </>
      )}

      {/* ─── SPC Profile 관리 다이얼로그 ─────────────────────────────────── */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>SPC Profile 관리</DialogTitle>
            <DialogDescription>
              NUMERIC 검사항목별로 SPC 관리도 대상을 등록·관리합니다.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => {
                setEditingProfile(null)
                setProfileSheetOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Profile 등록
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profile명</TableHead>
                <TableHead>품목</TableHead>
                <TableHead>공정</TableHead>
                <TableHead>검사항목</TableHead>
                <TableHead>검사표준 버전</TableHead>
                <TableHead>단위</TableHead>
                <TableHead>사용</TableHead>
                <TableHead className="text-right">작업</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    등록된 SPC Profile이 없습니다.
                  </TableCell>
                </TableRow>
              ) : (
                profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>[{p.itemCode}] {p.itemName}</TableCell>
                    <TableCell>{p.routingOperationName}</TableCell>
                    <TableCell>{p.inspectionItemName}</TableCell>
                    <TableCell>v{p.specVersion}</TableCell>
                    <TableCell>{p.unit ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={p.isActive ? "default" : "secondary"}>
                        {p.isActive ? "사용" : "미사용"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingProfile(p)
                          setProfileSheetOpen(true)
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteProfile(p)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>

      <SpcProfileFormSheet
        open={profileSheetOpen}
        onOpenChange={setProfileSheetOpen}
        editingProfile={editingProfile}
        targets={targets}
        onSaved={() => router.refresh()}
      />
    </div>
  )
}

// ─── KPI ──────────────────────────────────────────────────────────────────────

function KpiRow({ analysis }: { analysis: SpcAnalysisResult }) {
  const cap = analysis.capability
  const items: { label: string; value: string; hint?: string }[] = [
    { label: "측정수(N)", value: String(analysis.n) },
    { label: "평균", value: fmt(analysis.kpi.mean) },
    { label: "표준편차(n-1)", value: fmt(analysis.kpi.stdDev) },
    { label: "규격이탈 건수", value: String(analysis.kpi.specViolationCount) },
    { label: "규격이탈률", value: fmtPercent(analysis.kpi.specViolationRate) },
  ]

  if (cap == null) {
    items.push({ label: "Cp / Cpk", value: "—", hint: "MIXED_SPEC_LIMITS" })
  } else if (cap.status !== "OK") {
    items.push({ label: "Cp / Cpk", value: "—", hint: CAPABILITY_STATUS_LABEL[cap.status] })
  } else if (cap.cp != null && cap.cpk != null) {
    items.push({ label: "Cp / Cpk", value: `${fmt(cap.cp, 2)} / ${fmt(cap.cpk, 2)}` })
  } else if (cap.cpu != null) {
    items.push({ label: "Cpu (편측 USL)", value: fmt(cap.cpu, 2) })
  } else if (cap.cpl != null) {
    items.push({ label: "Cpl (편측 LSL)", value: fmt(cap.cpl, 2) })
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border bg-card p-3">
          <div className="text-[13px] text-muted-foreground">{item.label}</div>
          <div className="text-[20px] font-semibold text-foreground mt-1">{item.value}</div>
          {item.hint && <div className="text-[13px] text-muted-foreground mt-0.5">{item.hint}</div>}
        </div>
      ))}
    </div>
  )
}

// ─── 차트 카드 래퍼 ─────────────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-[15px] font-medium text-foreground mb-3">{title}</div>
      <div className="h-72">{children}</div>
    </div>
  )
}

// ─── I/MR 관리이탈(outOfControl) point 강조 dot ───────────────────────────────
// Spec(LSL/USL) 이탈(judgement=FAIL)과는 별개 개념 — I/MR 차트에서는 오직
// control limit(UCL/LCL) 초과 여부(outOfControl)만 기준으로 강조한다.

type ControlDotDatum = { outOfControl?: boolean }
type ControlDotProps = { cx?: number; cy?: number; payload?: ControlDotDatum }

function makeControlDot(normalColor: string) {
  return function ControlDot({ cx, cy, payload }: ControlDotProps) {
    if (cx == null || cy == null) return null
    const isOut = Boolean(payload?.outOfControl)
    return (
      <circle
        cx={cx}
        cy={cy}
        r={isOut ? 5 : 3}
        fill={isOut ? "#dc2626" : normalColor}
        stroke={isOut ? "#dc2626" : normalColor}
        strokeWidth={isOut ? 2 : 1}
      />
    )
  }
}

// ─── I chart ────────────────────────────────────────────────────────────────

function IChart({ analysis }: { analysis: SpcAnalysisResult }) {
  if (analysis.imr.status !== "OK") {
    return <EmptyChartState message="관리도 계산에는 최소 2개 이상의 측정값이 필요합니다." />
  }
  const { iChart } = analysis.imr
  const data = iChart.points.map((p) => ({ index: p.index + 1, value: p.value, outOfControl: p.outOfControl }))
  const outOfControlCount = iChart.points.filter((p) => p.outOfControl).length

  return (
    <div className="h-full flex flex-col">
      {outOfControlCount > 0 && (
        <div className="text-[13px] text-red-600 mb-1">관리한계 이탈 {outOfControlCount}건</div>
      )}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="index" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
            <Tooltip formatter={(v) => fmt(Number(v))} />
            <ReferenceLine y={iChart.cl} stroke="#16a34a" strokeDasharray="4 2" label={{ value: "CL", fontSize: 11 }} />
            <ReferenceLine y={iChart.ucl} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "UCL", fontSize: 11 }} />
            <ReferenceLine y={iChart.lcl} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "LCL", fontSize: 11 }} />
            <Line
              type="linear"
              dataKey="value"
              stroke="#2563eb"
              dot={makeControlDot("#2563eb")}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function MrChart({ analysis }: { analysis: SpcAnalysisResult }) {
  if (analysis.imr.status !== "OK") {
    return <EmptyChartState message="관리도 계산에는 최소 2개 이상의 측정값이 필요합니다." />
  }
  const { mrChart } = analysis.imr
  const data = mrChart.points.map((p) => ({ index: p.index + 1, value: p.value, outOfControl: p.outOfControl }))
  const outOfControlCount = mrChart.points.filter((p) => p.outOfControl).length

  return (
    <div className="h-full flex flex-col">
      {outOfControlCount > 0 && (
        <div className="text-[13px] text-red-600 mb-1">관리한계 이탈 {outOfControlCount}건</div>
      )}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="index" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} domain={[0, "auto"]} />
            <Tooltip formatter={(v) => fmt(Number(v))} />
            <ReferenceLine y={mrChart.cl} stroke="#16a34a" strokeDasharray="4 2" label={{ value: "CL", fontSize: 11 }} />
            <ReferenceLine y={mrChart.ucl} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "UCL", fontSize: 11 }} />
            <ReferenceLine y={mrChart.lcl} stroke="#dc2626" strokeDasharray="4 2" label={{ value: "LCL", fontSize: 11 }} />
            <Line
              type="linear"
              dataKey="value"
              stroke="#7c3aed"
              dot={makeControlDot("#7c3aed")}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function TrendChart({ analysis }: { analysis: SpcAnalysisResult }) {
  const data = analysis.rows.map((r, i) => ({ index: i + 1, value: r.numericValue, measuredAt: r.measuredAt }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="index" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} domain={["auto", "auto"]} />
        <Tooltip formatter={(v) => fmt(Number(v))} labelFormatter={(i) => `#${i}`} />
        {analysis.lowerLimit != null && (
          <ReferenceLine y={analysis.lowerLimit} stroke="#ea580c" strokeDasharray="4 2" label={{ value: "LSL", fontSize: 11 }} />
        )}
        {analysis.upperLimit != null && (
          <ReferenceLine y={analysis.upperLimit} stroke="#ea580c" strokeDasharray="4 2" label={{ value: "USL", fontSize: 11 }} />
        )}
        <Line type="monotone" dataKey="value" stroke="#0891b2" dot={{ r: 2 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

function HistogramChart({ analysis }: { analysis: SpcAnalysisResult }) {
  const data = analysis.histogram.map((b) => ({
    label: b.binStart === b.binEnd ? fmt(b.binStart, 2) : `${fmt(b.binStart, 2)}~${fmt(b.binEnd, 2)}`,
    count: b.count,
  }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 10, right: 16, bottom: 24, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#2563eb" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-[13px] text-muted-foreground text-center px-6">
      {message}
    </div>
  )
}

// ─── 상세 측정이력 테이블 ─────────────────────────────────────────────────────

function DetailTable({ analysis }: { analysis: SpcAnalysisResult }) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="p-4 border-b text-[15px] font-medium text-foreground">
        상세 측정이력 <span className="text-muted-foreground font-normal">({analysis.rows.length}건)</span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>측정일시</TableHead>
              <TableHead>품목</TableHead>
              <TableHead>공정</TableHead>
              <TableHead>제조번호</TableHead>
              <TableHead>설비</TableHead>
              <TableHead>검사항목</TableHead>
              <TableHead>sample</TableHead>
              <TableHead>측정값</TableHead>
              <TableHead>단위</TableHead>
              <TableHead>LSL</TableHead>
              <TableHead>USL</TableHead>
              <TableHead>판정</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {analysis.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{fmtDateTime(r.measuredAt)}</TableCell>
                <TableCell>[{r.itemCode}] {r.itemName}</TableCell>
                <TableCell>{r.routingOperationName}</TableCell>
                <TableCell>{r.manufacturingNo ?? "—"}</TableCell>
                <TableCell>{r.equipmentName ?? "—"}</TableCell>
                <TableCell>{r.inspectionItemName}</TableCell>
                <TableCell>{r.sampleNo}</TableCell>
                <TableCell>{fmt(r.numericValue, 6)}</TableCell>
                <TableCell>{r.unit ?? "—"}</TableCell>
                <TableCell>{r.lowerLimit == null ? "—" : fmt(r.lowerLimit, 6)}</TableCell>
                <TableCell>{r.upperLimit == null ? "—" : fmt(r.upperLimit, 6)}</TableCell>
                <TableCell>
                  {r.judgement === "PASS" && <Badge className="bg-green-100 text-green-700">합격</Badge>}
                  {r.judgement === "FAIL" && <Badge className="bg-red-100 text-red-700">불합격</Badge>}
                  {r.judgement == null && <span className="text-muted-foreground">—</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// ─── SPC Profile 등록/수정 시트 ───────────────────────────────────────────────

function SpcProfileFormSheet({
  open,
  onOpenChange,
  editingProfile,
  targets,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingProfile: SpcProfileRow | null
  targets: SpcProfileTargetSpec[]
  onSaved: () => void
}) {
  const isEdit = editingProfile != null
  const [name, setName] = useState(editingProfile?.name ?? "")
  const [inspectionItemId, setInspectionItemId] = useState(editingProfile?.inspectionItemId ?? "")
  const [isActive, setIsActive] = useState(editingProfile?.isActive ?? true)
  const [isLoading, setIsLoading] = useState(false)

  // open될 때마다 편집 대상 값으로 초기화
  if (open && editingProfile && name === "" && inspectionItemId === "") {
    setName(editingProfile.name)
    setInspectionItemId(editingProfile.inspectionItemId)
    setIsActive(editingProfile.isActive)
  }

  function resetAndClose() {
    setName("")
    setInspectionItemId("")
    setIsActive(true)
    onOpenChange(false)
  }

  async function handleSubmit() {
    if (!name.trim()) {
      alert("Profile명을 입력해 주세요.")
      return
    }
    if (!isEdit && !inspectionItemId) {
      alert("검사항목을 선택해 주세요.")
      return
    }
    setIsLoading(true)
    try {
      if (isEdit) {
        await updateSpcProfile(editingProfile.id, { name, isActive })
      } else {
        await createSpcProfile({ name, inspectionItemId })
      }
      onSaved()
      resetAndClose()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={(v) => {
        if (!v) resetAndClose()
        else onOpenChange(v)
      }}
      mode={isEdit ? "edit" : "create"}
      title={isEdit ? "SPC Profile 수정" : "SPC Profile 등록"}
      description="NUMERIC 검사항목 하나를 대상으로 관리도(I-MR)를 계산합니다."
      isLoading={isLoading}
      onSubmit={handleSubmit}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Profile명</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 외경 관리도" />
        </div>

        {!isEdit && (
          <div className="space-y-1.5">
            <Label>품목 / 공정 / 검사항목 (NUMERIC만 표시)</Label>
            <Select value={inspectionItemId} onValueChange={setInspectionItemId}>
              <SelectTrigger>
                <SelectValue placeholder="검사항목을 선택하세요" />
              </SelectTrigger>
              <SelectContent>
                {targets.length === 0 && (
                  <div className="px-3 py-2 text-[13px] text-muted-foreground">
                    NUMERIC 검사항목이 있는 검사표준이 없습니다.
                  </div>
                )}
                {targets.map((spec) => (
                  <div key={spec.inspectionSpecId}>
                    {spec.items.map((item) => (
                      <SelectItem key={item.inspectionItemId} value={item.inspectionItemId}>
                        [{spec.itemCode}] {spec.itemName} / {spec.routingOperationName} (v{spec.version}) — {item.inspectionItemName}
                        {item.unit ? ` (${item.unit})` : ""}
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isEdit && (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="text-[14px] font-medium">사용 여부</div>
              <div className="text-[13px] text-muted-foreground">비활성화하면 조회조건 목록에 표시되지 않습니다.</div>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        )}
      </div>
    </FormSheet>
  )
}
