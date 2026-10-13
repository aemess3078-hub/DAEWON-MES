"use client"

import { useState, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/common/data-table"
import { ColumnDef } from "@tanstack/react-table"
import {
  Activity,
  Cable,
  CheckCircle2,
  Cpu,
  Radio,
  Tag,
  WifiOff,
} from "lucide-react"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import type {
  ParameterRow,
  ParameterPageSummary,
} from "@/lib/actions/tag-current-value.actions"

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  PROCESS: "공정",
  STATUS: "상태",
  ALARM: "알람",
  COUNTER: "카운터",
  QUALITY: "품질",
}

const CATEGORY_BADGE: Record<string, string> = {
  PROCESS: "bg-blue-100 text-blue-700",
  STATUS: "bg-green-100 text-green-700",
  ALARM: "bg-red-100 text-red-700",
  COUNTER: "bg-purple-100 text-purple-700",
  QUALITY: "bg-amber-100 text-amber-700",
}

const CATEGORIES = [
  "ALL",
  "PROCESS",
  "STATUS",
  "ALARM",
  "COUNTER",
  "QUALITY",
] as const

// ─── 설비 옵션 타입 ────────────────────────────────────────────────────────────

type EquipmentOption = {
  id: string
  code: string
  name: string
  workCenterName: string
}

// ─── 상태 배지 ────────────────────────────────────────────────────────────────

function StatusBadge({
  currentValue,
  quality,
}: {
  currentValue: string | null
  quality: string | null
}) {
  if (currentValue === null) {
    return (
      <Badge className="bg-slate-100 text-slate-500 border-0 text-[12px] gap-1">
        <WifiOff className="h-3 w-3" />
        미수신
      </Badge>
    )
  }
  if (quality !== "GOOD") {
    return (
      <Badge className="bg-amber-100 text-amber-700 border-0 text-[12px]">
        이상
      </Badge>
    )
  }
  return (
    <Badge className="bg-green-100 text-green-700 border-0 text-[12px] gap-1">
      <CheckCircle2 className="h-3 w-3" />
      정상
    </Badge>
  )
}

// ─── 테이블 컬럼 ───────────────────────────────────────────────────────────────

