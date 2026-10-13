"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  MapPinned,
  Package,
  Radio,
  Settings,
  WifiOff,
  XCircle,
} from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { EquipmentMonitorRow } from "@/lib/actions/equipment-monitor.actions"
import { format, formatDistanceToNow } from "date-fns"
import { ko } from "date-fns/locale"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EquipmentCardMeta {
  id: string
  isAlarm: boolean
  isDelay: boolean
  lastTimestamp: Date | null
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  ACTIVE:      { label: "가동중",  className: "bg-green-500",  textClass: "text-green-700",  borderClass: "border-green-200"  },
  IDLE:        { label: "대기",    className: "bg-yellow-400", textClass: "text-yellow-700", borderClass: "border-yellow-200" },
  MAINTENANCE: { label: "점검중",  className: "bg-blue-500",   textClass: "text-blue-700",   borderClass: "border-blue-200"   },
  DOWN:        { label: "고장",    className: "bg-red-500",    textClass: "text-red-700",    borderClass: "border-red-200"    },
  INACTIVE:    { label: "비가동",  className: "bg-slate-400",  textClass: "text-slate-600",  borderClass: "border-slate-200"  },
}

const EVENT_TYPE_LABEL: Record<string, string> = {
  RUN:         "가동 시작",
  START:       "가동 시작",
  STOP:        "가동 정지",
  ALARM:       "알람",
  ERROR:       "에러",
  MAINTENANCE: "유지보수",
}

const OPERATION_STATUS_TAG_NAMES = new Set(["운전 상태", "NCWatch Status"])

function isOperationStatusTag(tag: EquipmentMonitorRow["recentTags"][number]) {
  return tag.tagCode === "STATUS" || OPERATION_STATUS_TAG_NAMES.has(tag.displayName)
}

function getStatusKeyFromOperationValue(value: string | null | undefined) {
  if (!value || value === "—") return null
  const text = value.trim()
  const upper = text.toUpperCase()

  if (text.includes("오프라인") || upper === "OFFLINE") return "INACTIVE"
  if (text.includes("알람") || upper === "ALARM") return "DOWN"
  if (text.includes("가동") || upper === "RUN" || upper === "START") return "ACTIVE"
  if (text.includes("대기") || upper === "READY" || upper === "IDLE") return "IDLE"
  if (text.includes("정지") || upper === "STOP" || upper === "PAUSE") return "INACTIVE"
  if (text.includes("수동") || upper === "MANUAL") return "IDLE"

  return null
}

function findTag(eq: EquipmentMonitorRow, tagCode: string) {
  return eq.recentTags.find((tag) => tag.tagCode === tagCode) ?? null
}

function getLatestTimestamp(eq: EquipmentMonitorRow, meta?: EquipmentCardMeta) {
  if (meta?.lastTimestamp) return meta.lastTimestamp
  const timestamps = eq.recentTags
    .map((tag) => tag.timestamp)
    .filter((timestamp): timestamp is Date => Boolean(timestamp))
    .map((timestamp) => new Date(timestamp).getTime())

  if (timestamps.length === 0) return null
  return new Date(Math.max(...timestamps))
}

function formatTagValue(tag: EquipmentMonitorRow["recentTags"][number] | null) {
  if (!tag?.latestValue) return "—"
  return tag.unit ? `${tag.latestValue} ${tag.unit}` : tag.latestValue
}

