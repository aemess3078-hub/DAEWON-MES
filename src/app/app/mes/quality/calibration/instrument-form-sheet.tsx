"use client"

import * as React from "react"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { FormSheet } from "@/components/common/form-sheet"
import {
  createInstrument,
  updateInstrument,
} from "@/lib/actions/instrument-calibration.actions"
import {
  INTERVAL_PRESETS,
  USAGE_STATUS_LABELS,
  type InstrumentUsageStatusValue,
} from "@/lib/instrument-calibration"
import type { InstrumentRow } from "@/lib/instrument-calibration-view"
import { Field, SimpleSelect } from "./calibration-ui"

const CUSTOM = "custom"
const EXEMPT = "exempt"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 수정 대상. 없으면 신규 등록 */
  instrument: InstrumentRow | null
  profiles: Array<{ id: string; name: string }>
  categories: string[]
  departments: string[]
  canDispose: boolean
  onSaved: (message: string) => void
  onError: (message: string) => void
}

function intervalChoice(row: InstrumentRow | null): string {
  if (!row) return "12"
  if (!row.calibrationRequired) return EXEMPT
  const months = row.calibrationIntervalMonths
  if (months === null) return "12"
  return INTERVAL_PRESETS.some((p) => p.months === months) ? String(months) : CUSTOM
}

