"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { QuantityInput } from "@/components/ui/quantity-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SearchableProjectOrderCombobox } from "./searchable-project-order-combobox"
import { formatAmountWithCurrency } from "@/lib/utils"
import {
  createProjectOrderPrice,
  updateProjectOrderPrice,
  getProjectOrdersAvailableForPricing,
  getProjectOrderPricingSuggestion,
  getQuotationCandidatesForProjectOrder,
  type ProjectOrderPriceDetail,
} from "@/lib/actions/project-order-price.actions"

interface ProjectPriceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  price?: ProjectOrderPriceDetail | null
  onSuccess: () => void
}

type ProjectOrderOption = { id: string; code: string; name: string; customer: { name: string }; item: { code: string; name: string } }
type QuotationOption = { id: string; quotationNo: string; currency: string; quotationDate: Date; unitPrice: number }
type OrderSuggestion = { orderNo: string; currency: string; orderDate: Date; unitPrice: number | null } | null

const NONE_VALUE = "__none__"

function fmtDate(d: Date | string | null): string {
  if (!d) return "—"
  return new Date(d).toISOString().split("T")[0]
}

// 코드리뷰 반영: 견적/수주단가의 정본은 항상 서버가 저장 시점에 DB에서 다시 읽는
// 값이다(project-order-price.actions.ts의 resolvePriceSnapshot). 아래 화면 값은
// 어디까지나 "저장하면 대략 이렇게 될 것"이라는 미리보기일 뿐, 실제로 client가
// 이 숫자를 그대로 보내 저장시키는 것이 아니다 — 견적 연결 시/수주 연결 시에는
// 입력칸 자체를 없애고 읽기 전용으로만 보여준다.
export function ProjectPriceFormDialog({ open, onOpenChange, mode, price, onSuccess }: ProjectPriceFormDialogProps) {
  const [isPending, setIsPending] = useState(false)
  const [isLoadingOptions, setIsLoadingOptions] = useState(false)

  const [projectOrderOptions, setProjectOrderOptions] = useState<ProjectOrderOption[]>([])
  const [quotationOptions, setQuotationOptions] = useState<QuotationOption[]>([])
  const [orderSuggestion, setOrderSuggestion] = useState<OrderSuggestion>(null)

  const [projectOrderId, setProjectOrderId] = useState("")
  const [quotationId, setQuotationId] = useState("")
  const [quantity, setQuantity] = useState<number | undefined>(undefined)
  const [manualQuotationUnitPrice, setManualQuotationUnitPrice] = useState<number | undefined>(undefined)
  const [manualQuotationDate, setManualQuotationDate] = useState("")
  const [currency, setCurrency] = useState("KRW")

  const isEditable = mode === "create" || price?.status === "DRAFT"
  const selectedQuotation = quotationOptions.find((q) => q.id === quotationId) ?? null
  // 통화는 견적/수주 어느 쪽이든 연결돼 있으면 서버가 그 값으로 덮어쓰므로, 입력칸은
  // 둘 다 없을 때만(=fallback 값으로만 쓰일 때만) 활성화한다.
  const currencyLockedBySource = Boolean(selectedQuotation) || Boolean(orderSuggestion)

  // ─── 프로젝트 선택지(등록 모드) 로딩 ────────────────────────────────────────
  useEffect(() => {
    if (!open || mode !== "create") return
    setIsLoadingOptions(true)
    getProjectOrdersAvailableForPricing()
      .then(setProjectOrderOptions)
      .catch((e) => alert(e instanceof Error ? e.message : "프로젝트 목록을 불러오지 못했습니다."))
      .finally(() => setIsLoadingOptions(false))
  }, [open, mode])

  // ─── 초기값 세팅 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    if (mode === "edit" && price) {
      setProjectOrderId(price.projectOrder.id)
      setQuotationId(price.quotation?.id ?? "")
      setQuantity(Number(price.quantity))
      setManualQuotationUnitPrice(!price.quotation && price.quotationUnitPrice != null ? Number(price.quotationUnitPrice) : undefined)
      setManualQuotationDate(!price.quotation && price.quotationDate ? fmtDate(price.quotationDate) : "")
      setCurrency(price.currency)
      setOrderSuggestion(
        price.salesOrder
          ? { orderNo: price.salesOrder.orderNo, currency: price.currency, orderDate: price.orderDate ?? price.createdAt, unitPrice: price.orderUnitPrice }
          : null
      )
      getQuotationCandidatesForProjectOrder(price.projectOrder.id)
        .then(setQuotationOptions)
        .catch(() => setQuotationOptions([]))
    } else {
      setProjectOrderId("")
      setQuotationId("")
      setQuantity(undefined)
      setManualQuotationUnitPrice(undefined)
      setManualQuotationDate("")
      setCurrency("KRW")
      setQuotationOptions([])
      setOrderSuggestion(null)
    }
  }, [open, mode, price])

  // ─── 프로젝트 선택 시 견적 후보/수주단가 제안 로딩(§5/§6) ────────────────────
  // 등록 편의를 위한 미리보기일 뿐이다 — 실제 저장값은 서버가 다시 계산한다.
  const handleProjectOrderChange = async (nextId: string) => {
    setProjectOrderId(nextId)
    setQuotationId("")
    setManualQuotationUnitPrice(undefined)
    setManualQuotationDate("")
    setQuantity(undefined)
    setOrderSuggestion(null)
    if (!nextId) {
      setQuotationOptions([])
      return
    }
    try {
      const suggestion = await getProjectOrderPricingSuggestion(nextId)
      setQuotationOptions(suggestion.quotationCandidates)
      if (suggestion.salesOrderSuggestion) {
        const so = suggestion.salesOrderSuggestion
        setOrderSuggestion({ orderNo: so.orderNo, currency: so.currency, orderDate: so.orderDate, unitPrice: so.unitPrice })
        setQuantity(so.qty > 0 ? so.qty : undefined)
        setCurrency(so.currency)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "제안 정보를 불러오지 못했습니다.")
    }
  }

  const handleQuotationChange = (nextId: string) => {
    const value = nextId === NONE_VALUE ? "" : nextId
    setQuotationId(value)
    if (!value) return
    const q = quotationOptions.find((opt) => opt.id === value)
    if (!q) return
    // §7: 견적을 연결하면 그 견적의 통화가 저장 시 정본이 된다 — 미리 반영해 보여준다.
    if (!orderSuggestion) setCurrency(q.currency)
  }

  const handleClose = () => onOpenChange(false)

  const handleSubmit = async () => {
    if (mode === "create" && !projectOrderId) {
      alert("프로젝트를 선택하세요.")
      return
    }
    if (quantity === undefined || quantity <= 0) {
      alert("수량을 올바르게 입력하세요.")
      return
    }
    const qty = quantity

    // 견적/수주 중 하나라도 연결돼 있으면 서버가 currency를 항상 그 source로
    // override하므로(생성 시 자동 결정, 수정 시 기존 값 고정) 그 상태에서는
    // currency를 아예 보내지 않는다. 견적/수주 둘 다 없는 순수 manual 상태일
    // 때만 의미가 있다 — 생성 시엔 fallback 값(currency)으로, 수정 시엔
    // manualCurrency로 명시 변경을 허용한다(서버가 이 값을 다른 상황에서는
    // 무시하므로 항상 보내도 안전하다).
    const resolvedManualQuotationUnitPrice = !quotationId && manualQuotationUnitPrice !== undefined ? manualQuotationUnitPrice : null
    const resolvedManualQuotationDate = !quotationId && manualQuotationDate ? new Date(manualQuotationDate) : null

    setIsPending(true)
    try {
      const result =
        mode === "create"
          ? await createProjectOrderPrice({
              projectOrderId,
              quotationId: quotationId || null,
              quantity: qty,
              manualQuotationUnitPrice: resolvedManualQuotationUnitPrice,
              manualQuotationDate: resolvedManualQuotationDate,
              currency: currency.trim() || "KRW",
            })
          : await updateProjectOrderPrice({
              id: price!.id,
              quotationId: quotationId || null,
              quantity: qty,
              manualQuotationUnitPrice: resolvedManualQuotationUnitPrice,
              manualQuotationDate: resolvedManualQuotationDate,
              manualCurrency: currencyLockedBySource ? undefined : currency.trim() || undefined,
            })

      if (!result.ok) {
        alert(result.error ?? "저장 중 오류가 발생했습니다.")
        return
      }
      onSuccess()
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[18px]">{mode === "create" ? "프로젝트 단가 등록" : "프로젝트 단가 수정"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-[14px]">프로젝트 {mode === "create" && <span className="text-red-500">*</span>}</Label>
            {mode === "edit" ? (
              <p className="text-[14px] font-medium rounded-md border px-3 py-2 bg-muted/30">
                [{price?.projectOrder.code}] {price?.projectOrder.name} · {price?.customer.name}
              </p>
            ) : (
              <SearchableProjectOrderCombobox
                projectOrders={projectOrderOptions}
                value={projectOrderId}
                onSelect={handleProjectOrderChange}
                disabled={isLoadingOptions}
                placeholder={isLoadingOptions ? "불러오는 중..." : "프로젝트를 선택하세요"}
              />
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[14px]">견적 연결 (선택)</Label>
            <Select value={quotationId || NONE_VALUE} onValueChange={handleQuotationChange} disabled={mode === "create" && !projectOrderId}>
              <SelectTrigger className="text-[14px]">
                <SelectValue placeholder="연결할 견적 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE} className="text-[14px]">연결 안 함 (직접 입력)</SelectItem>
                {quotationOptions.map((q) => (
                  <SelectItem key={q.id} value={q.id} className="text-[14px]">
                    [{q.quotationNo}] {formatAmountWithCurrency(q.unitPrice, q.currency, { maxDecimals: 2 })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[14px]">수량 <span className="text-red-500">*</span></Label>
              <QuantityInput
                maxDecimals={6}
                allowNegative={false}
                value={quantity}
                onChange={setQuantity}
                className="text-[14px]"
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[14px]">통화 {!currencyLockedBySource && <span className="text-red-500">*</span>}</Label>
              <Input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="text-[14px]"
                placeholder="KRW"
                disabled={currencyLockedBySource}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] text-muted-foreground">견적단가</Label>
              {quotationId ? (
                <p className="text-[14px] font-medium rounded-md border px-3 py-2 bg-muted/30 tabular-nums">
                  {selectedQuotation
                    ? formatAmountWithCurrency(selectedQuotation.unitPrice, selectedQuotation.currency, { maxDecimals: 2 })
                    : "—"}
                </p>
              ) : (
                <QuantityInput
                  maxDecimals={2}
                  allowNegative={false}
                  value={manualQuotationUnitPrice}
                  onChange={setManualQuotationUnitPrice}
                  className="text-[14px]"
                  placeholder="0 (직접 입력, 선택)"
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-muted-foreground">견적일</Label>
              {quotationId ? (
                <p className="text-[14px] font-medium rounded-md border px-3 py-2 bg-muted/30">
                  {selectedQuotation ? fmtDate(selectedQuotation.quotationDate) : "—"}
                </p>
              ) : (
                <Input type="date" value={manualQuotationDate} onChange={(e) => setManualQuotationDate(e.target.value)} className="text-[14px]" />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[12px] text-muted-foreground">수주단가 / 수주일 (연결된 수주가 있을 때만 자동 반영, 직접 입력 불가)</Label>
            <p className="text-[14px] font-medium rounded-md border px-3 py-2 bg-muted/30 tabular-nums">
              {orderSuggestion
                ? `[${orderSuggestion.orderNo}] ${orderSuggestion.unitPrice != null ? formatAmountWithCurrency(orderSuggestion.unitPrice, orderSuggestion.currency, { maxDecimals: 2 }) : "단가 미등록"} · ${fmtDate(orderSuggestion.orderDate)}`
                : "연결된 수주 없음"}
            </p>
          </div>

          <p className="text-[12px] text-muted-foreground">
            견적/수주를 연결하면 견적단가·수주단가·통화는 저장 시점에 서버가 원본 문서에서 직접 읽어 확정합니다(화면 표시는 미리보기).
            견적을 연결하지 않은 경우에만 견적단가를 직접 입력할 수 있고, 수주는 연결된 문서가 있을 때만 자동 반영되며 직접 입력할 수 없습니다.
            최종결정단가는 상세 화면에서 별도로 결정합니다.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>취소</Button>
          <Button onClick={handleSubmit} disabled={isPending || !isEditable}>
            {isPending ? "저장 중..." : mode === "create" ? "등록" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
