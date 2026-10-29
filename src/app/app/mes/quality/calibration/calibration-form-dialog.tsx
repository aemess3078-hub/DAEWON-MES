"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { registerCalibration, updateCalibration } from "@/lib/actions/instrument-calibration.actions"
import {
  CALIBRATION_RESULT_LABELS,
  computeNextCalibrationDate,
  formatIntervalMonths,
  todayDateKey,
  type CalibrationResultValue,
} from "@/lib/instrument-calibration"
import type { CalibrationRow, InstrumentRow } from "@/lib/instrument-calibration-view"
import { Field, SimpleSelect } from "./calibration-ui"

export type CalibrationDialogTarget = {
  /** 등록 대상 계측기(수정 시에는 이력의 계측기) */
  instrumentId: string | null
  /** 수정할 이력. 없으면 신규 등록 */
  record: CalibrationRow | null
  /** 예정/진행중 일정을 완료 처리하는 경우 */
  openCalibrationId: string | null
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: CalibrationDialogTarget
  instruments: InstrumentRow[]
  profiles: Array<{ id: string; name: string }>
  agencies: string[]
  onSaved: (message: string) => void
  onError: (message: string) => void
}

export function CalibrationFormDialog({ open, onOpenChange, target, instruments, profiles, agencies, onSaved, onError }: Props) {
  const isEdit = target.record !== null
  const [instrumentId, setInstrumentId] = React.useState("")
  const [calibrationDate, setCalibrationDate] = React.useState("")
  const [agency, setAgency] = React.useState("")
  const [certificateNo, setCertificateNo] = React.useState("")
  const [result, setResult] = React.useState<CalibrationResultValue>("PASS")
  const [manualNext, setManualNext] = React.useState<string | null>(null)
  const [changeReason, setChangeReason] = React.useState("")
  const [cost, setCost] = React.useState("")
  const [managerId, setManagerId] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState("")

  const today = todayDateKey()
  const selectable = React.useMemo(
    () => instruments.filter((i) => i.usageStatus !== "DISPOSED" && i.calibrationRequired),
    [instruments],
  )
  const instrument = instruments.find((i) => i.id === instrumentId) ?? null

  React.useEffect(() => {
    if (!open) return
    const record = target.record
    setInstrumentId(record?.instrumentId ?? target.instrumentId ?? "")
    setCalibrationDate(record?.calibrationDate ?? "")
    setAgency(record?.agency ?? "")
    setCertificateNo(record?.certificateNo ?? "")
    setResult(record?.result ?? "PASS")
    // 이관된 이력(교정일 미상)을 보강할 때는 엑셀의 차기교정일을 자동계산값으로 덮어쓰지 않고 그대로 유지한다.
    setManualNext(record && (record.nextDateOverridden || record.source === "EXCEL_IMPORT") ? record.nextCalibrationDate : null)
    setChangeReason(record?.nextDateChangeReason ?? "")
    setCost(record?.cost !== null && record?.cost !== undefined ? String(record.cost) : "")
    setManagerId(record?.managerId ?? "")
    setRemarks(record?.remarks ?? "")
    setFormError("")
  }, [open, target])

  const computedNext = computeNextCalibrationDate(calibrationDate, instrument?.calibrationIntervalMonths ?? null)
  const effectiveNext = manualNext ?? computedNext ?? ""
  const isOverridden = result === "PASS" && manualNext !== null && manualNext !== computedNext

  async function handleSubmit() {
    setFormError("")
    if (!instrumentId) return setFormError("계측기를 선택해 주세요.")
    if (!calibrationDate) return setFormError("교정실시일을 입력해 주세요.")
    if (calibrationDate > today) return setFormError("교정실시일은 오늘 이후로 등록할 수 없습니다.")
    if (result === "PASS" && !effectiveNext) {
      return setFormError("교정주기가 없어 차기교정일을 계산할 수 없습니다. 차기교정일을 직접 입력해 주세요.")
    }
    if (isOverridden && !changeReason.trim()) return setFormError("차기교정일을 직접 수정한 경우 수정 사유를 입력해 주세요.")

    const costNumber = cost.trim() === "" ? null : Number(cost.replace(/,/g, ""))
    if (costNumber !== null && (Number.isNaN(costNumber) || costNumber < 0)) return setFormError("교정비용은 0 이상의 숫자로 입력해 주세요.")

    const fields = {
      calibrationDate,
      calibrationAgency: agency,
      certificateNo,
      result,
      nextCalibrationDate: result === "PASS" && manualNext !== null ? manualNext : null,
      nextDateChangeReason: isOverridden ? changeReason : null,
      calibrationCost: costNumber,
      managerId: managerId || null,
      remarks,
    }

    setPending(true)
    const response = isEdit
      ? await updateCalibration(target.record!.id, fields)
      : await registerCalibration({ ...fields, instrumentId, openCalibrationId: target.openCalibrationId })
    setPending(false)

    if (!response.ok) {
      setFormError(response.error)
      onError(response.error)
      return
    }
    onOpenChange(false)
    const label = instrument?.managementNo ?? ""
    onSaved(
      result === "FAIL"
        ? `${label} 부적합 교정 결과를 ${isEdit ? "수정" : "등록"}했습니다. 계측기는 사용중지로 전환됩니다.`
        : `${label} 교정 실적을 ${isEdit ? "수정" : "등록"}했습니다.`,
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="text-[20px]">{isEdit ? "교정 실적 수정" : "교정 실적 등록"}</DialogTitle>
          <DialogDescription className="text-[14px]">
            성적서 번호만 기록하며 파일 첨부는 지원하지 않습니다. 이력은 누적 저장되고 수정·취소 내역은 변경 기록에 남습니다.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[68vh] px-6">
          <div className="space-y-4 pb-2">
            {formError && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-700">
                {formError}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="계측기" required>
                <SimpleSelect
                  value={instrumentId}
                  onChange={setInstrumentId}
                  disabled={isEdit || target.openCalibrationId !== null}
                  placeholder="계측기 선택"
                  options={(isEdit || target.openCalibrationId ? instruments : selectable).map((i) => ({
                    value: i.id,
                    label: `${i.managementNo} · ${i.name}`,
                  }))}
                />
              </Field>
              <Field label="관리번호">
                <Input value={instrument?.managementNo ?? ""} readOnly className="h-10 bg-muted/40 text-[14px]" />
              </Field>

              <Field label="교정실시일" required>
                <Input
                  type="date"
                  value={calibrationDate}
                  max={today}
                  onChange={(event) => setCalibrationDate(event.target.value)}
                  className="h-10 text-[14px]"
                />
              </Field>
              <Field label="교정결과" required>
                <SimpleSelect
                  value={result}
                  onChange={(v) => setResult(v as CalibrationResultValue)}
                  options={(Object.keys(CALIBRATION_RESULT_LABELS) as CalibrationResultValue[]).map((r) => ({
                    value: r,
                    label: CALIBRATION_RESULT_LABELS[r],
                  }))}
                />
              </Field>

              <Field label="교정기관">
                <Input
                  value={agency}
                  onChange={(event) => setAgency(event.target.value)}
                  list="calibration-agency-options"
                  placeholder="직접 입력 또는 선택"
                  maxLength={100}
                  className="h-10 text-[14px]"
                />
                <datalist id="calibration-agency-options">
                  {agencies.map((item) => (
                    <option key={item} value={item} />
                  ))}
                </datalist>
              </Field>
              <Field label="교정성적서번호">
                <Input value={certificateNo} onChange={(event) => setCertificateNo(event.target.value)} maxLength={100} className="h-10 text-[14px]" />
              </Field>
            </div>

            {result === "PASS" ? (
              <div className="rounded-lg border bg-muted/20 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="차기교정일"
                    required
                    hint={
                      instrument
                        ? `교정주기 ${formatIntervalMonths(instrument.calibrationIntervalMonths, instrument.calibrationRequired)} 기준으로 자동 계산됩니다.`
                        : "계측기를 선택하면 자동 계산됩니다."
                    }
                  >
                    <Input
                      type="date"
                      value={effectiveNext}
                      onChange={(event) => {
                        const value = event.target.value
                        setManualNext(value === "" || value === computedNext ? null : value)
                      }}
                      className="h-10 text-[14px]"
                    />
                  </Field>
                  <div className="flex items-end">
                    {isOverridden ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setManualNext(null)}>
                        자동계산값으로 되돌리기{computedNext ? ` (${computedNext})` : ""}
                      </Button>
                    ) : (
                      <p className="pb-2 text-[13px] text-muted-foreground">성적서 기재일이나 내부 기준에 따라 직접 수정할 수 있습니다.</p>
                    )}
                  </div>
                </div>
                {isOverridden && (
                  <Field label="차기교정일 수정 사유" required className="mt-4">
                    <Input value={changeReason} onChange={(event) => setChangeReason(event.target.value)} maxLength={300} className="h-10 text-[14px]" />
                  </Field>
                )}
              </div>
            ) : (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-700">
                부적합 결과는 정상 교정 완료로 처리되지 않습니다. 차기교정일은 갱신되지 않고, 최근 결과가 부적합인 계측기는 사용중지로 전환됩니다.
                이후 적합 교정을 등록해도 사용가능으로 자동 복귀하지 않으므로 관리자가 직접 상태를 변경해야 합니다.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="교정비용(원)">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  value={cost}
                  onChange={(event) => setCost(event.target.value)}
                  className="h-10 text-[14px]"
                />
              </Field>
              <Field label="교정담당자">
                <SimpleSelect
                  value={managerId}
                  onChange={setManagerId}
                  noneLabel="미지정"
                  placeholder="미지정"
                  options={profiles.map((p) => ({ value: p.id, label: p.name }))}
                />
              </Field>
            </div>
            <Field label="비고">
              <Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={500} className="min-h-[72px]" />
            </Field>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 border-t px-6 py-4 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            취소
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={pending}>
            {pending ? "저장 중..." : isEdit ? "저장" : "등록"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