const columns: ColumnDef<ParameterRow>[] = [
  {
    accessorKey: "equipmentName",
    header: "설비명",
    cell: ({ row }) => (
      <div>
        <p className="text-[14px] font-medium">{row.original.equipmentName}</p>
        <p className="text-[12px] text-muted-foreground font-mono">
          {row.original.equipmentCode}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "displayName",
    header: "태그명",
    cell: ({ row }) => (
      <span className="text-[14px]">{row.original.displayName}</span>
    ),
  },
  {
    accessorKey: "tagCode",
    header: "태그코드",
    cell: ({ row }) => (
      <span className="font-mono text-[13px] text-muted-foreground">
        {row.original.tagCode}
      </span>
    ),
  },
  {
    accessorKey: "category",
    header: "분류",
    cell: ({ row }) => {
      const cat = row.original.category
      return (
        <Badge
          className={`border-0 text-[12px] ${CATEGORY_BADGE[cat] ?? "bg-slate-100 text-slate-600"}`}
        >
          {CATEGORY_LABEL[cat] ?? cat}
        </Badge>
      )
    },
  },
  {
    accessorKey: "plcAddress",
    header: "PLC 주소",
    cell: ({ row }) => (
      <span className="font-mono text-[13px]">{row.original.plcAddress}</span>
    ),
  },
  {
    accessorKey: "currentValue",
    header: "현재값",
    cell: ({ row }) => {
      const v = row.original.currentValue
      if (v === null)
        return (
          <span className="text-[13px] text-muted-foreground">—</span>
        )
      return (
        <span className="text-[15px] font-semibold tabular-nums">
          {v}
          {row.original.unit && (
            <span className="text-[13px] font-normal text-muted-foreground ml-1">
              {row.original.unit}
            </span>
          )}
        </span>
      )
    },
  },
  {
    accessorKey: "receivedAt",
    header: "수집시각",
    cell: ({ row }) => {
      const ts = row.original.receivedAt
      if (!ts)
        return (
          <span className="text-[13px] text-muted-foreground">—</span>
        )
      return (
        <span className="text-[13px] tabular-nums text-muted-foreground">
          {format(new Date(ts), "MM/dd HH:mm:ss", { locale: ko })}
        </span>
      )
    },
  },
  {
    id: "status",
    header: "상태",
    cell: ({ row }) => (
      <StatusBadge
        currentValue={row.original.currentValue}
        quality={row.original.quality}
      />
    ),
  },
]

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

interface Props {
  equipments: EquipmentOption[]
  summary: ParameterPageSummary
  initialRows: ParameterRow[]
}

export function ParametersClient({ equipments, summary, initialRows }: Props) {
  const [selectedEquipmentId, setSelectedEquipmentId] =
    useState<string>("__all__")
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL")
  const [searchTerm, setSearchTerm] = useState<string>("")

  const filteredRows = useMemo(() => {
    return initialRows.filter((row) => {
      if (
        selectedEquipmentId !== "__all__" &&
        row.equipmentId !== selectedEquipmentId
      )
        return false
      if (selectedCategory !== "ALL" && row.category !== selectedCategory)
        return false
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        if (
          !row.displayName.toLowerCase().includes(term) &&
          !row.tagCode.toLowerCase().includes(term)
        )
          return false
      }
      return true
    })
  }, [initialRows, selectedEquipmentId, selectedCategory, searchTerm])

  const hasEquipments = equipments.length > 0
  const hasTags = initialRows.length > 0

  // 현재 필터 기준 카운트
  const receivedCount = filteredRows.filter(
    (r) => r.currentValue !== null
  ).length
  const noValueCount = filteredRows.filter(
    (r) => r.currentValue === null
  ).length

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          파라미터보기
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          설비별 수집 태그와 최근 파라미터 값을 조회합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg shrink-0">
              <Cpu className="h-5 w-5 text-slate-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">전체 설비</p>
              <p className="text-[22px] font-semibold leading-tight">
                {summary.totalEquipment}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">
                  대
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg shrink-0">
              <Cable className="h-5 w-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">연동 설비</p>
              <p className="text-[22px] font-semibold leading-tight text-blue-700">
                {summary.connectedEquipment}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">
                  대
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-purple-50 rounded-lg shrink-0">
              <Tag className="h-5 w-5 text-purple-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">등록 태그</p>
              <p className="text-[22px] font-semibold leading-tight text-purple-700">
                {summary.totalTags}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">
                  개
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-green-200">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-green-50 rounded-lg shrink-0">
              <Activity className="h-5 w-5 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">수신 태그</p>
              <p className="text-[22px] font-semibold leading-tight text-green-700">
                {summary.receivedTags}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">
                  개
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className={summary.noValueTags > 0 ? "border-slate-300" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-slate-50 rounded-lg shrink-0">
              <Radio className="h-5 w-5 text-slate-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">미수신 태그</p>
              <p
                className={`text-[22px] font-semibold leading-tight ${
                  summary.noValueTags > 0
                    ? "text-slate-600"
                    : "text-slate-400"
                }`}
              >
                {summary.noValueTags}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">
                  개
                </span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 필터 영역 */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          {/* 설비 선택 */}
          <div className="space-y-1.5">
            <Label className="text-[13px]">설비 선택</Label>
            <Select
              value={selectedEquipmentId}
              onValueChange={setSelectedEquipmentId}
            >
              <SelectTrigger className="h-9 w-60 text-[14px]">
                <SelectValue placeholder="전체 설비" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-[14px]">
                  전체 설비
                </SelectItem>
                {equipments.map((eq) => (
                  <SelectItem key={eq.id} value={eq.id} className="text-[14px]">
                    {eq.code} – {eq.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 태그 검색 */}
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <Label className="text-[13px]">태그 검색</Label>
            <Input
              placeholder="태그명 또는 태그코드 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 text-[14px]"
            />
          </div>

          {/* 조회 결과 카운트 */}
          {hasTags && (
            <div className="pb-0.5 text-[13px] text-muted-foreground">
              총{" "}
              <span className="font-medium text-foreground">
                {filteredRows.length}
              </span>
              개 태그
              {receivedCount > 0 && (
                <span className="ml-2 text-green-600">
                  수신 {receivedCount}
                </span>
              )}
              {noValueCount > 0 && (
                <span className="ml-2 text-slate-500">
                  미수신 {noValueCount}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 분류 필터 */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors ${
                selectedCategory === cat
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cat === "ALL" ? "전체" : CATEGORY_LABEL[cat]}
            </button>
          ))}
        </div>
      </div>

      {/* 파라미터 테이블 */}
      <div className="rounded-lg border bg-card">
        {!hasEquipments ? (
          <div className="py-16 text-center">
            <Cpu className="mx-auto h-10 w-10 mb-3 text-muted-foreground/30" />
            <p className="text-[15px] text-muted-foreground">
              등록된 설비가 없습니다.
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">
              기준정보관리 &gt; 설비관리에서 설비를 등록하세요.
            </p>
          </div>
        ) : !hasTags ? (
          <div className="py-16 text-center">
            <Tag className="mx-auto h-10 w-10 mb-3 text-muted-foreground/30" />
            <p className="text-[15px] text-muted-foreground">
              등록된 파라미터 태그가 없습니다.
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">
              설비연동 설정 &gt; 태그 사전에서 태그를 등록하세요.
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-16 text-center">
            <Radio className="mx-auto h-10 w-10 mb-3 text-muted-foreground/30" />
            <p className="text-[15px] text-muted-foreground">
              {selectedEquipmentId !== "__all__"
                ? "해당 설비에 등록된 파라미터 태그가 없습니다."
                : "조건에 맞는 파라미터가 없습니다."}
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">
              설비 선택이나 필터 조건을 변경해 보세요.
            </p>
          </div>
        ) : (
          <DataTable columns={columns} data={filteredRows} />
        )}
      </div>
    </div>
  )
}
