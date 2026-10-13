"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, ChevronsUpDown, Loader2, Plus, Star, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import {
  addItemSupplier,
  getItemSuppliers,
  removeItemSupplier,
  searchItemSupplierCandidates,
  setDefaultItemSupplier,
  setItemSupplierActive,
  updateItemSupplierConditions,
} from "@/lib/actions/item-supplier.actions"
import type { ItemSupplierView, SupplierCandidate } from "@/lib/services/item-supplier.service"

interface ItemSupplierSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: { id: string; code: string; name: string } | null
  /** 등록/수정/기본지정/비활성 UI 노출(서버가 권한을 다시 검증한다) */
  canMutate: boolean
  /** 물리 삭제 UI 노출(ITEM DELETE 권한 — 서버가 다시 검증한다) */
  canDelete: boolean
}

type FormState = {
  mode: "add" | "edit"
  relationId?: string
  supplier: SupplierCandidate | null
  supplierLabel?: string
  isDefault: boolean
  priority: string
  leadTimeDays: string
  moq: string
  orderMultiple: string
}

const EMPTY_FORM: FormState = {
  mode: "add",
  supplier: null,
  isDefault: false,
  priority: "",
  leadTimeDays: "",
  moq: "",
  orderMultiple: "",
}

function fmtNumber(v: number | null) {
  return v === null ? "-" : v.toLocaleString("ko-KR", { maximumFractionDigits: 6 })
}

/** 빈 문자열 → null(미설정). 숫자가 아니면 NaN 을 돌려 서버 검증이 거부하게 하지 않고 클라이언트에서 먼저 막는다. */
function parseOptional(raw: string): number | null | "INVALID" {
  const t = raw.trim()
  if (t === "") return null
  const n = Number(t.replaceAll(",", ""))
  return Number.isFinite(n) ? n : "INVALID"
}

