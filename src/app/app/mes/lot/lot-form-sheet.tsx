"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { Wand2 } from "lucide-react"

import { Form } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  FormSheet,
  FormTextField,
  FormSelectField,
  FormNumberField,
  FormDateField,
} from "@/components/common/form-sheet"
import { lotFormSchema, LotFormValues } from "./lot-form-schema"
import { createLot, generateLotNo } from "@/lib/actions/lot.actions"
import { getRuleContextTokens, generateNumber, getContextCodeOptions } from "@/lib/actions/numbering-rule.actions"
import type { ContextKey } from "@/lib/types/numbering-rule"
import { CONTEXT_KEY_LABELS } from "@/lib/types/numbering-rule"

// ─── Types ────────────────────────────────────────────────────────────────────

interface LotFormSheetProps {
  items: { id: string; code: string; name: string; itemType: string; uom: string }[]
  tenantId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ContextStep = {
  tokens: Array<{
    key: ContextKey
    fallback?: string
    autoValue?: string
    codeOptions?: { code: string; name: string }[]
  }>
  values: Record<string, string>
}

const ITEM_TYPE_LABELS: Record<string, string> = {
  RAW_MATERIAL:  "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED:      "완제품",
  CONSUMABLE:    "소모품",
}

const DEFAULT_VALUES: LotFormValues = {
  itemId: "",
  lotNo: "",
  qty: 1,
  manufactureDate: null,
  expiryDate: null,
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LotFormSheet({
  items,
  tenantId,
  open,
  onOpenChange,
}: LotFormSheetProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [contextStep, setContextStep] = useState<ContextStep | null>(null)
  const router = useRouter()

  const form = useForm<LotFormValues>({
    resolver: zodResolver(lotFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (open) {
      form.reset(DEFAULT_VALUES)
      setContextStep(null)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 자동 번호 생성 ──────────────────────────────────────────────────────────

  const handleAutoGenerate = async () => {
    const itemId = form.getValues("itemId")
    if (!itemId) {
      alert("품목을 먼저 선택하세요.")
      return
    }

    setIsGenerating(true)
    try {
      const selectedItem = items.find((i) => i.id === itemId)
      const autoContext: Partial<Record<ContextKey, string>> = {}
      if (selectedItem?.code) autoContext.ITEM_CODE = selectedItem.code
      if (selectedItem?.itemType) autoContext.ITEM_TYPE = selectedItem.itemType

      const [contextTokens, codeOptionsMap] = await Promise.all([
        getRuleContextTokens(tenantId, "LOT"),
        getContextCodeOptions(tenantId, "LOT"),
      ])

      if (contextTokens.length > 0) {
        // 컨텍스트 토큰이 있으면 입력 단계 표시
        const tokensWithAuto = contextTokens.map((t) => ({
          ...t,
          autoValue: autoContext[t.key],
          codeOptions: codeOptionsMap[t.key],
        }))
        const initialValues: Record<string, string> = {}
        for (const t of tokensWithAuto) {
          // 드롭다운 옵션이 있으면 첫 번째 값을 기본값으로
          if (t.codeOptions?.length) {
            initialValues[t.key] = t.autoValue ?? ""
          } else {
            initialValues[t.key] = t.autoValue ?? t.fallback ?? ""
          }
        }
        setContextStep({ tokens: tokensWithAuto, values: initialValues })
      } else {
        // 컨텍스트 토큰 없으면 바로 생성
        const lotNo = await generateNumber(tenantId, "LOT", autoContext)
        form.setValue("lotNo", lotNo, { shouldValidate: true })
      }
    } catch {
      alert("LOT번호 생성에 실패했습니다.")
    } finally {
      setIsGenerating(false)
    }
  }

  // ─── 컨텍스트 확인 후 번호 생성 ──────────────────────────────────────────────

  const handleContextGenerate = async () => {
    if (!contextStep) return

    // 빈값 확인
    const emptyKeys = contextStep.tokens.filter(
      (t) => !contextStep.values[t.key]?.trim()
    )
    if (emptyKeys.length > 0) {
      const labels = emptyKeys.map((t) => CONTEXT_KEY_LABELS[t.key]).join(", ")
      const ok = confirm(`${labels} 값이 비어있습니다. 빈값으로 진행하시겠습니까?`)
      if (!ok) return
    }

    // 영문/숫자 검증
    for (const t of contextStep.tokens) {
      const val = contextStep.values[t.key] ?? ""
      if (val && !/^[a-zA-Z0-9-]*$/.test(val)) {
        alert(`${CONTEXT_KEY_LABELS[t.key]}는 영문/숫자/하이픈(-)만 입력 가능합니다.`)
        return
      }
    }

    setIsGenerating(true)
    try {
      const context: Partial<Record<ContextKey, string>> = {}
      for (const [key, val] of Object.entries(contextStep.values)) {
        if (val.trim()) context[key as ContextKey] = val.trim()
      }
      const lotNo = await generateNumber(tenantId, "LOT", context)
      form.setValue("lotNo", lotNo, { shouldValidate: true })
      setContextStep(null)
    } catch {
      alert("LOT번호 생성에 실패했습니다.")
    } finally {
      setIsGenerating(false)
    }
  }

  // ─── 저장 ────────────────────────────────────────────────────────────────────

  async function onSubmit(values: LotFormValues) {
    setIsLoading(true)
    try {
      await createLot(
        {
          itemId: values.itemId,
          lotNo: values.lotNo,
          qty: values.qty,
          manufactureDate: values.manufactureDate ?? null,
          expiryDate: values.expiryDate ?? null,
        },
        tenantId
      )
      onOpenChange(false)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      mode="create"
      title="LOT 등록"
      description="새로운 LOT를 등록합니다."
      isLoading={isLoading}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <Form {...form}>
        <div className="space-y-6">
          <div className="space-y-4">
            <p className="text-[15px] font-medium text-foreground">기본 정보</p>

            {/* 품목 */}
            <FormSelectField
              control={form.control}
              name="itemId"
              label="품목"
              placeholder="품목 선택"
              options={items.map((item) => ({
                label: `[${item.code}] ${item.name} (${ITEM_TYPE_LABELS[item.itemType] ?? item.itemType})`,
                value: item.id,
              }))}
            />

            {/* LOT번호 + 자동생성 버튼 */}
            <div className="space-y-2">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <FormTextField
                    control={form.control}
                    name="lotNo"
                    label="LOT번호"
                    placeholder="LOT-20260327-001"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 px-3 text-[13px] shrink-0"
                  onClick={handleAutoGenerate}
                  disabled={isGenerating}
                >
                  <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                  {isGenerating ? "생성 중..." : "자동생성"}
                </Button>
              </div>

              {/* 컨텍스트 입력 섹션 */}
              {contextStep && (
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 space-y-2">
                  <p className="text-[13px] text-muted-foreground font-medium">변수 값 입력</p>
                  <div className="space-y-2">
                    {contextStep.tokens.map((t) => (
                      <div key={t.key} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <label className="text-[13px] text-foreground font-medium">
                            {CONTEXT_KEY_LABELS[t.key]}
                          </label>
                          {t.autoValue && (
                            <span className="text-[11px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium">
                              자동
                            </span>
                          )}
                        </div>
                        {t.codeOptions && t.codeOptions.length > 0 ? (
                          <select
                            value={contextStep.values[t.key] ?? ""}
                            onChange={(e) =>
                              setContextStep((prev) =>
                                prev ? { ...prev, values: { ...prev.values, [t.key]: e.target.value } } : null
                              )
                            }
                            className="w-full h-8 text-[13px] px-2 border border-amber-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-amber-300"
                          >
                            <option value="">선택하세요</option>
                            {t.codeOptions.map((opt) => (
                              <option key={opt.code} value={opt.code}>
                                {opt.name} ({opt.code})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Input
                            value={contextStep.values[t.key] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^A-Za-z0-9-]/g, "")
                              setContextStep((prev) =>
                                prev ? { ...prev, values: { ...prev.values, [t.key]: val } } : null
                              )
                            }}
                            placeholder="영문/숫자/하이픈 입력"
                            className="h-8 text-[13px] border-amber-200 bg-white"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 px-3 text-[13px]"
                      onClick={handleContextGenerate}
                      disabled={isGenerating}
                    >
                      {isGenerating ? "생성 중..." : "생성"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-3 text-[13px]"
                      onClick={() => setContextStep(null)}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 수량 */}
            <FormNumberField
              control={form.control}
              name="qty"
              label="수량"
              placeholder="0"
              min={0.001}
              step={1}
            />
          </div>

          <div className="pt-4 border-t space-y-4">
            <p className="text-[15px] font-medium text-foreground">날짜 정보 (선택)</p>

            <div className="grid grid-cols-2 gap-4">
              <FormDateField
                control={form.control}
                name="manufactureDate"
                label="제조일"
              />
              <FormDateField
                control={form.control}
                name="expiryDate"
                label="유효기한"
              />
            </div>
          </div>
        </div>
      </Form>
    </FormSheet>
  )
}
