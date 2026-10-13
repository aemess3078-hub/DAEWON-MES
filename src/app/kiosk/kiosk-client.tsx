"use client"

import { useEffect, useRef, useState } from "react"
import { EquipmentMonitorRow } from "@/lib/actions/equipment-monitor.actions"
import { MONITOR_LIGHT_PATH, reviveEquipmentRows } from "@/lib/monitor-live"
import { format } from "date-fns"
import { ko } from "date-fns/locale"

type KPIs = {
  activeWorkOrders: number
  todayGoodQty: number
  todayDefectQty: number
  defectRate: string
  openRepairs: number
  equipmentAvailability: string
}

const EQ_STATUS_CONFIG = {
  ACTIVE: { label: "가동", dot: "bg-green-500", card: "border-green-600/40 bg-green-900/20" },
  IDLE: { label: "대기", dot: "bg-yellow-400", card: "border-yellow-600/40 bg-yellow-900/20" },
  MAINTENANCE: { label: "점검", dot: "bg-blue-400", card: "border-blue-600/40 bg-blue-900/20" },
  DOWN: { label: "고장", dot: "bg-red-500", card: "border-red-600/40 bg-red-900/20" },
  INACTIVE: { label: "비가동", dot: "bg-slate-500", card: "border-slate-600/40 bg-slate-900/20" },
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

interface Props {
  equipment: EquipmentMonitorRow[]
  kpis: KPIs
}

export function KioskClient({ equipment: initialEquipment, kpis: initialKpis }: Props) {
  const [equipment, setEquipment] = useState<EquipmentMonitorRow[]>(initialEquipment)
  const [kpis, setKpis] = useState<KPIs>(initialKpis)
  const [now, setNow] = useState(new Date())
  const inFlightRef = useRef(false)

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(tick)
  }, [])

  // 30초 폴링 — 페이지 전체 router.refresh() 대신 경량 API(설비 + KPI)만 호출한다.
  // 백그라운드 탭이면 폴링 중단, 다시 보이면 즉시 1회 갱신 후 재개.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null
    let abort: AbortController | null = null
    let cancelled = false

    const poll = async () => {
      if (document.hidden || inFlightRef.current) return
      inFlightRef.current = true
      abort = new AbortController()
      try {
        const res = await fetch(`${MONITOR_LIGHT_PATH}?kpis=1`, {
          signal: abort.signal,
          cache: "no-store",
        })
        if (!res.ok) throw new Error(`status ${res.status}`)
        const json = await res.json()
        if (!cancelled) {
          setEquipment(reviveEquipmentRows(json.equipment ?? []))
          if (json.kpis) setKpis(json.kpis)
        }
      } catch {
        // 실패 시 기존 데이터 유지 (현황판이 꺼지지 않게)
      } finally {
        inFlightRef.current = false
      }
    }

    const start = () => {
      if (!timer) timer = setInterval(poll, 30000)
    }
    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      abort?.abort()
    }
    const onVisibility = () => {
      if (document.hidden) stop()
      else {
        poll()
        start()
      }
    }

    if (!document.hidden) start()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibility)
      stop()
    }
  }, [])

  const runningCount = equipment.filter((e) => e.status === "ACTIVE").length
  const downCount = equipment.filter((e) => e.status === "DOWN").length

  return (
    <div className="h-screen w-screen flex flex-col p-6 gap-5 select-none">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight text-white">
            씨앤에스메디칼 — 스마트공장 현황판
          </h1>
          <p className="text-[16px] text-slate-400 mt-0.5">SIZL-MES · LMS 실시간 모니터링</p>
        </div>
        <div className="text-right">
          <p className="text-[28px] font-mono font-semibold text-white tabular-nums">
            {format(now, "HH:mm:ss")}
          </p>
          <p className="text-[15px] text-slate-400">
            {format(now, "yyyy년 MM월 dd일 (EEE)", { locale: ko })}
          </p>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-6 gap-4 shrink-0">
        {[
          { label: "진행 작업지시", value: kpis.activeWorkOrders, unit: "건", color: "text-blue-400" },
          { label: "오늘 양품", value: kpis.todayGoodQty.toLocaleString(), unit: "ea", color: "text-green-400" },
          { label: "오늘 불량", value: kpis.todayDefectQty.toLocaleString(), unit: "ea", color: "text-red-400" },
          { label: "불량률", value: kpis.defectRate, unit: "%", color: Number(kpis.defectRate) > 3 ? "text-red-400" : "text-emerald-400" },
          { label: "수리 대기", value: kpis.openRepairs, unit: "건", color: kpis.openRepairs > 0 ? "text-yellow-400" : "text-slate-400" },
          { label: "설비 가동률", value: kpis.equipmentAvailability, unit: "%", color: "text-cyan-400" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center"
          >
            <p className="text-[13px] text-slate-400 mb-1">{kpi.label}</p>
            <p className={`text-[30px] font-bold ${kpi.color} tabular-nums leading-none`}>
              {kpi.value}
              <span className="text-[16px] font-normal text-slate-400 ml-1">{kpi.unit}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Equipment status row */}
      <div className="flex gap-6 items-center shrink-0 px-1">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[14px] text-slate-300">가동중 {runningCount}대</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500" />
          <span className="text-[14px] text-slate-300">고장 {downCount}대</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-slate-500" />
          <span className="text-[14px] text-slate-300">전체 {equipment.length}대</span>
        </div>
      </div>

      {/* Equipment Grid */}
      <div className="flex-1 overflow-hidden">
        <div
          className="grid gap-4 h-full"
          style={{
            gridTemplateColumns: `repeat(${Math.min(equipment.length, 5)}, 1fr)`,
          }}
        >
          {equipment.map((eq) => {
            const operationStatusTag = eq.recentTags.find(isOperationStatusTag)
            const visibleTags = eq.recentTags.filter((tag) => !isOperationStatusTag(tag)).slice(0, 4)
            const displayStatusKey =
              getStatusKeyFromOperationValue(operationStatusTag?.latestValue) ??
              (eq.status as keyof typeof EQ_STATUS_CONFIG)
            const cfg =
              EQ_STATUS_CONFIG[displayStatusKey as keyof typeof EQ_STATUS_CONFIG] ??
              EQ_STATUS_CONFIG.INACTIVE
            const statusLabel = operationStatusTag?.latestValue ?? cfg.label
            return (
              <div
                key={eq.id}
                className={`rounded-xl border p-4 flex flex-col gap-3 ${cfg.card}`}
              >
                {/* Equipment name + status */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[16px] font-semibold text-white leading-tight">{eq.name}</p>
                    <p className="text-[13px] text-slate-400">{eq.code}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ${displayStatusKey === "ACTIVE" ? "animate-pulse" : ""}`} />
                    <span className="text-[13px] text-slate-300 font-medium">{statusLabel}</span>
                  </div>
                </div>

                {/* Real-time tag values */}
                {visibleTags.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    {visibleTags.map((tag) => (
                      <div key={tag.displayName} className="bg-black/30 rounded-lg px-3 py-2">
                        <p className="text-[11px] text-slate-500 truncate">{tag.displayName}</p>
                        <p className="text-[20px] font-bold text-white tabular-nums">
                          {tag.latestValue ?? "—"}
                          {tag.unit && (
                            <span className="text-[12px] font-normal text-slate-400 ml-0.5">{tag.unit}</span>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-[13px] text-slate-600">데이터 없음</p>
                  </div>
                )}

                {/* Alerts */}
                {eq.openRepairs > 0 && (
                  <div className="bg-red-900/40 border border-red-700/40 rounded-lg px-3 py-1.5">
                    <p className="text-[13px] text-red-300">⚠ 수리요청 {eq.openRepairs}건</p>
                  </div>
                )}
                {eq.lastCheckResult === "FAIL" && (
                  <div className="bg-orange-900/40 border border-orange-700/40 rounded-lg px-3 py-1.5">
                    <p className="text-[13px] text-orange-300">점검 이상 감지</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 text-center">
        <p className="text-[12px] text-slate-600">
          대원정밀 MES · 30초마다 자동 갱신 · 스마트공장 현황판
        </p>
      </div>
    </div>
  )
}
