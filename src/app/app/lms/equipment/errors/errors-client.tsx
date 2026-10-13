"use client"

import { useState, useMemo, useTransition } from "react"
import { useRouter, usePathname } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Wrench,
} from "lucide-react"
import { format } from "date-fns"
import { ko } from "date-fns/locale"
import type {
  ErrorEventRow,
  ErrorEventSummary,
  ErrorEventAppliedFilter,
  EquipmentOption,
} from "@/lib/actions/equipment-statistics.actions"
import { formatQuantity } from "@/lib/utils"

// ─── 유틸리티 ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—"
  if (seconds < 60) return `${seconds}초`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}분`
  const hrs = Math.floor(mins / 60)
  const rem = mins % 60
  return rem > 0 ? `${hrs}시간 ${rem}분` : `${hrs}시간`
}

function formatAvgDuration(events: ErrorEventRow[]): string {
  const withDur = events.filter((e) => e.durationSeconds !== null)
  if (withDur.length === 0) return "—"
  const avg = withDur.reduce((s, e) => s + (e.durationSeconds ?? 0), 0) / withDur.length
  return formatDuration(Math.round(avg))
}

// ─── 배지 컴포넌트 ────────────────────────────────────────────────────────────

function EventTypeBadge({ type }: { type: string }) {
  if (type === "ALARM") {
    return (
      <Badge className="bg-red-100 text-red-700 border-0 text-[12px] gap-1">
        <Bell className="h-3 w-3" />
        알람
      </Badge>
    )
  }
  return (
    <Badge className="bg-amber-100 text-amber-700 border-0 text-[12px] gap-1">
      <AlertTriangle className="h-3 w-3" />
      경고
    </Badge>
  )
}

function StatusBadge({ endedAt }: { endedAt: Date | null }) {
  if (endedAt === null) {
    return (
      <Badge className="bg-red-100 text-red-700 border-0 text-[12px] gap-1">
        <ShieldAlert className="h-3 w-3" />
        발생중
      </Badge>
    )
  }
  return (
    <Badge className="bg-green-100 text-green-700 border-0 text-[12px] gap-1">
      <CheckCircle2 className="h-3 w-3" />
      해제
    </Badge>
  )
}

// ─── 테이블 컬럼 ───────────────────────────────────────────────────────────────

const columns: ColumnDef<ErrorEventRow>[] = [
  {
    accessorKey: "startedAt",
    header: "발생일시",
    cell: ({ row }) => (
      <span className="text-[13px] tabular-nums">
        {format(new Date(row.original.startedAt), "yy/MM/dd HH:mm:ss", {
          locale: ko,
        })}
      </span>
    ),
  },
  {
    accessorKey: "endedAt",
    header: "해제일시",
    cell: ({ row }) => {
      const ts = row.original.endedAt
      if (!ts)
        return (
          <span className="text-[13px] text-red-500 font-medium">발생중</span>
        )
      return (
        <span className="text-[13px] tabular-nums text-muted-foreground">
          {format(new Date(ts), "yy/MM/dd HH:mm:ss", { locale: ko })}
        </span>
      )
    },
  },
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
    accessorKey: "eventType",
    header: "유형",
    cell: ({ row }) => <EventTypeBadge type={row.original.eventType} />,
  },
  {
    accessorKey: "message",
    header: "메시지",
    cell: ({ row }) => {
      const msg = row.original.message
      if (!msg)
        return (
          <span className="text-[13px] text-muted-foreground">—</span>
        )
      return (
        <span className="text-[13px]" title={msg}>
          {msg.length > 50 ? `${msg.slice(0, 50)}…` : msg}
        </span>
      )
    },
  },
  {
    accessorKey: "durationSeconds",
    header: "지속시간",
    cell: ({ row }) => (
      <span className="text-[13px] tabular-nums text-muted-foreground">
        {formatDuration(row.original.durationSeconds)}
      </span>
    ),
  },
  {
    id: "status",
    header: "상태",
    cell: ({ row }) => <StatusBadge endedAt={row.original.endedAt} />,
  },
]

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

const EVENT_TYPES = ["ALL", "ALARM", "WARNING"] as const

interface Props {
  equipments: EquipmentOption[]
  initialEvents: ErrorEventRow[]
  summary: ErrorEventSummary
  appliedFilter: ErrorEventAppliedFilter
}

export function ErrorsClient({
  equipments,
  initialEvents,
  summary,
  appliedFilter,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  // ── 서버 재조회용 필터 (날짜/설비) ──────────────────────────────────────────
  const [from, setFrom] = useState(appliedFilter.from)
  const [to, setTo] = useState(appliedFilter.to)
  const [equipmentId, setEquipmentId] = useState(
    appliedFilter.equipmentId ?? "__all__"
  )

  // ── 클라이언트 필터 (이벤트 유형/검색) ────────────────────────────────────────
  const [selectedType, setSelectedType] = useState<string>("ALL")
  const [searchTerm, setSearchTerm] = useState<string>("")

  function handleApply() {
    const params = new URLSearchParams()
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    if (equipmentId && equipmentId !== "__all__")
      params.set("equipmentId", equipmentId)
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`)
    })
  }

  const filteredEvents = useMemo(() => {
    return initialEvents.filter((ev) => {
      if (selectedType !== "ALL" && ev.eventType !== selectedType) return false
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        if (
          !ev.equipmentName.toLowerCase().includes(term) &&
          !ev.equipmentCode.toLowerCase().includes(term) &&
          !(ev.message ?? "").toLowerCase().includes(term)
        )
          return false
      }
      return true
    })
  }, [initialEvents, selectedType, searchTerm])

  // 필터 기준 카운트
  const filteredAlarm = filteredEvents.filter(
    (e) => e.eventType === "ALARM"
  ).length
  const filteredWarning = filteredEvents.filter(
    (e) => e.eventType === "WARNING"
  ).length
  const filteredActive = filteredEvents.filter(
    (e) => e.endedAt === null
  ).length

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          에러보기
        </h1>
        <p className="text-[15px] text-muted-foreground mt-1">
          설비별 알람/경고 발생 이력과 조치 필요 현황을 조회합니다.
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg shrink-0">
              <Bell className="h-5 w-5 text-slate-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">전체 에러</p>
              <p className="text-[22px] font-semibold leading-tight">
                {formatQuantity(summary.total)}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">
                  건
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-200">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-lg shrink-0">
              <Bell className="h-5 w-5 text-red-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">알람</p>
              <p className="text-[22px] font-semibold leading-tight text-red-700">
                {formatQuantity(summary.alarmCount)}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">
                  건
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-200">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-amber-50 rounded-lg shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">경고</p>
              <p className="text-[22px] font-semibold leading-tight text-amber-700">
                {formatQuantity(summary.warningCount)}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">
                  건
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className={summary.activeCount > 0 ? "border-red-300" : ""}>
          <CardContent className="p-4 flex items-center gap-3">
            <div
              className={`p-2 rounded-lg shrink-0 ${
                summary.activeCount > 0 ? "bg-red-50" : "bg-slate-50"
              }`}
            >
              <ShieldAlert
                className={`h-5 w-5 ${
                  summary.activeCount > 0 ? "text-red-600" : "text-slate-400"
                }`}
              />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">미해제</p>
              <p
                className={`text-[22px] font-semibold leading-tight ${
                  summary.activeCount > 0
                    ? "text-red-600"
                    : "text-slate-500"
                }`}
              >
                {formatQuantity(summary.activeCount)}
                <span className="text-[14px] font-normal text-muted-foreground ml-1">
                  건
                </span>
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-lg shrink-0">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] text-muted-foreground">평균 지속</p>
              <p className="text-[18px] font-semibold leading-tight text-blue-700 truncate">
                {formatAvgDuration(initialEvents)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 필터 영역 */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        {/* 날짜/설비 필터 (서버 재조회) */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-[13px]">시작일</Label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-40 rounded-md border border-input bg-background px-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">종료일</Label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-40 rounded-md border border-input bg-background px-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">설비 선택</Label>
            <Select value={equipmentId} onValueChange={setEquipmentId}>
              <SelectTrigger className="h-9 w-56 text-[14px]">
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
          <Button size="sm" onClick={handleApply} className="h-9">
            조회
          </Button>
        </div>

        {/* 이벤트 유형 + 검색 (클라이언트 필터) */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {EVENT_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors ${
                  selectedType === type
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {type === "ALL" ? "전체" : type === "ALARM" ? "알람" : "경고"}
              </button>
            ))}
          </div>

          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder="설비명, 설비코드, 메시지 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-9 text-[14px]"
            />
          </div>

          {/* 결과 카운트 */}
          {initialEvents.length > 0 && (
            <p className="text-[13px] text-muted-foreground whitespace-nowrap">
              총{" "}
              <span className="font-medium text-foreground">
                {filteredEvents.length}
              </span>
              건
              {filteredActive > 0 && (
                <span className="ml-2 text-red-600">
                  미해제 {filteredActive}
                </span>
              )}
              {filteredAlarm > 0 && (
                <span className="ml-2 text-slate-500">
                  알람 {filteredAlarm}
                </span>
              )}
              {filteredWarning > 0 && (
                <span className="ml-2 text-slate-500">
                  경고 {filteredWarning}
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* 수리요청 연계 안내 */}
      {summary.activeCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] text-amber-800">
          <Wrench className="h-4 w-4 shrink-0" />
          <span>
            미해제 에러 {summary.activeCount}건이 있습니다. 설비수리관리 메뉴에서
            수리요청을 등록할 수 있습니다.
          </span>
        </div>
      )}

      {/* 에러 이력 테이블 */}
      <div className="rounded-lg border bg-card">
        {equipments.length === 0 ? (
          <div className="py-16 text-center">
            <BellOff className="mx-auto h-10 w-10 mb-3 text-muted-foreground/30" />
            <p className="text-[15px] text-muted-foreground">
              등록된 설비가 없습니다.
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">
              기준정보관리 &gt; 설비관리에서 설비를 등록하세요.
            </p>
          </div>
        ) : initialEvents.length === 0 ? (
          <div className="py-16 text-center">
            <Bell className="mx-auto h-10 w-10 mb-3 text-muted-foreground/30" />
            <p className="text-[15px] text-muted-foreground">
              조회된 설비 에러 이력이 없습니다.
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">
              조회 기간이나 설비 조건을 변경해 보세요.
            </p>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="py-16 text-center">
            <BellOff className="mx-auto h-10 w-10 mb-3 text-muted-foreground/30" />
            <p className="text-[15px] text-muted-foreground">
              조건에 맞는 에러 이력이 없습니다.
            </p>
            <p className="text-[13px] text-muted-foreground mt-1">
              유형 필터나 검색어를 변경해 보세요.
            </p>
          </div>
        ) : (
          <DataTable columns={columns} data={filteredEvents} />
        )}
      </div>
    </div>
  )
}
