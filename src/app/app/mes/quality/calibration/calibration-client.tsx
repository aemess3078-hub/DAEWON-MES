"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, BadgeCheck, Gauge, Hourglass, PauseCircle } from "lucide-react"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  cancelCalibration,
  deleteInstrument,
  type CalibrationOverview,
} from "@/lib/actions/instrument-calibration.actions"
import { computeKpis, type CalibrationRow, type InstrumentRow, type KpiKey } from "@/lib/instrument-calibration-view"
import { cn } from "@/lib/utils"
import { CalibrationFormDialog, type CalibrationDialogTarget } from "./calibration-form-dialog"
import { NoticeBanner, ReasonDialog, type Notice } from "./calibration-ui"
import { HistoryTab } from "./history-tab"
import { ImportDialog } from "./import-dialog"
import { InstrumentDetailSheet } from "./instrument-detail-sheet"
import { InstrumentFormSheet } from "./instrument-form-sheet"
import { InstrumentRegistryTab } from "./instrument-registry-tab"
import { ScheduleDialog } from "./schedule-dialog"
import { ScheduleTab } from "./schedule-tab"

type TabKey = "registry" | "schedule" | "history"

const KPI_CARDS: Array<{
  key: KpiKey
  label: string
  icon: React.ComponentType<{ className?: string }>
  tone: string
  value: string
}> = [
  { key: "ALL", label: "전체 계측기", icon: Gauge, tone: "bg-slate-100 text-slate-700", value: "" },
  { key: "USABLE", label: "사용가능 계측기", icon: BadgeCheck, tone: "bg-green-100 text-green-700", value: "text-green-700" },
  { key: "DUE_SOON", label: "교정임박 계측기", icon: Hourglass, tone: "bg-yellow-100 text-yellow-700", value: "text-yellow-700" },
  { key: "OVERDUE", label: "교정기한초과 계측기", icon: AlertTriangle, tone: "bg-red-100 text-red-700", value: "text-red-600" },
  { key: "INACTIVE", label: "사용중지·폐기 계측기", icon: PauseCircle, tone: "bg-orange-100 text-orange-700", value: "" },
]

const EMPTY_TARGET: CalibrationDialogTarget = { instrumentId: null, record: null, openCalibrationId: null }