export function ItemSupplierSheet({ open, onOpenChange, item, canMutate, canDelete }: ItemSupplierSheetProps) {
  const [rows, setRows] = useState<ItemSupplierView[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const itemId = item?.id ?? null

  const reload = useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    setLoadError(null)
    try {
      const res = await getItemSuppliers(itemId)
      if (res.success) setRows(res.data)
      else setLoadError(res.error)
    } catch {
      setLoadError("공급업체 목록을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    if (open && itemId) {
      setRows([])
      setForm(null)
      setFormError(null)
      setNotice(null)
      void reload()
    }
  }, [open, itemId, reload])

  const showPrices = rows.some((r) => r.currentPrice !== null)
  const hasActiveDefault = rows.some((r) => r.isDefault && r.isActive)

  function openAddForm() {
    setFormError(null)
    setNotice(null)
    // 기본 공급업체가 아직 없으면 첫 공급업체를 기본으로 제안한다(사용자가 해제할 수 있다).
    setForm({ ...EMPTY_FORM, isDefault: !hasActiveDefault })
  }

  function openEditForm(r: ItemSupplierView) {
    setFormError(null)
    setNotice(null)
    setForm({
      mode: "edit",
      relationId: r.id,
      supplier: null,
      supplierLabel: `[${r.supplierCode}] ${r.supplierName}`,
      isDefault: r.isDefault,
      priority: String(r.priority),
      leadTimeDays: r.leadTimeDays === null ? "" : String(r.leadTimeDays),
      moq: r.moq === null ? "" : String(r.moq),
      orderMultiple: r.orderMultiple === null ? "" : String(r.orderMultiple),
    })
  }

  async function handleSave() {
    if (!form || !itemId) return
    setFormError(null)

    const lead = parseOptional(form.leadTimeDays)
    const moq = parseOptional(form.moq)
    const multiple = parseOptional(form.orderMultiple)
    const priority = parseOptional(form.priority)
    if (lead === "INVALID" || moq === "INVALID" || multiple === "INVALID" || priority === "INVALID") {
      setFormError("숫자를 올바르게 입력해 주세요.")
      return
    }
    if (form.mode === "add" && !form.supplier) {
      setFormError("공급업체를 선택해 주세요.")
      return
    }
    if (lead !== null && (!Number.isInteger(lead) || lead < 0)) {
      setFormError("리드타임은 0 이상의 정수(일)로 입력해 주세요.")
      return
    }
    if (moq !== null && !(moq > 0)) {
      setFormError("MOQ는 0보다 커야 합니다. 설정하지 않으려면 비워 두세요.")
      return
    }
    if (multiple !== null && !(multiple > 0)) {
      setFormError("발주배수는 0보다 커야 합니다. 설정하지 않으려면 비워 두세요.")
      return
    }
    if (priority !== null && (!Number.isInteger(priority) || priority < 0)) {
      setFormError("우선순위는 0 이상의 정수로 입력해 주세요.")
      return
    }

    setSaving(true)
    try {
      const res =
        form.mode === "add"
          ? await addItemSupplier(itemId, {
              supplierId: form.supplier!.id,
              isDefault: form.isDefault,
              ...(priority !== null ? { priority } : {}),
              leadTimeDays: lead,
              moq,
              orderMultiple: multiple,
            })
          : await updateItemSupplierConditions(form.relationId!, {
              ...(priority !== null ? { priority } : {}),
              leadTimeDays: lead,
              moq,
              orderMultiple: multiple,
              isDefault: form.isDefault,
            })
      if (!res.success) {
        setFormError(res.error)
        return
      }
      setForm(null)
      setNotice(form.mode === "add" ? "공급업체를 등록했습니다." : "변경 사항을 저장했습니다.")
      await reload()
    } catch {
      setFormError("저장 중 오류가 발생했습니다.")
    } finally {
      setSaving(false)
    }
  }

  async function runRowAction(id: string, op: () => Promise<{ success: boolean; error?: string }>, okMessage: string) {
    setBusyId(id)
    setNotice(null)
    try {
      const res = await op()
      if (!res.success) {
        setLoadError(res.error ?? "처리에 실패했습니다.")
        return
      }
      setLoadError(null)
      setNotice(okMessage)
      await reload()
    } catch {
      setLoadError("처리 중 오류가 발생했습니다.")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[960px]">
        <SheetHeader>
          <SheetTitle>공급업체 관리</SheetTitle>
          <SheetDescription>
            {item ? (
              <>
                <span className="font-mono">{item.code}</span> · {item.name}
              </>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[14px] text-muted-foreground">
              품목별 공급업체와 발주 조건(리드타임·MOQ·발주배수)을 관리합니다. 단가는 여기서 편집하지 않습니다.
            </p>
            {canMutate && !form && (
              <Button size="sm" className="h-9 shrink-0 gap-1.5 text-[14px]" onClick={openAddForm}>
                <Plus className="h-4 w-4" />
                공급업체 추가
              </Button>
            )}
          </div>

          {notice && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[14px] text-emerald-800">
              {notice}
            </p>
          )}
          {loadError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[14px] text-red-800">
              {loadError}
            </p>
          )}

          {form && (
            <SupplierForm
              itemId={item!.id}
              form={form}
              setForm={setForm}
              saving={saving}
              error={formError}
              onCancel={() => {
                setForm(null)
                setFormError(null)
              }}
              onSave={handleSave}
            />
          )}

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[13px]">공급업체</TableHead>
                  <TableHead className="text-[13px]">기본</TableHead>
                  <TableHead className="text-right text-[13px]">우선순위</TableHead>
                  <TableHead className="text-right text-[13px]">리드타임(일)</TableHead>
                  <TableHead className="text-right text-[13px]">MOQ</TableHead>
                  <TableHead className="text-right text-[13px]">발주배수</TableHead>
                  {showPrices && <TableHead className="text-right text-[13px]">현재 단가</TableHead>}
                  <TableHead className="text-[13px]">상태</TableHead>
                  {canMutate && <TableHead className="text-right text-[13px]">작업</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-[14px] text-muted-foreground">
                      <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                      불러오는 중...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center">
                      <p className="text-[15px] font-medium text-foreground">등록된 공급업체가 없습니다.</p>
                      <p className="mt-1 text-[14px] text-muted-foreground">
                        MRP 발주제안을 사용하려면 품목별 공급업체를 등록하세요.
                      </p>
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id} className={cn(!r.isActive && "text-muted-foreground")}>
                    <TableCell className="text-[14px]">
                      <div className="font-medium">{r.supplierName}</div>
                      <div className="font-mono text-[13px] text-muted-foreground">{r.supplierCode}</div>
                      {r.supplierStatus !== "ACTIVE" && (
                        <Badge variant="outline" className="mt-1 text-[13px] text-amber-700">
                          거래처 비활성
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.isDefault && r.isActive ? (
                        <Badge className="gap-1 text-[13px]">
                          <Star className="h-3 w-3" />
                          기본
                        </Badge>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-[14px] tabular-nums">{r.priority}</TableCell>
                    <TableCell className="text-right text-[14px] tabular-nums">{fmtNumber(r.leadTimeDays)}</TableCell>
                    <TableCell className="text-right text-[14px] tabular-nums">{fmtNumber(r.moq)}</TableCell>
                    <TableCell className="text-right text-[14px] tabular-nums">{fmtNumber(r.orderMultiple)}</TableCell>
                    {showPrices && (
                      <TableCell className="text-right text-[14px] tabular-nums">
                        {r.currentPrice
                          ? `${r.currentPrice.unitPrice.toLocaleString("ko-KR")} ${r.currentPrice.currency}`
                          : "-"}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge
                        variant={r.isActive ? "secondary" : "outline"}
                        className="text-[13px]"
                      >
                        {r.isActive ? "활성" : "비활성"}
                      </Badge>
                    </TableCell>
                    {canMutate && (
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-1">
                          {r.isActive && !r.isDefault && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 text-[13px]"
                              disabled={busyId === r.id}
                              onClick={() =>
                                runRowAction(r.id, () => setDefaultItemSupplier(r.id), "기본 공급업체를 변경했습니다.")
                              }
                            >
                              기본 지정
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-[13px]"
                            disabled={busyId === r.id}
                            onClick={() => openEditForm(r)}
                          >
                            수정
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-[13px]"
                            disabled={busyId === r.id}
                            onClick={() =>
                              runRowAction(
                                r.id,
                                () => setItemSupplierActive(r.id, !r.isActive),
                                r.isActive ? "비활성 처리했습니다." : "활성 처리했습니다."
                              )
                            }
                          >
                            {r.isActive ? "비활성" : "활성화"}
                          </Button>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-[13px] text-destructive hover:text-destructive"
                              disabled={busyId === r.id}
                              onClick={() => {
                                if (
                                  !confirm(
                                    `'${r.supplierName}' 공급업체 관계를 삭제하시겠습니까?\n\n삭제 대신 비활성 처리하면 설정을 보존할 수 있습니다.`
                                  )
                                )
                                  return
                                void runRowAction(r.id, () => removeItemSupplier(r.id), "삭제했습니다.")
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">삭제</span>
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-[13px] text-muted-foreground">
            우선순위는 숫자가 작을수록 우선입니다. 비활성 처리하면 기본 공급업체 지정도 함께 해제됩니다.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── 등록/수정 폼 ────────────────────────────────────────────────────────────────

function SupplierForm({
  itemId,
  form,
  setForm,
  saving,
  error,
  onCancel,
  onSave,
}: {
  itemId: string
  form: FormState
  setForm: (updater: (prev: FormState | null) => FormState | null) => void
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: () => void
}) {
  const patch = (p: Partial<FormState>) => setForm((prev) => (prev ? { ...prev, ...p } : prev))

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      <h3 className="text-[16px] font-semibold">
        {form.mode === "add" ? "공급업체 추가" : "발주 조건 수정"}
      </h3>

      <div className="space-y-1.5">
        <Label className="text-[14px]">공급업체</Label>
        {form.mode === "add" ? (
          <SupplierCombobox
            itemId={itemId}
            value={form.supplier}
            onChange={(s) => patch({ supplier: s })}
          />
        ) : (
          <p className="text-[14px] font-medium">{form.supplierLabel}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <NumberField
          label="우선순위"
          hint="작을수록 우선 (기본 100)"
          value={form.priority}
          onChange={(v) => patch({ priority: v })}
          placeholder="100"
        />
        <NumberField
          label="리드타임(일)"
          hint="비우면 미설정"
          value={form.leadTimeDays}
          onChange={(v) => patch({ leadTimeDays: v })}
          placeholder="예: 7"
        />
        <NumberField
          label="MOQ"
          hint="비우면 미설정"
          value={form.moq}
          onChange={(v) => patch({ moq: v })}
          placeholder="예: 100"
        />
        <NumberField
          label="발주배수"
          hint="비우면 미설정"
          value={form.orderMultiple}
          onChange={(v) => patch({ orderMultiple: v })}
          placeholder="예: 50"
        />
      </div>

      <label className="flex items-center gap-2 text-[14px]">
        <Checkbox
          checked={form.isDefault}
          onCheckedChange={(c) => patch({ isDefault: c === true })}
        />
        기본 공급업체로 지정
        <span className="text-[13px] text-muted-foreground">(기존 기본 공급업체는 자동으로 해제됩니다)</span>
      </label>

      {error && <p className="text-[14px] text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="h-9 text-[14px]" onClick={onCancel} disabled={saving}>
          취소
        </Button>
        <Button size="sm" className="h-9 text-[14px]" onClick={onSave} disabled={saving}>
          {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          저장
        </Button>
      </div>
    </div>
  )
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[14px]">{label}</Label>
      <Input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        className="h-9 text-[14px]"
        onChange={(e) => onChange(e.target.value)}
      />
      <p className="text-[13px] text-muted-foreground">{hint}</p>
    </div>
  )
}

function SupplierCombobox({
  itemId,
  value,
  onChange,
}: {
  itemId: string
  value: SupplierCandidate | null
  onChange: (s: SupplierCandidate | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [options, setOptions] = useState<SupplierCandidate[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    const mySeq = ++seq.current
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await searchItemSupplierCandidates(itemId, query)
        if (mySeq !== seq.current) return
        if (res.success) {
          setOptions(res.data)
          setError(null)
        } else {
          setOptions([])
          setError(res.error)
        }
      } catch {
        if (mySeq === seq.current) {
          setOptions([])
          setError("공급업체를 불러오지 못했습니다.")
        }
      } finally {
        if (mySeq === seq.current) setLoading(false)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [open, query, itemId])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between text-[14px] font-normal"
        >
          <span className="min-w-0 truncate text-left">
            {value ? `[${value.code}] ${value.name}` : "공급업체 선택 (코드/이름 검색)"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-50 w-[max(var(--radix-popover-trigger-width),340px)] p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            placeholder="공급업체 코드 또는 이름 검색"
            className="h-9 text-[14px]"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div role="listbox" className="max-h-[280px] overflow-y-auto p-1">
          {loading && <p className="py-4 text-center text-[13px] text-muted-foreground">검색 중...</p>}
          {!loading && error && <p className="py-4 text-center text-[13px] text-destructive">{error}</p>}
          {!loading && !error && options.length === 0 && (
            <p className="px-3 py-4 text-center text-[13px] text-muted-foreground">
              선택할 수 있는 공급업체가 없습니다. 거래처 관리에서 공급업체 유형으로 등록되어 있는지 확인하세요.
            </p>
          )}
          {!loading &&
            options.map((o) => (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={value?.id === o.id}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[14px] outline-none hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onChange(o)
                  setOpen(false)
                  setQuery("")
                }}
              >
                <Check className={cn("h-4 w-4 shrink-0", value?.id === o.id ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-mono text-[13px] text-muted-foreground">{o.code}</span> {o.name}
                </span>
                <span className="shrink-0 text-[13px] text-muted-foreground">
                  {o.partnerType === "BOTH" ? "고객·공급" : "공급업체"}
                </span>
              </button>
            ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