export function InstrumentFormSheet({
  open,
  onOpenChange,
  instrument,
  profiles,
  categories,
  departments,
  canDispose,
  onSaved,
  onError,
}: Props) {
  const isEdit = instrument !== null
  const [managementNo, setManagementNo] = React.useState("")
  const [name, setName] = React.useState("")
  const [category, setCategory] = React.useState("")
  const [specification, setSpecification] = React.useState("")
  const [serialNo, setSerialNo] = React.useState("")
  const [manufacturer, setManufacturer] = React.useState("")
  const [intervalSelect, setIntervalSelect] = React.useState("12")
  const [customMonths, setCustomMonths] = React.useState("")
  const [department, setDepartment] = React.useState("")
  const [location, setLocation] = React.useState("")
  const [managerId, setManagerId] = React.useState("")
  const [usageStatus, setUsageStatus] = React.useState<InstrumentUsageStatusValue>("AVAILABLE")
  const [statusReason, setStatusReason] = React.useState("")
  const [remarks, setRemarks] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [formError, setFormError] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setManagementNo(instrument?.managementNo ?? "")
    setName(instrument?.name ?? "")
    setCategory(instrument?.category ?? "")
    setSpecification(instrument?.specification ?? "")
    setSerialNo(instrument?.serialNo ?? "")
    setManufacturer(instrument?.manufacturer ?? "")
    const choice = intervalChoice(instrument)
    setIntervalSelect(choice)
    setCustomMonths(choice === CUSTOM && instrument?.calibrationIntervalMonths ? String(instrument.calibrationIntervalMonths) : "")
    setDepartment(instrument?.department ?? "")
    setLocation(instrument?.location ?? "")
    setManagerId(instrument?.managerId ?? "")
    setUsageStatus(instrument?.usageStatus ?? "AVAILABLE")
    setStatusReason("")
    setRemarks(instrument?.remarks ?? "")
    setFormError("")
  }, [open, instrument])

  const statusChanged = isEdit && instrument.usageStatus !== usageStatus

  async function handleSubmit() {
    setFormError("")
    const calibrationRequired = intervalSelect !== EXEMPT
    let months: number | null = null
    if (calibrationRequired) {
      months = intervalSelect === CUSTOM ? Number(customMonths) : Number(intervalSelect)
      if (!Number.isInteger(months) || months < 1) {
        setFormError("교정주기(개월)를 1 이상의 정수로 입력해 주세요.")
        return
      }
    }
    if (!isEdit && !managementNo.trim()) {
      setFormError("관리번호를 입력해 주세요.")
      return
    }
    if (!name.trim()) {
      setFormError("계측기명을 입력해 주세요.")
      return
    }
    if (statusChanged && !statusReason.trim()) {
      setFormError("사용상태를 변경하는 경우 변경 사유를 입력해 주세요.")
      return
    }

    setPending(true)
    const common = {
      name,
      category,
      specification,
      serialNo,
      manufacturer,
      calibrationRequired,
      calibrationIntervalMonths: months,
      department,
      location,
      managerId: managerId || null,
      remarks,
      usageStatus,
    }
    const result = isEdit
      ? await updateInstrument(instrument.id, { ...common, statusReason })
      : await createInstrument({ ...common, managementNo })
    setPending(false)

    if (!result.ok) {
      setFormError(result.error)
      onError(result.error)
      return
    }
    onOpenChange(false)
    onSaved(isEdit ? `${instrument.managementNo} 정보를 저장했습니다.` : `${managementNo.trim()} 계측기를 등록했습니다.`)
  }

  const statusOptions = (Object.keys(USAGE_STATUS_LABELS) as InstrumentUsageStatusValue[])
    .filter((status) => canDispose || status !== "DISPOSED" || instrument?.usageStatus === "DISPOSED")
    .map((status) => ({ value: status, label: USAGE_STATUS_LABELS[status] }))

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode={isEdit ? "edit" : "create"}
      title={isEdit ? "계측기 수정" : "계측기 등록"}
      description={isEdit ? `${instrument.managementNo} · 관리번호는 변경할 수 없습니다.` : "기존 대원정밀 관리번호 체계(예: DW-A01)를 그대로 사용합니다."}
      isLoading={pending}
      onSubmit={handleSubmit}
      contentClassName="sm:max-w-xl"
    >
      {formError && (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-700">
          {formError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="관리번호" required>
          <Input
            value={managementNo}
            onChange={(event) => setManagementNo(event.target.value)}
            disabled={isEdit}
            placeholder="DW-A01"
            maxLength={50}
            className="h-10 text-[14px]"
          />
        </Field>
        <Field label="계측기명" required>
          <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} className="h-10 text-[14px]" />
        </Field>
        <Field label="계측기 분류">
          <Input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            list="calibration-category-options"
            placeholder="예: 캘리퍼스"
            maxLength={100}
            className="h-10 text-[14px]"
          />
          <datalist id="calibration-category-options">
            {categories.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </Field>
        <Field label="규격" hint="측정범위/정밀도 (예: 300/0.05)">
          <Input value={specification} onChange={(event) => setSpecification(event.target.value)} maxLength={200} className="h-10 text-[14px]" />
        </Field>
        <Field label="Serial No" hint="숫자처럼 보여도 문자열로 저장합니다(선행 0 유지).">
          <Input value={serialNo} onChange={(event) => setSerialNo(event.target.value)} maxLength={100} className="h-10 text-[14px]" />
        </Field>
        <Field label="제조사">
          <Input value={manufacturer} onChange={(event) => setManufacturer(event.target.value)} maxLength={100} className="h-10 text-[14px]" />
        </Field>

        <Field label="교정주기" required>
          <SimpleSelect
            value={intervalSelect}
            onChange={setIntervalSelect}
            options={[
              ...INTERVAL_PRESETS.map((p) => ({ value: String(p.months), label: p.label })),
              { value: CUSTOM, label: "사용자 지정(개월)" },
              { value: EXEMPT, label: "교정대상 제외" },
            ]}
          />
        </Field>
        {intervalSelect === CUSTOM ? (
          <Field label="사용자 지정 개월 수" required>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              max={360}
              value={customMonths}
              onChange={(event) => setCustomMonths(event.target.value)}
              placeholder="예: 18"
              className="h-10 text-[14px]"
            />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}

        <Field label="사용부서">
          <Input
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            list="calibration-department-options"
            maxLength={100}
            className="h-10 text-[14px]"
          />
          <datalist id="calibration-department-options">
            {departments.map((item) => (
              <option key={item} value={item} />
            ))}
          </datalist>
        </Field>
        <Field label="사용장소">
          <Input value={location} onChange={(event) => setLocation(event.target.value)} maxLength={100} className="h-10 text-[14px]" />
        </Field>
        <Field label="관리책임자">
          <SimpleSelect
            value={managerId}
            onChange={setManagerId}
            noneLabel="미지정"
            placeholder="미지정"
            options={profiles.map((p) => ({ value: p.id, label: p.name }))}
          />
        </Field>
        <Field label="사용상태" required>
          <SimpleSelect value={usageStatus} onChange={(v) => setUsageStatus(v as InstrumentUsageStatusValue)} options={statusOptions} />
        </Field>
      </div>

      {statusChanged && (
        <Field label="사용상태 변경 사유" required hint="변경 이력에 기록됩니다.">
          <Input value={statusReason} onChange={(event) => setStatusReason(event.target.value)} maxLength={300} className="h-10 text-[14px]" />
        </Field>
      )}
      {isEdit && instrument.latestResult === "FAIL" && usageStatus === "AVAILABLE" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          최근 교정 결과가 부적합입니다. 사용가능으로 변경하더라도 재교정 적합 이력이 등록되기 전까지는 사용 가능 계측기로 집계되지 않습니다.
        </p>
      )}

      <Field label="비고">
        <Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} maxLength={500} className="min-h-[88px]" />
      </Field>
    </FormSheet>
  )
}