function DetailField({
  label,
  value,
  emphasize = false,
}: {
  label: string
  value: string
  emphasize?: boolean
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 min-w-0">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 break-all ${emphasize ? "text-[18px] font-semibold" : "text-[14px] font-medium"}`}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

function DetailSection({
  title,
  icon,
  children,
}: {
  title: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 text-[14px] font-semibold">
        {icon}
        <span>{title}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  )
}

function EquipmentDetailSheet({
  equipment,
  meta,
  open,
  onOpenChange,
}: {
  equipment: EquipmentMonitorRow | null
  meta?: EquipmentCardMeta
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!equipment) {
    return null
  }

  const operationStatusTag = equipment.recentTags.find(isOperationStatusTag)
  const lastTimestamp = getLatestTimestamp(equipment, meta)
  const alarmMessage = formatTagValue(findTag(equipment, "ALARM_MESSAGE"))
  const alarmCode = formatTagValue(findTag(equipment, "ALARM_CODE"))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="text-[20px] font-semibold">{equipment.name}</SheetTitle>
          <p className="text-[13px] text-muted-foreground">
            {equipment.code} · {equipment.workCenter.name}
          </p>
        </SheetHeader>

        <div className="py-5 space-y-6">
          <DetailSection
            title="상태"
            icon={<Activity className="h-4 w-4 text-emerald-600" />}
          >
            <DetailField label="운전 상태" value={formatTagValue(operationStatusTag ?? null)} emphasize />
            <DetailField label="운전 모드" value={formatTagValue(findTag(equipment, "MODE"))} />
            <DetailField label="가공 프로그램" value={formatTagValue(findTag(equipment, "PROGRAM_NAME"))} />
            <DetailField label="O 번호" value={formatTagValue(findTag(equipment, "O_NUMBER"))} />
          </DetailSection>

          <DetailSection
            title="위치 정보"
            icon={<MapPinned className="h-4 w-4 text-blue-600" />}
          >
            <DetailField label="X 축" value={formatTagValue(findTag(equipment, "POS_X"))} emphasize />
            <DetailField label="Y 축" value={formatTagValue(findTag(equipment, "POS_Y"))} emphasize />
            <DetailField label="Z 축" value={formatTagValue(findTag(equipment, "POS_Z"))} emphasize />
            <DetailField label="WCS" value="—" />
          </DetailSection>

          <DetailSection
            title="가공 정보"
            icon={<Gauge className="h-4 w-4 text-orange-600" />}
          >
            <DetailField label="FEED" value={formatTagValue(findTag(equipment, "FEED_RATE"))} />
            <DetailField label="주축 회전수" value={formatTagValue(findTag(equipment, "SPINDLE_SPEED"))} />
            <DetailField label="공구 번호" value={formatTagValue(findTag(equipment, "TOOL_NO"))} />
            <DetailField label="가공 비율" value={formatTagValue(findTag(equipment, "RATIO"))} />
          </DetailSection>

          <DetailSection
            title="생산 정보"
            icon={<Package className="h-4 w-4 text-violet-600" />}
          >
            <DetailField label="누적 생산량" value={formatTagValue(findTag(equipment, "PART_COUNT"))} emphasize />
            <DetailField
              label="오늘 생산량"
              value={
                equipment.ncwatchTodayPartCount != null
                  ? `${equipment.ncwatchTodayPartCount.toLocaleString()} ea`
                  : "—"
              }
            />
            <DetailField label="블록 번호" value={formatTagValue(findTag(equipment, "BLOCK_NUMBER"))} />
            <DetailField label="최종 수신" value={lastTimestamp ? format(new Date(lastTimestamp), "yyyy-MM-dd HH:mm:ss", { locale: ko }) : "—"} />
          </DetailSection>

          <DetailSection
            title="알람"
            icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
          >
            <DetailField label="알람 코드" value={alarmCode} />
            <DetailField label="알람 메시지" value={alarmMessage} />
          </DetailSection>

          <DetailSection
            title="전체 태그"
            icon={<Settings className="h-4 w-4 text-slate-600" />}
          >
            {equipment.recentTags.map((tag, index) => (
              <DetailField
                key={`${tag.tagCode}-${index}`}
                label={tag.displayName}
                value={formatTagValue(tag)}
              />
            ))}
          </DetailSection>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CheckBadge({ result }: { result: string | null }) {
  if (!result) return <span className="text-[13px] text-muted-foreground">—</span>
  if (result === "PASS") return (
    <Badge className="bg-green-100 text-green-700 border-0 text-[12px] gap-1">
      <CheckCircle2 className="h-3 w-3" /> 이상없음
    </Badge>
  )
  if (result === "FAIL") return (
    <Badge className="bg-red-100 text-red-700 border-0 text-[12px] gap-1">
      <XCircle className="h-3 w-3" /> 이상있음
    </Badge>
  )
  return <Badge className="bg-slate-100 text-slate-600 border-0 text-[12px]">해당없음</Badge>
}

function TimestampBadge({ ts, isDelay }: { ts: Date | null; isDelay: boolean }) {
  if (!ts) return null
  return (
    <span
      className={`flex items-center gap-1 text-[11px] ${
        isDelay ? "text-amber-600" : "text-muted-foreground"
      }`}
    >
      {isDelay && <WifiOff className="h-3 w-3" />}
      {formatDistanceToNow(ts, { addSuffix: true, locale: ko })}
    </span>
  )
}

// ─── Grid component ───────────────────────────────────────────────────────────

interface Props {
  data: EquipmentMonitorRow[]
  equipmentMeta?: EquipmentCardMeta[]
  showLastReceived?: boolean
}

export function EquipmentMonitorGrid({ data, equipmentMeta, showLastReceived = false }: Props) {
  const [filter, setFilter] = useState<string>("ALL")
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null)

  const metaMap = new Map(equipmentMeta?.map((m) => [m.id, m]) ?? [])
  const selectedEquipment = data.find((eq) => eq.id === selectedEquipmentId) ?? null

  const filtered = filter === "ALL" ? data : data.filter((d) => d.status === filter)

  const statusCounts = data.reduce(
    (acc, eq) => {
      acc[eq.status] = (acc[eq.status] ?? 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilter("ALL")}
          className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors ${
            filter === "ALL"
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/80"
          }`}
        >
          전체 ({data.length})
        </button>
        {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
          const count = statusCounts[status] ?? 0
          if (count === 0) return null
          return (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1 rounded-full text-[13px] font-medium transition-colors ${
                filter === status
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {cfg.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Equipment Cards */}
      <div className="grid grid-cols-3 gap-4">
        {filtered.map((eq) => {
          const meta = metaMap.get(eq.id)
          const operationStatusTag = eq.recentTags.find(isOperationStatusTag)
          const visibleTags = eq.recentTags.filter((tag) => !isOperationStatusTag(tag)).slice(0, 4)
          const displayStatusKey =
            getStatusKeyFromOperationValue(operationStatusTag?.latestValue) ??
            (eq.status as keyof typeof STATUS_CONFIG)
          const statusCfg =
            STATUS_CONFIG[displayStatusKey as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.INACTIVE
          const statusLabel = meta?.isDelay ? "통신지연" : operationStatusTag?.latestValue ?? statusCfg.label

          // Meta-driven border override
          const borderClass = meta?.isAlarm
            ? "border-red-400 shadow-sm shadow-red-100"
            : meta?.isDelay
            ? "border-amber-400"
            : statusCfg.borderClass

          return (
            <Card
              key={eq.id}
              role="button"
              tabIndex={0}
              onClick={() => setSelectedEquipmentId(eq.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  setSelectedEquipmentId(eq.id)
                }
              }}
              className={`border ${borderClass} transition-all cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
            >
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-[15px] font-semibold truncate">{eq.name}</CardTitle>
                    <p className="text-[13px] text-muted-foreground truncate">
                      {eq.code} · {eq.workCenter.name}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          meta?.isAlarm
                            ? "bg-red-500 animate-pulse"
                            : meta?.isDelay
                            ? "bg-amber-500"
                            : statusCfg.className + (displayStatusKey === "ACTIVE" ? " animate-pulse" : "")
                        }`}
                      />
                      <span
                        className={`text-[13px] font-medium ${
                          meta?.isAlarm ? "text-red-700" : meta?.isDelay ? "text-amber-700" : statusCfg.textClass
                        }`}
                      >
                        {meta?.isAlarm ? "알람" : statusLabel}
                      </span>
                    </div>
                    {meta?.isDelay && (
                      <Badge className="bg-amber-100 text-amber-700 border-0 text-[11px] gap-1 px-1.5 py-0">
                        <WifiOff className="h-2.5 w-2.5" />
                        통신지연
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="px-4 pb-4 space-y-2">
                {/* Real-time tags */}
                {visibleTags.length > 0 && (
                  <div className="grid grid-cols-2 gap-1.5 py-2 border-y">
                    {visibleTags.map((tag) => (
                      <div key={tag.displayName} className="min-w-0 bg-muted/50 rounded-md px-2 py-1.5">
                        <p className="text-[11px] text-muted-foreground truncate">{tag.displayName}</p>
                        <p
                          className="text-[15px] font-semibold break-all"
                          title={tag.latestValue ?? undefined}
                        >
                          {tag.latestValue ?? "—"}
                          {tag.unit && (
                            <span className="text-[12px] font-normal text-muted-foreground ml-0.5">
                              {tag.unit}
                            </span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Latest event */}
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    최근 이벤트
                  </span>
                  <span>
                    {eq.latestEvent
                      ? `${EVENT_TYPE_LABEL[eq.latestEvent.eventType] ?? eq.latestEvent.eventType} · ${format(new Date(eq.latestEvent.startedAt), "MM/dd HH:mm", { locale: ko })}`
                      : "—"}
                  </span>
                </div>

                {/* Last received timestamp (현황 모드에서만 표시) */}
                {(showLastReceived || !!meta) && (
                  <div className="flex justify-between items-center text-[13px]">
                    <span className="text-muted-foreground">마지막 수신</span>
                    <TimestampBadge
                      ts={meta?.lastTimestamp ?? (eq.recentTags[0]?.timestamp ?? null)}
                      isDelay={meta?.isDelay ?? false}
                    />
                  </div>
                )}

                {/* Daily check */}
                <div className="flex justify-between items-center text-[13px]">
                  <span className="text-muted-foreground">일상점검</span>
                  <CheckBadge result={eq.lastCheckResult} />
                </div>

                {/* Open repairs */}
                {eq.openRepairs > 0 && (
                  <div className="flex items-center gap-1.5 text-[13px] text-red-600 bg-red-50 rounded px-2 py-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    수리요청 {eq.openRepairs}건 진행중
                  </div>
                )}

                <div className="flex justify-end text-[12px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Radio className="h-3 w-3" />
                    상세 보기
                  </span>
                </div>
              </CardContent>
            </Card>
          )
        })}

        {filtered.length === 0 && (
          <div className="col-span-3 text-center py-12 text-[15px] text-muted-foreground">
            해당 상태의 설비가 없습니다.
          </div>
        )}
      </div>

      <EquipmentDetailSheet
        equipment={selectedEquipment}
        meta={selectedEquipment ? metaMap.get(selectedEquipment.id) : undefined}
        open={!!selectedEquipment}
        onOpenChange={(open) => {
          if (!open) setSelectedEquipmentId(null)
        }}
      />
    </div>
  )
}
