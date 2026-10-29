"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  getInstrumentDetailExtras,
  type InstrumentDetailExtras,
} from "@/lib/actions/instrument-calibration.actions"
import { USAGE_STATUS_LABELS } from "@/lib/instrument-calibration"
import type { CalibrationRow, InstrumentRow } from "@/lib/instrument-calibration-view"
import {
  CalibrationStateChip,
  ProgressChip,
  ResultChip,
  UsageStatusChip,
  formatCost,
  formatDate,
  formatRemaining,
} from "./calibration-ui"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  instrument: InstrumentRow | null
  calibrations: CalibrationRow[]
  /** 데이터가 바뀌면(저장 후 refresh) 부가 정보를 다시 읽기 위한 키 */
  refreshKey: number
  canCreate: boolean
  canUpdate: boolean
  canDelete: boolean
  onEdit: (row: InstrumentRow) => void
  onRegister: (row: InstrumentRow) => void
  onSchedule: (row: InstrumentRow) => void
  onEditCalibration: (row: CalibrationRow) => void
  onCancelCalibration: (row: CalibrationRow) => void
  onDelete: (row: InstrumentRow) => void
}

function InfoItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="text-[15px] font-medium">{children || "-"}</dd>
    </div>
  )
}

export function InstrumentDetailSheet({
  open,
  onOpenChange,
  instrument,
  calibrations,
  refreshKey,
  canCreate,
  canUpdate,
  canDelete,
  onEdit,
  onRegister,
  onSchedule,
  onEditCalibration,
  onCancelCalibration,
  onDelete,
}: Props) {
  const [extras, setExtras] = React.useState<InstrumentDetailExtras | null>(null)
  const [loading, setLoading] = React.useState(false)
  const instrumentId = instrument?.id ?? null

  React.useEffect(() => {
    if (!open || !instrumentId) return
    let cancelled = false
    setLoading(true)
    getInstrumentDetailExtras(instrumentId).then((response) => {
      if (cancelled) return
      setExtras(response.ok ? response.data : null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [open, instrumentId, refreshKey])

  const history = React.useMemo(
    () =>
      calibrations
        .filter((c) => c.instrumentId === instrumentId && c.progressStatus === "COMPLETED")
        // 교정일 미상(엑셀 이관) 이력은 차기교정일로 최신순을 맞춘다.
        .sort(
          (a, b) =>
            (b.calibrationDate ?? b.nextCalibrationDate ?? "").localeCompare(a.calibrationDate ?? a.nextCalibrationDate ?? "") ||
            b.createdAtMs - a.createdAtMs,
        ),
    [calibrations, instrumentId],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col overflow-y-auto sm:max-w-3xl">
        {instrument && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2 text-[22px]">
                <span className="font-mono">{instrument.managementNo}</span>
                <span>{instrument.name}</span>
              </SheetTitle>
              <SheetDescription className="text-[14px]">
                {[instrument.category, instrument.specification].filter(Boolean).join(" · ") || "계측기 상세 정보"}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-5 space-y-6">
              {/* 사용 가능 여부 — 사용상태와 교정 유효상태를 별도로 표시 */}
              {instrument.usageStatus !== "DISPOSED" && (
                instrument.usable ? (
                  <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-green-800">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                    <div className="text-[14px]">
                      <p className="font-semibold">사용 가능</p>
                      {instrument.warnings.map((w) => (
                        <p key={w} className="text-yellow-800">{w}</p>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                    <div className="text-[14px]">
                      <p className="font-semibold">사용 불가 — 측정에 사용하지 마세요</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">
                        {instrument.blockReasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )
              )}

              <div className="flex flex-wrap gap-2">
                {canUpdate && (
                  <Button type="button" variant="outline" className="text-[14px]" onClick={() => onEdit(instrument)}>
                    정보 수정
                  </Button>
                )}
                {canCreate && instrument.calibrationRequired && instrument.usageStatus !== "DISPOSED" && (
                  <Button type="button" className="text-[14px]" onClick={() => onRegister(instrument)}>
                    교정 실적 등록
                  </Button>
                )}
                {canUpdate && instrument.calibrationRequired && instrument.usageStatus !== "DISPOSED" && (
                  <Button type="button" variant="outline" className="text-[14px]" onClick={() => onSchedule(instrument)}>
                    교정 일정 지정
                  </Button>
                )}
                {canDelete && instrument.historyCount === 0 && (
                  <Button type="button" variant="ghost" className="text-[14px] text-red-600 hover:text-red-700" onClick={() => onDelete(instrument)}>
                    삭제
                  </Button>
                )}
              </div>

              <section>
                <h3 className="mb-3 text-[18px] font-semibold">기본 정보</h3>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                  <InfoItem label="사용상태">
                    <UsageStatusChip status={instrument.usageStatus} />
                  </InfoItem>
                  <InfoItem label="교정상태">
                    <CalibrationStateChip state={instrument.calibrationState} />
                  </InfoItem>
                  <InfoItem label="교정주기">{instrument.intervalLabel}</InfoItem>
                  <InfoItem label="최근교정일">{formatDate(instrument.lastCalibrationDate)}</InfoItem>
                  <InfoItem label="차기교정일">
                    <span className={instrument.calibrationState === "OVERDUE" ? "text-red-600" : undefined}>
                      {formatDate(instrument.nextCalibrationDate)}
                      {instrument.remainingDays !== null && instrument.calibrationState !== "EXEMPT" && (
                        <span className="ml-1.5 text-[13px]">({formatRemaining(instrument.remainingDays)})</span>
                      )}
                    </span>
                  </InfoItem>
                  <InfoItem label="진행상태">
                    <ProgressChip status={instrument.scheduleProgress} />
                  </InfoItem>
                  <InfoItem label="Serial No">
                    <span className="font-mono text-[14px]">{instrument.serialNo}</span>
                  </InfoItem>
                  <InfoItem label="제조사">{instrument.manufacturer}</InfoItem>
                  <InfoItem label="관리책임자">{instrument.managerName}</InfoItem>
                  <InfoItem label="사용부서">{instrument.department}</InfoItem>
                  <InfoItem label="사용장소">{instrument.location}</InfoItem>
                  <InfoItem label="데이터 출처">{instrument.source === "EXCEL_IMPORT" ? "엑셀 이관" : "직접 등록"}</InfoItem>
                </dl>
                {instrument.remarks && (
                  <p className="mt-4 whitespace-pre-wrap rounded-md bg-muted/30 px-3 py-2 text-[14px]">{instrument.remarks}</p>
                )}
              </section>

              <section>
                <h3 className="mb-3 text-[18px] font-semibold">검교정 이력 ({history.length.toLocaleString("ko-KR")}건)</h3>
                {history.length === 0 ? (
                  <p className="rounded-md border border-dashed px-4 py-6 text-center text-[14px] text-muted-foreground">등록된 교정 이력이 없습니다.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-[14px]">
                      <thead className="bg-muted/40 text-[13px] text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">교정일</th>
                          <th className="px-3 py-2 text-left font-medium">교정기관</th>
                          <th className="px-3 py-2 text-left font-medium">성적서번호</th>
                          <th className="px-3 py-2 text-left font-medium">결과</th>
                          <th className="px-3 py-2 text-left font-medium">차기교정일</th>
                          <th className="px-3 py-2 text-left font-medium">비용</th>
                          <th className="px-3 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {history.map((record) => (
                          <tr key={record.id} className={`border-t ${record.cancelled ? "text-muted-foreground line-through decoration-1" : ""}`}>
                            <td className="whitespace-nowrap px-3 py-2">{record.calibrationDate ?? <span className="text-[13px] text-muted-foreground">미기재(이관)</span>}</td>
                            <td className="px-3 py-2">{record.agency || "-"}</td>
                            <td className="px-3 py-2 font-mono text-[13px]">{record.certificateNo || "-"}</td>
                            <td className="px-3 py-2">
                              <ResultChip result={record.result} cancelled={record.cancelled} />
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              {formatDate(record.nextCalibrationDate)}
                              {record.isCurrent && <span className="ml-1.5 text-[13px] font-medium text-green-700 no-underline">현재 유효</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">{formatCost(record.cost)}</td>
                            <td className="whitespace-nowrap px-3 py-2 text-right">
                              {canUpdate && !record.cancelled && (
                                <>
                                  <Button type="button" variant="ghost" size="sm" className="text-[14px]" onClick={() => onEditCalibration(record)}>
                                    수정
                                  </Button>
                                  <Button type="button" variant="ghost" size="sm" className="text-[14px] text-red-600 hover:text-red-700" onClick={() => onCancelCalibration(record)}>
                                    취소
                                  </Button>
                                </>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-3 text-[18px] font-semibold">사용상태 변경 이력</h3>
                {loading && !extras ? (
                  <p className="flex items-center gap-2 text-[14px] text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> 불러오는 중...
                  </p>
                ) : extras && extras.statusHistory.length > 0 ? (
                  <ul className="space-y-2 text-[14px]">
                    {extras.statusHistory.map((h) => (
                      <li key={h.id} className="rounded-md border px-3 py-2">
                        <p>
                          <span className="font-medium">
                            {h.previousStatus ? `${USAGE_STATUS_LABELS[h.previousStatus]} → ` : ""}
                            {USAGE_STATUS_LABELS[h.newStatus]}
                          </span>
                          <span className="ml-2 text-[13px] text-muted-foreground">
                            {new Date(h.changedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                            {h.changedByName ? ` · ${h.changedByName}` : ""}
                          </span>
                        </p>
                        {h.reason && <p className="text-[13px] text-muted-foreground">사유: {h.reason}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[14px] text-muted-foreground">변경 이력이 없습니다.</p>
                )}
              </section>

              <section>
                <h3 className="mb-3 text-[18px] font-semibold">수정·취소 기록</h3>
                {extras && extras.changeLog.length > 0 ? (
                  <ul className="space-y-2 text-[14px]">
                    {extras.changeLog.map((log) => (
                      <li key={log.id} className="rounded-md border px-3 py-2">
                        <p>
                          <span className="font-medium">
                            {log.target} {log.action === "CREATE" ? "등록" : log.action === "DELETE" ? "삭제" : "변경"}
                          </span>
                          <span className="ml-2 text-[13px] text-muted-foreground">
                            {new Date(log.actedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                            {log.actor ? ` · ${log.actor}` : ""}
                          </span>
                        </p>
                        {log.changedFields.length > 0 && <p className="text-[13px] text-muted-foreground">변경 항목: {log.changedFields.join(", ")}</p>}
                        {log.reason && <p className="text-[13px] text-muted-foreground">사유: {log.reason}</p>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[14px] text-muted-foreground">{loading ? "불러오는 중..." : "기록이 없습니다."}</p>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
