"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { saveCalibrationSchedule } from "@/lib/actions/instrument-calibration.actions"
import type { InstrumentRow } from "@/lib/instrument-calibration-view"
import { Field, SimpleSelect } from "./calibration-ui"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  instrument: InstrumentRow | null
  profiles: Array<{ id: string; name: string }>
  agencies: string[]
  canCancel: boolean
  onSaved: (message: string) => void
  onError: (message: string) => void
  onRequestCancel: (instrument: InstrumentRow) => void
}

export function ScheduleDialog({ open, onOpenChange, instrument, profiles, agencies, canCancel, onSaved, onError, onRequestCancel }: Props) {
  const [status, setStatus] = React.useState<"SCHEDULED" | "IN_PROGRESS">("SCHEDULED")
  const [plannedDate, setPlannedDate] = React.useState("")
  const [agency, setAgency] = React.useState("")
  const [managerId, setManagerId] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState("")

  React.useEffect(() => {
    if (!open || !instrument) return
    setStatus(instrument.scheduleProgress === "IN_PROGRESS" ? "IN_PROGRESS" : "SCHEDULED")
    setPlannedDate(instrument.plannedDate ?? "")
    setAgency(instrument.openCalibrationId ? instrument.scheduleAgency : instrument.currentAgency)
    setManagerId(instrument.scheduleManagerId ?? instrument.managerId ?? "")
    setFormError("")
  }, [open, instrument])

  if (!instrument) return null

  async function handleSubmit() {
    if (!instrument) return
    setFormError("")
    setPending(true)
    const response = await saveCalibrationSchedule({
      instrumentId: instrument.id,
      status,
      plannedDate: plannedDate || null,
      calibrationAgency: agency,
      managerId: managerId || null,
    })
    setPending(false)
    if (!response.ok) {
      setFormError(response.error)
      onError(response.error)
      return
    }
    onOpenChange(false)
    onSaved(`${instrument.managementNo} 교정 일정을 저장했습니다.`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-[20px]">교정 일정 지정</DialogTitle>
          <DialogDescription className="text-[14px]">
            {instrument.managementNo} · {instrument.name}. 진행상태는 기한초과 여부와 별개로 관리되며, 외부 교정 중이어도 차기교정일이 지났다면 기한초과로 계속 표시됩니다.
          </DialogDescription>
        </DialogHeader>

        {formError && (
          <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-700">
            {formError}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="진행상태" required>
            <SimpleSelect
              value={status}
              onChange={(v) => setStatus(v as "SCHEDULED" | "IN_PROGRESS")}
              options={[
                { value: "SCHEDULED", label: "예정" },
                { value: "IN_PROGRESS", label: "진행중" },
              ]}
            />
          </Field>
          <Field label="교정 예정일">
            <Input type="date" value={plannedDate} onChange={(event) => setPlannedDate(event.target.value)} className="h-10 text-[14px]" />
          </Field>
          <Field label="교정기관(예정)">
            <Input
              value={agency}
              onChange={(event) => setAgency(event.target.value)}
              list="calibration-agency-options-schedule"
              maxLength={100}
              className="h-10 text-[14px]"
            />
            <datalist id="calibration-agency-options-schedule">
              {agencies.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </Field>
          <Field label="담당자">
            <SimpleSelect
              value={managerId}
              onChange={setManagerId}
              noneLabel="미지정"
              placeholder="미지정"
              options={profiles.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Field>
        </div>

        <DialogFooter className="gap-2 sm:items-center sm:justify-between sm:gap-0 sm:space-x-0">
          <div>
            {instrument.openCalibrationId && canCancel && (
              <Button
                type="button"
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                onClick={() => {
                  onOpenChange(false)
                  onRequestCancel(instrument)
                }}
              >
                일정 취소
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              닫기
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={pending}>
              {pending ? "저장 중..." : "저장"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