export function CalibrationClient({ overview }: { overview: CalibrationOverview }) {
  const router = useRouter()
  const { instruments, calibrations, profiles, permissions } = overview

  const [tab, setTab] = React.useState<TabKey>("registry")
  const [kpi, setKpi] = React.useState<KpiKey>("ALL")
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)

  const [formOpen, setFormOpen] = React.useState(false)
  const [editing, setEditing] = React.useState<InstrumentRow | null>(null)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [calibrationOpen, setCalibrationOpen] = React.useState(false)
  const [calibrationTarget, setCalibrationTarget] = React.useState<CalibrationDialogTarget>(EMPTY_TARGET)
  const [scheduleTarget, setScheduleTarget] = React.useState<InstrumentRow | null>(null)
  const [importOpen, setImportOpen] = React.useState(false)
  const [cancelRecord, setCancelRecord] = React.useState<CalibrationRow | null>(null)
  const [cancelScheduleOf, setCancelScheduleOf] = React.useState<InstrumentRow | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<InstrumentRow | null>(null)
  const [reasonPending, setReasonPending] = React.useState(false)

  const kpis = React.useMemo(() => computeKpis(instruments), [instruments])
  const categories = React.useMemo(() => Array.from(new Set(instruments.map((i) => i.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko")), [instruments])
  const departments = React.useMemo(() => Array.from(new Set(instruments.map((i) => i.department).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko")), [instruments])
  const agencies = React.useMemo(() => Array.from(new Set(calibrations.map((c) => c.agency).filter(Boolean))).sort((a, b) => a.localeCompare(b, "ko")), [calibrations])
  const detailInstrument = instruments.find((i) => i.id === detailId) ?? null

  const pushNotice = React.useCallback((type: Notice["type"], message: string) => setNotice({ type, message }), [])
  const refresh = React.useCallback(() => {
    setRefreshKey((key) => key + 1)
    router.refresh()
  }, [router])
  const handleSaved = React.useCallback(
    (message: string) => {
      pushNotice("success", message)
      refresh()
    },
    [pushNotice, refresh],
  )
  const handleError = React.useCallback((message: string) => pushNotice("error", message), [pushNotice])

  const openDetail = React.useCallback((row: InstrumentRow) => setDetailId(row.id), [])
  const openEdit = React.useCallback((row: InstrumentRow) => {
    setEditing(row)
    setFormOpen(true)
  }, [])
  const openRegister = React.useCallback((row: InstrumentRow | null) => {
    setCalibrationTarget({ instrumentId: row?.id ?? null, record: null, openCalibrationId: row?.openCalibrationId ?? null })
    setCalibrationOpen(true)
  }, [])
  const openEditCalibration = React.useCallback((record: CalibrationRow) => {
    setCalibrationTarget({ instrumentId: record.instrumentId, record, openCalibrationId: null })
    setCalibrationOpen(true)
  }, [])

  function selectKpi(key: KpiKey) {
    setKpi((current) => (current === key ? "ALL" : key))
    if (tab === "history") setTab("registry")
  }

  async function confirmCancel(reason: string) {
    setReasonPending(true)
    let response
    let label = ""
    if (cancelRecord) {
      label = cancelRecord.managementNo
      response = await cancelCalibration(cancelRecord.id, reason)
    } else if (cancelScheduleOf?.openCalibrationId) {
      label = cancelScheduleOf.managementNo
      response = await cancelCalibration(cancelScheduleOf.openCalibrationId, reason)
    }
    setReasonPending(false)
    if (!response) return
    if (!response.ok) return pushNotice("error", response.error)
    setCancelRecord(null)
    setCancelScheduleOf(null)
    handleSaved(`${label} 교정 이력을 취소했습니다. 취소 내역은 변경 기록에 남습니다.`)
  }

  async function confirmDelete(reason: string) {
    if (!deleteTarget) return
    setReasonPending(true)
    const response = await deleteInstrument(deleteTarget.id, reason)
    setReasonPending(false)
    if (!response.ok) return pushNotice("error", response.error)
    const label = deleteTarget.managementNo
    setDeleteTarget(null)
    setDetailId(null)
    handleSaved(`${label} 계측기를 삭제했습니다.`)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">계측기 검교정관리</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          계측기 관리대장, 교정 일정, 교정 이력을 한 곳에서 관리하고 교정기한 초과 여부를 확인합니다. 기준일 {overview.asOf}
        </p>
      </div>

      <NoticeBanner notice={notice} onClose={() => setNotice(null)} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {KPI_CARDS.map((card) => {
          const Icon = card.icon
          const active = kpi === card.key
          return (
            <button
              key={card.key}
              type="button"
              onClick={() => selectKpi(card.key)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted/40",
                active && "border-primary ring-2 ring-primary/30",
              )}
            >
              <span className={cn("shrink-0 rounded-lg p-2", card.tone)}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block break-keep text-[13px] text-muted-foreground">{card.label}</span>
                <span className={cn("block text-[24px] font-semibold leading-tight", card.value)}>{kpis[card.key].toLocaleString("ko-KR")}</span>
              </span>
            </button>
          )
        })}
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        <TabsList className="h-11">
          <TabsTrigger value="registry" className="px-4 text-[15px]">계측기 관리대장</TabsTrigger>
          <TabsTrigger value="schedule" className="px-4 text-[15px]">검교정 일정관리</TabsTrigger>
          <TabsTrigger value="history" className="px-4 text-[15px]">검교정 이력관리</TabsTrigger>
        </TabsList>

        <TabsContent value="registry" className="mt-5">
          <InstrumentRegistryTab
            instruments={instruments}
            kpi={kpi}
            onClearKpi={() => setKpi("ALL")}
            categories={categories}
            departments={departments}
            canCreate={permissions.canCreate}
            canUpdate={permissions.canUpdate}
            canExport={permissions.canExport}
            onCreate={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            onImport={() => setImportOpen(true)}
            onDetail={openDetail}
            onEdit={openEdit}
            onNotice={pushNotice}
          />
        </TabsContent>

        <TabsContent value="schedule" className="mt-5">
          <ScheduleTab
            instruments={instruments}
            kpi={kpi}
            onClearKpi={() => setKpi("ALL")}
            canCreate={permissions.canCreate}
            canUpdate={permissions.canUpdate}
            onDetail={openDetail}
            onSchedule={setScheduleTarget}
            onRegister={openRegister}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-5">
          <HistoryTab
            calibrations={calibrations}
            canCreate={permissions.canCreate}
            canUpdate={permissions.canUpdate}
            canExport={permissions.canExport}
            onRegister={() => openRegister(null)}
            onEdit={openEditCalibration}
            onCancel={setCancelRecord}
            onOpenInstrument={(id) => setDetailId(id)}
            onNotice={pushNotice}
          />
        </TabsContent>
      </Tabs>

      <InstrumentFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        instrument={editing}
        profiles={profiles}
        categories={categories}
        departments={departments}
        canDispose={permissions.canDelete}
        onSaved={handleSaved}
        onError={handleError}
      />

      <InstrumentDetailSheet
        open={detailInstrument !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
        instrument={detailInstrument}
        calibrations={calibrations}
        refreshKey={refreshKey}
        canCreate={permissions.canCreate}
        canUpdate={permissions.canUpdate}
        canDelete={permissions.canDelete}
        onEdit={openEdit}
        onRegister={openRegister}
        onSchedule={setScheduleTarget}
        onEditCalibration={openEditCalibration}
        onCancelCalibration={setCancelRecord}
        onDelete={setDeleteTarget}
      />

      <CalibrationFormDialog
        open={calibrationOpen}
        onOpenChange={setCalibrationOpen}
        target={calibrationTarget}
        instruments={instruments}
        profiles={profiles}
        agencies={agencies}
        onSaved={handleSaved}
        onError={handleError}
      />

      <ScheduleDialog
        open={scheduleTarget !== null}
        onOpenChange={(open) => !open && setScheduleTarget(null)}
        instrument={scheduleTarget}
        profiles={profiles}
        agencies={agencies}
        canCancel={permissions.canUpdate}
        onSaved={handleSaved}
        onError={handleError}
        onRequestCancel={setCancelScheduleOf}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(result) => {
          pushNotice(
            "success",
            `엑셀 이관 완료: 계측기 ${result.instrumentsCreated}대, 교정이력 ${result.calibrationsCreated}건을 등록했습니다.`,
          )
          refresh()
        }}
      />

      <ReasonDialog
        open={cancelRecord !== null || cancelScheduleOf !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCancelRecord(null)
            setCancelScheduleOf(null)
          }
        }}
        title="교정 이력 취소"
        description="이력은 삭제되지 않고 '취소'로 표시되며, 최신 교정 판정에서 제외됩니다. 취소 내역은 변경 기록에 남습니다."
        confirmLabel="이력 취소"
        destructive
        pending={reasonPending}
        onConfirm={confirmCancel}
      />

      <ReasonDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="계측기 삭제"
        description="교정이력이 없는 계측기만 삭제할 수 있으며 목록에서 숨겨집니다(데이터는 보존). 이력이 있는 계측기는 사용상태를 '폐기'로 변경해 주세요."
        confirmLabel="삭제"
        destructive
        pending={reasonPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
