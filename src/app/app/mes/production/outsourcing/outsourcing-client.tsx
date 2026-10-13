"use client"

import { useState, useTransition, useMemo } from "react"
import { useRouter, usePathname } from "next/navigation"
import {
  Truck,
  PackagePlus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  PackageCheck,
  ClipboardCheck,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/common/data-table"
import { ColumnDef } from "@tanstack/react-table"
import type {
  OutsourcingData,
  OutsourcingOrderRow,
  OutsourcingWipUnitRow,
  OutsourcingAvailableWipUnitRow,
  OutsourcingWipReceivingRow,
} from "@/lib/actions/outsourcing.actions"
import {
  createOutsourcingOrder,
  issueWipUnitToOutsourcing,
  receiveWipUnitFromOutsourcing,
  inspectOutsourcedWipUnit,
} from "@/lib/actions/outsourcing.actions"
import { PurchaseOrderStatus } from "@prisma/client"
import { formatQuantity } from "@/lib/utils"

// ─── WipUnit status display ───────────────────────────────────────────────────

const WIP_STATUS_LABEL: Record<"OUTSOURCED" | "RECEIVED", string> = {
  OUTSOURCED: "외주진행중",
  RECEIVED: "입고검사대기",
}

const WIP_STATUS_STYLE: Record<"OUTSOURCED" | "RECEIVED", string> = {
  OUTSOURCED: "bg-cyan-100 text-cyan-700 border-0",
  RECEIVED: "bg-violet-100 text-violet-700 border-0",
}

// ─── Status labels ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  DRAFT: "초안",
  ORDERED: "발주완료",
  PARTIAL_RECEIVED: "부분입고",
  RECEIVED: "입고완료",
  CLOSED: "마감",
  CANCELLED: "취소",
}

const STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600 border-0",
  ORDERED: "bg-blue-100 text-blue-700 border-0",
  PARTIAL_RECEIVED: "bg-amber-100 text-amber-700 border-0",
  RECEIVED: "bg-emerald-100 text-emerald-700 border-0",
  CLOSED: "bg-slate-100 text-slate-500 border-0",
  CANCELLED: "bg-red-100 text-red-500 border-0",
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function extractProcessName(note: string | null): string {
  if (!note) return "-"
  const match = note.match(/\[OUTSOURCING\] ([^\n]+)/)
  return match ? match[1].trim() : "-"
}

// ─── CreateOrderDialog ────────────────────────────────────────────────────────

interface CreateOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  partners: { id: string; name: string }[]
  recentProcessNames: string[]
}

function CreateOrderDialog({
  open,
  onOpenChange,
  partners,
  recentProcessNames,
}: CreateOrderDialogProps) {
  const [supplierId, setSupplierId] = useState("")
  const [processName, setProcessName] = useState("")
  const [expectedDate, setExpectedDate] = useState("")
  const [note, setNote] = useState("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function resetForm() {
    setSupplierId("")
    setProcessName("")
    setExpectedDate("")
    setNote("")
  }

  function handleClose() {
    resetForm()
    onOpenChange(false)
  }

  function handleSubmit() {
    const trimmed = processName.trim()
    if (!supplierId) {
      alert("외주처를 선택해주세요.")
      return
    }
    if (!trimmed) {
      alert("외주공정명을 입력해주세요.")
      return
    }

    startTransition(async () => {
      try {
        await createOutsourcingOrder({
          supplierId,
          outsourcingProcessName: trimmed,
          expectedDate: expectedDate || undefined,
          note: note.trim() || undefined,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        alert(e instanceof Error ? e.message : "등록 중 오류가 발생했습니다.")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[18px]">외주발주 등록</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-[13px]">
              외주처 <span className="text-red-500">*</span>
            </Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="text-[14px] h-9">
                <SelectValue placeholder="외주처 선택" />
              </SelectTrigger>
              <SelectContent>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-[14px]">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="outsourcing-process-name" className="text-[13px]">
              외주공정명 <span className="text-red-500">*</span>
            </Label>
            <Input
              id="outsourcing-process-name"
              list="outsourcing-process-datalist"
              value={processName}
              onChange={(e) => setProcessName(e.target.value)}
              placeholder="예) 발색, 착색, 와이어, 표면처리, 열처리, 세척, 자동화공정 등"
              className="text-[14px] h-9"
            />
            {recentProcessNames.length > 0 && (
              <datalist id="outsourcing-process-datalist">
                {recentProcessNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">납기일</Label>
            <Input
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              className="text-[14px] h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">비고</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="추가 메모 (선택사항)"
              className="text-[14px] resize-none"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !supplierId || !processName.trim()}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                등록 중...
              </>
            ) : (
              "등록"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── IssueWipDialog ────────────────────────────────────────────────────────────

interface IssueWipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  order: OutsourcingOrderRow | null
  availableWipUnits: OutsourcingAvailableWipUnitRow[]
}

function IssueWipDialog({
  open,
  onOpenChange,
  order,
  availableWipUnits,
}: IssueWipDialogProps) {
  const [selectedWipId, setSelectedWipId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const filtered = useMemo(() => {
    if (!search.trim()) return availableWipUnits
    const s = search.toLowerCase()
    return availableWipUnits.filter(
      (w) =>
        w.mfgNo.toLowerCase().includes(s) ||
        w.itemName.toLowerCase().includes(s) ||
        w.itemCode.toLowerCase().includes(s) ||
        w.workOrderNo.toLowerCase().includes(s)
    )
  }, [availableWipUnits, search])

  function handleClose() {
    setSelectedWipId(null)
    setSearch("")
    onOpenChange(false)
  }

  function handleSubmit() {
    if (!selectedWipId || !order) return
    startTransition(async () => {
      try {
        await issueWipUnitToOutsourcing({
          wipUnitId: selectedWipId,
          outsourcingOrderId: order.id,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        alert(e instanceof Error ? e.message : "출고 처리 중 오류가 발생했습니다.")
      }
    })
  }

  if (!order) return null

  const processName = extractProcessName(order.note)

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[18px]">외주출고 처리</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="text-[12px] text-muted-foreground mb-0.5">발주번호</p>
              <p className="text-[14px] font-mono font-medium">{order.orderNo}</p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground mb-0.5">외주처</p>
              <p className="text-[14px] font-medium">{order.supplierName}</p>
            </div>
            <div>
              <p className="text-[12px] text-muted-foreground mb-0.5">외주공정</p>
              <p className="text-[14px] font-medium">{processName}</p>
            </div>
            {order.workOrderNo && (
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">연결 작업지시</p>
                <p className="text-[14px] font-mono font-medium">{order.workOrderNo}</p>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[14px] font-medium">출고할 재공 선택</p>
            <Input
              placeholder="제조번호 · 품목 · 작업지시로 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 h-8 text-[13px]"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="py-10 text-center text-[14px] text-muted-foreground border rounded-lg">
              {availableWipUnits.length === 0
                ? "출고 가능한 재공이 없습니다."
                : "검색 조건에 맞는 재공이 없습니다."}
            </div>
          ) : (
            <div className="rounded-lg border max-h-64 overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-muted/40 border-b">
                    <th className="w-8 px-3 py-2.5" />
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">제조번호</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">품목</th>
                    <th className="text-right px-3 py-2.5 font-medium text-muted-foreground">수량</th>
                    <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">작업지시</th>
                    <th className="text-center px-3 py-2.5 font-medium text-muted-foreground">공정순서</th>
                    <th className="text-center px-3 py-2.5 font-medium text-muted-foreground">구분</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((w) => (
                    <tr
                      key={w.id}
                      className={`border-b cursor-pointer last:border-0 transition-colors ${
                        selectedWipId === w.id
                          ? "bg-blue-50 hover:bg-blue-50"
                          : w.wipStatus === "REWORK"
                            ? "bg-amber-50/40 hover:bg-amber-50/60"
                            : "hover:bg-muted/30"
                      }`}
                      onClick={() => setSelectedWipId(w.id)}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="radio"
                          readOnly
                          checked={selectedWipId === w.id}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{w.mfgNo}</td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium">{w.itemName}</p>
                        <p className="text-[12px] text-muted-foreground">{w.itemCode}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium">
                        {formatQuantity(w.qty)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{w.workOrderNo}</td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground">
                        {w.operationSeq}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {w.wipStatus === "REWORK" && (
                          <Badge className="text-[11px] bg-amber-100 text-amber-700 border-0">재외주 대상</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={!selectedWipId || isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                처리 중...
              </>
            ) : (
              <>
                <ArrowUpRight className="h-4 w-4 mr-1.5" />
                출고 처리
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── ReceiveWipDialog ──────────────────────────────────────────────────────────

interface ReceiveWipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  wipUnit: OutsourcingWipUnitRow | null
}

function ReceiveWipDialog({ open, onOpenChange, wipUnit }: ReceiveWipDialogProps) {
  const [note, setNote] = useState("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClose() {
    setNote("")
    onOpenChange(false)
  }

  function handleSubmit() {
    if (!wipUnit) return
    startTransition(async () => {
      try {
        await receiveWipUnitFromOutsourcing({
          wipUnitId: wipUnit.id,
          note: note.trim() || undefined,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        alert(e instanceof Error ? e.message : "입고 처리 중 오류가 발생했습니다.")
      }
    })
  }

  if (!wipUnit) return null

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[18px]">외주입고 처리</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">제조번호</p>
                <p className="text-[14px] font-mono font-medium">{wipUnit.mfgNo}</p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">수량</p>
                <p className="text-[14px] font-medium">
                  {formatQuantity(wipUnit.qty)}
                </p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">품목</p>
                <p className="text-[14px] font-medium">{wipUnit.itemName}</p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">외주처</p>
                <p className="text-[14px] font-medium">{wipUnit.partnerName}</p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-[13px]">비고 (선택)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="입고 관련 메모 (선택사항)"
              className="text-[14px] resize-none"
              rows={3}
            />
          </div>

          <p className="text-[13px] text-muted-foreground rounded-md bg-blue-50 px-3 py-2">
            입고 처리 시 재공 상태가 <strong>IN_PROCESS</strong>로 복귀됩니다.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                처리 중...
              </>
            ) : (
              <>
                <ArrowDownLeft className="h-4 w-4 mr-1.5" />
                입고 처리
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── InspectWipDialog ─────────────────────────────────────────────────────────

interface InspectWipDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  wipUnit: OutsourcingWipUnitRow | null
}

function InspectWipDialog({ open, onOpenChange, wipUnit }: InspectWipDialogProps) {
  const [acceptedQty, setAcceptedQty] = useState("")
  const [defectQty, setDefectQty] = useState("")
  const [reworkQty, setReworkQty] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState("")
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClose() {
    setAcceptedQty("")
    setDefectQty("")
    setReworkQty("")
    setNote("")
    setError("")
    onOpenChange(false)
  }

  function handleAllAccept() {
    if (!wipUnit) return
    setAcceptedQty(String(wipUnit.qty))
    setDefectQty("0")
    setReworkQty("0")
    setError("")
  }

  const parsedAccepted = Number(acceptedQty) || 0
  const parsedDefect = Number(defectQty) || 0
  const parsedRework = Number(reworkQty) || 0
  const totalInput = parsedAccepted + parsedDefect + parsedRework
  const wipQty = wipUnit?.qty ?? 0
  const isQtyMatch = Math.abs(totalInput - wipQty) < 0.000001
  const isAllZero = totalInput === 0
  const hasNegative = parsedAccepted < 0 || parsedDefect < 0 || parsedRework < 0
  const canSubmit = isQtyMatch && !isAllZero && !hasNegative && !isPending

  function handleSubmit() {
    if (!wipUnit) return
    if (!isQtyMatch) {
      setError(`합계(${formatQuantity(totalInput)})가 재공 수량(${formatQuantity(wipQty)})과 일치해야 합니다.`)
      return
    }
    setError("")
    startTransition(async () => {
      try {
        await inspectOutsourcedWipUnit({
          wipUnitId: wipUnit.id,
          acceptedQty: parsedAccepted,
          defectQty: parsedDefect,
          reworkQty: parsedRework,
          note: note.trim() || undefined,
        })
        router.refresh()
        handleClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : "검사처리 중 오류가 발생했습니다.")
      }
    })
  }

  if (!wipUnit) return null

  const qtyDiff = totalInput - wipQty

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[18px]">외주입고 검사처리</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* WipUnit 정보 */}
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">제조번호</p>
                <p className="text-[14px] font-mono font-medium">{wipUnit.mfgNo}</p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">입고검사대기 수량</p>
                <p className="text-[14px] font-medium text-violet-700">
                  {formatQuantity(wipQty)}
                </p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">품목</p>
                <p className="text-[14px] font-medium">{wipUnit.itemName}</p>
                <p className="text-[12px] text-muted-foreground">{wipUnit.itemCode}</p>
              </div>
              <div>
                <p className="text-[12px] text-muted-foreground mb-0.5">공정</p>
                <p className="text-[14px]">{wipUnit.processName}</p>
              </div>
            </div>
          </div>

          {/* 안내 */}
          <p className="text-[13px] text-muted-foreground rounded-md bg-blue-50 px-3 py-2">
            합격, 불량, 재외주 수량의 합계는 입고검사대기 수량과 같아야 합니다.
          </p>

          {/* 전량 합격 빠른 선택 */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-[13px] h-8 w-full border-emerald-200 text-emerald-700 hover:bg-emerald-50"
            onClick={handleAllAccept}
            disabled={isPending}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
            전량 합격 ({formatQuantity(wipQty)})
          </Button>

          {/* 수량 입력 */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[13px] text-emerald-700">합격 수량</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={acceptedQty}
                onChange={(e) => { setAcceptedQty(e.target.value); setError("") }}
                className="text-[14px]"
                placeholder="0"
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] text-red-600">불량 수량</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={defectQty}
                onChange={(e) => { setDefectQty(e.target.value); setError("") }}
                className="text-[14px]"
                placeholder="0"
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] text-amber-600">재외주 수량</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={reworkQty}
                onChange={(e) => { setReworkQty(e.target.value); setError("") }}
                className="text-[14px]"
                placeholder="0"
                disabled={isPending}
              />
            </div>
          </div>

          {/* 합계 표시 */}
          <div className={`flex items-center justify-between rounded-md px-3 py-2 text-[13px] ${
            totalInput === 0
              ? "bg-muted/50 text-muted-foreground"
              : isQtyMatch
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-600"
          }`}>
            <span>합계</span>
            <span className="font-medium tabular-nums">
              {formatQuantity(totalInput)} / {formatQuantity(wipQty)}
              {totalInput > 0 && !isQtyMatch && (
                <span className="ml-1">
                  ({qtyDiff > 0 ? "+" : ""}{formatQuantity(qtyDiff)})
                </span>
              )}
            </span>
          </div>

          {/* 재외주 안내 */}
          {parsedRework > 0 && (
            <p className="text-[13px] text-muted-foreground rounded-md bg-amber-50 px-3 py-2">
              재외주 수량은 REWORK 재공으로 분리되며, 외주출고 처리 시 재외주 대상으로 표시됩니다.
            </p>
          )}

          {/* 비고 */}
          <div className="space-y-1.5">
            <Label className="text-[13px]">비고 (선택)</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="검사 관련 메모 (선택사항)"
              className="text-[14px] resize-none"
              rows={2}
              disabled={isPending}
            />
          </div>

          {/* 오류 */}
          {error && (
            <p className="text-[13px] text-red-600 rounded-md bg-red-50 px-3 py-2">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isPending}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                처리 중...
              </>
            ) : (
              <>
                <ClipboardCheck className="h-4 w-4 mr-1.5" />
                검사처리
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <div className="py-14 text-center text-muted-foreground">
      {icon ?? <Truck className="mx-auto h-10 w-10 mb-3 opacity-25" />}
      <p className="text-[15px]">{label}</p>
      <p className="text-[13px] mt-1 opacity-70">필터 조건을 변경하거나 초기화해 보세요.</p>
    </div>
  )
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: number
}) {
  return (
    <div className="rounded-lg border bg-card p-4 flex items-center gap-3">
      <div className={`p-2 ${iconBg} rounded-lg shrink-0`}>{icon}</div>
      <div>
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className="text-[22px] font-semibold">{value}</p>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  data: OutsourcingData
}

export function OutsourcingClient({ data }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [, startTransition] = useTransition()

  // Filter state
  const [from, setFrom] = useState(data.filter.from ?? "")
  const [to, setTo] = useState(data.filter.to ?? "")
  const [supplierId, setSupplierId] = useState(data.filter.supplierId ?? "__all__")
  const [filterStatus, setFilterStatus] = useState(data.filter.status ?? "__all__")

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [issueOrder, setIssueOrder] = useState<OutsourcingOrderRow | null>(null)
  const [receiveWip, setReceiveWip] = useState<OutsourcingWipUnitRow | null>(null)
  const [inspectWip, setInspectWip] = useState<OutsourcingWipUnitRow | null>(null)

  function handleApply() {
    const params = new URLSearchParams()
    if (from) params.set("from", from)
    if (to) params.set("to", to)
    if (supplierId && supplierId !== "__all__") params.set("supplierId", supplierId)
    if (filterStatus && filterStatus !== "__all__") params.set("status", filterStatus)
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  function handleReset() {
    setFrom("")
    setTo("")
    setSupplierId("__all__")
    setFilterStatus("__all__")
    startTransition(() => router.push(pathname))
  }

  const { summary, orders, wipUnits, wipReceivingHistory, availableWipUnits, partners, recentProcessNames } = data

  // Memoized column definitions (need callbacks for action buttons)
  const orderColumns = useMemo<ColumnDef<OutsourcingOrderRow>[]>(
    () => [
      {
        accessorKey: "orderNo",
        header: "발주번호",
        cell: ({ row }) => (
          <span className="font-mono text-[13px] font-medium">{row.original.orderNo}</span>
        ),
      },
      {
        accessorKey: "supplierName",
        header: "공급처",
        cell: ({ row }) => <span className="text-[14px]">{row.original.supplierName}</span>,
      },
      {
        id: "processName",
        header: "외주공정",
        cell: ({ row }) => (
          <div className="min-w-[160px]">
            <p className="text-[14px] font-medium">{row.original.operationName ?? extractProcessName(row.original.note)}</p>
            {row.original.workOrderNo && (
              <p className="text-[13px] font-mono text-muted-foreground">
                {row.original.workOrderNo}
                {row.original.operationSeq != null ? ` · ${row.original.operationSeq}공정` : ""}
              </p>
            )}
          </div>
        ),
      },
      {
        accessorKey: "orderDate",
        header: "발주/납기",
        cell: ({ row }) => (
          <div className="min-w-[120px] space-y-0.5">
            <p className="text-[13px] text-muted-foreground">
              발주 {new Date(row.original.orderDate).toLocaleDateString("ko-KR")}
            </p>
            <p
              className={`text-[13px] ${
                row.original.isOverdue ? "text-red-600 font-medium" : "text-muted-foreground"
              }`}
            >
              납기 {new Date(row.original.expectedDate).toLocaleDateString("ko-KR")}
              {row.original.isOverdue && " ⚠ 지연"}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "totalQty",
        header: "수량",
        cell: ({ row }) => (
          <span className="text-[14px] font-medium">
            {formatQuantity(row.original.totalQty)}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "상태",
        cell: ({ row }) => {
          const s = row.original.status
          return (
            <Badge className={`text-[13px] ${STATUS_STYLE[s]}`}>
              {STATUS_LABEL[s]}
            </Badge>
          )
        },
        filterFn: (row, _id, filterValues: string[]) =>
          filterValues.includes(row.original.status),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const s = row.original.status
          const canIssue = s === "ORDERED" || s === "DRAFT"
          if (!canIssue) return null
          return (
            <Button
              size="sm"
              variant="outline"
              className="text-[13px] h-8 whitespace-nowrap"
              onClick={() => setIssueOrder(row.original)}
            >
              <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
              출고처리
            </Button>
          )
        },
      },
    ],
    []
  )

  const wipUnitColumns = useMemo<ColumnDef<OutsourcingWipUnitRow>[]>(
    () => [
      {
        accessorKey: "mfgNo",
        header: "제조번호",
        cell: ({ row }) => (
          <span className="font-mono text-[13px] text-muted-foreground">{row.original.mfgNo}</span>
        ),
      },
      {
        accessorKey: "itemName",
        header: "품목",
        cell: ({ row }) => (
          <div>
            <p className="text-[14px] font-medium">{row.original.itemName}</p>
            <p className="text-[12px] text-muted-foreground">{row.original.itemCode}</p>
          </div>
        ),
      },
      {
        accessorKey: "qty",
        header: "수량",
        cell: ({ row }) => (
          <span className="text-[14px] font-medium">
            {formatQuantity(row.original.qty)}
          </span>
        ),
      },
      {
        accessorKey: "partnerName",
        header: "외주처",
        cell: ({ row }) => <span className="text-[14px]">{row.original.partnerName}</span>,
      },
      {
        accessorKey: "outsourcingOrderNo",
        header: "발주번호",
        cell: ({ row }) => (
          <span className="font-mono text-[13px] text-muted-foreground">
            {row.original.outsourcingOrderNo ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "processName",
        header: "공정",
        cell: ({ row }) => (
          <span className="text-[13px] text-muted-foreground">{row.original.processName}</span>
        ),
      },
      {
        id: "wipStatus",
        header: "상태",
        cell: ({ row }) => {
          const s = row.original.wipStatus
          return (
            <Badge className={`text-[13px] font-medium ${WIP_STATUS_STYLE[s]}`}>
              {WIP_STATUS_LABEL[s]}
            </Badge>
          )
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          if (row.original.wipStatus === "RECEIVED") {
            return (
              <Button
                size="sm"
                variant="outline"
                className="text-[13px] h-8 whitespace-nowrap border-violet-200 text-violet-700 hover:bg-violet-50"
                onClick={() => setInspectWip(row.original)}
              >
                <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                검사처리
              </Button>
            )
          }
          return (
            <Button
              size="sm"
              variant="outline"
              className="text-[13px] h-8 whitespace-nowrap"
              onClick={() => setReceiveWip(row.original)}
            >
              <ArrowDownLeft className="h-3.5 w-3.5 mr-1" />
              입고처리
            </Button>
          )
        },
      },
    ],
    []
  )

  const wipReceivingColumns = useMemo<ColumnDef<OutsourcingWipReceivingRow>[]>(
    () => [
      {
        accessorKey: "createdAt",
        header: "처리일시",
        cell: ({ row }) => (
          <span className="text-[13px] font-mono text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleDateString("ko-KR")}
          </span>
        ),
      },
      {
        accessorKey: "mfgNo",
        header: "제조번호",
        cell: ({ row }) => (
          <div>
            <p className="font-mono text-[13px]">{row.original.mfgNo}</p>
            {row.original.workOrderNo && (
              <p className="font-mono text-[12px] text-muted-foreground">{row.original.workOrderNo}</p>
            )}
          </div>
        ),
      },
      {
        accessorKey: "outsourcingOrderNo",
        header: "발주번호",
        cell: ({ row }) => (
          <span className="font-mono text-[13px] text-muted-foreground">
            {row.original.outsourcingOrderNo ?? "-"}
          </span>
        ),
      },
      {
        accessorKey: "itemName",
        header: "품목",
        cell: ({ row }) => (
          <div>
            <p className="text-[14px]">{row.original.itemName}</p>
            <p className="text-[12px] text-muted-foreground">{row.original.itemCode}</p>
          </div>
        ),
      },
      {
        accessorKey: "qty",
        header: "수량",
        cell: ({ row }) => (
          <span className="text-[14px] font-medium">
            {formatQuantity(row.original.qty)}
          </span>
        ),
      },
      {
        accessorKey: "partnerName",
        header: "외주처",
        cell: ({ row }) => <span className="text-[14px]">{row.original.partnerName}</span>,
      },
      {
        accessorKey: "note",
        header: "비고",
        cell: ({ row }) => (
          <span className="text-[13px] text-muted-foreground line-clamp-1">
            {row.original.note || "-"}
          </span>
        ),
      },
    ],
    []
  )

  return (
    <>
      {/* Dialogs */}
      <CreateOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        partners={partners}
        recentProcessNames={recentProcessNames}
      />
      <IssueWipDialog
        open={issueOrder !== null}
        onOpenChange={(v) => { if (!v) setIssueOrder(null) }}
        order={issueOrder}
        availableWipUnits={availableWipUnits}
      />
      <ReceiveWipDialog
        open={receiveWip !== null}
        onOpenChange={(v) => { if (!v) setReceiveWip(null) }}
        wipUnit={receiveWip}
      />
      <InspectWipDialog
        open={inspectWip !== null}
        onOpenChange={(v) => { if (!v) setInspectWip(null) }}
        wipUnit={inspectWip}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <SummaryCard
          icon={<Truck className="h-5 w-5 text-blue-600" />}
          iconBg="bg-blue-50"
          label="전체 발주"
          value={summary.totalOrders}
        />
        <SummaryCard
          icon={<Clock className="h-5 w-5 text-slate-500" />}
          iconBg="bg-slate-50"
          label="발주/대기"
          value={summary.pendingOrders}
        />
        <SummaryCard
          icon={<PackagePlus className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-50"
          label="부분입고"
          value={summary.partialReceived}
        />
        <SummaryCard
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          iconBg="bg-emerald-50"
          label="입고완료"
          value={summary.completed}
        />
        <SummaryCard
          icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
          iconBg="bg-red-50"
          label="납기지연"
          value={summary.overdue}
        />
      </div>

      {/* Filter */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label className="text-[13px]">시작일</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="text-[14px] h-9 w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">종료일</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="text-[14px] h-9 w-40"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">공급처</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="text-[14px] h-9 w-48">
                <SelectValue placeholder="전체 공급처" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-[14px]">전체 공급처</SelectItem>
                {partners.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-[14px]">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[13px]">상태</Label>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="text-[14px] h-9 w-40">
                <SelectValue placeholder="전체" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__" className="text-[14px]">전체</SelectItem>
                {Object.entries(STATUS_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v} className="text-[14px]">
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleApply} className="h-9">조회</Button>
            <Button size="sm" variant="outline" onClick={handleReset} className="h-9">초기화</Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-lg border bg-card">
        <Tabs defaultValue="orders">
          <div className="px-4 pt-4 border-b flex items-center justify-between">
            <TabsList className="h-9">
              <TabsTrigger value="orders" className="text-[13px]">
                외주발주 현황
                <span className="ml-1.5 text-[11px] opacity-70">({orders.length})</span>
              </TabsTrigger>
              <TabsTrigger value="wip" className="text-[13px]">
                외주 진행 재공
                <span className="ml-1.5 text-[11px] opacity-70">({wipUnits.length})</span>
              </TabsTrigger>
              <TabsTrigger value="history" className="text-[13px]">
                외주 입고 이력
                <span className="ml-1.5 text-[11px] opacity-70">({wipReceivingHistory.length})</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Tab 1: 외주발주 현황 */}
          <TabsContent value="orders" className="p-0">
            <div className="px-4 py-3 border-b flex justify-end">
              <Button
                size="sm"
                className="h-9 text-[13px]"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                외주발주 등록
              </Button>
            </div>
            {orders.length === 0 ? (
              <EmptyState label="발주 데이터가 없습니다." />
            ) : (
              <DataTable
                columns={orderColumns}
                data={orders}
                filterableColumns={[
                  {
                    id: "status",
                    title: "상태",
                    options: Object.entries(STATUS_LABEL).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  },
                ]}
                searchableColumns={[
                  { id: "orderNo", title: "발주번호" },
                  { id: "supplierName", title: "공급처" },
                ]}
              />
            )}
          </TabsContent>

          {/* Tab 2: 외주 진행 재공 */}
          <TabsContent value="wip" className="p-0">
            {wipUnits.length === 0 ? (
              <div className="py-14 text-center text-muted-foreground">
                <PackageCheck className="mx-auto h-10 w-10 mb-3 opacity-25" />
                <p className="text-[15px]">현재 외주 진행 중인 재공이 없습니다.</p>
                <p className="text-[13px] mt-1 opacity-70">
                  외주발주 등록 후 출고처리하면 여기에 표시됩니다.
                </p>
              </div>
            ) : (
              <DataTable
                columns={wipUnitColumns}
                data={wipUnits}
                searchableColumns={[
                  { id: "mfgNo", title: "제조번호" },
                  { id: "itemName", title: "품목명" },
                  { id: "partnerName", title: "외주처" },
                ]}
              />
            )}
          </TabsContent>

          {/* Tab 3: 외주 입고 이력 */}
          <TabsContent value="history" className="p-0">
            {wipReceivingHistory.length === 0 ? (
              <div className="py-14 text-center text-muted-foreground">
                <ArrowDownLeft className="mx-auto h-10 w-10 mb-3 opacity-25" />
                <p className="text-[15px]">외주 입고 이력이 없습니다.</p>
                <p className="text-[13px] mt-1 opacity-70">
                  입고처리 완료된 재공이 여기에 기록됩니다.
                </p>
              </div>
            ) : (
              <DataTable
                columns={wipReceivingColumns}
                data={wipReceivingHistory}
                searchableColumns={[
                  { id: "mfgNo", title: "제조번호" },
                  { id: "itemName", title: "품목명" },
                  { id: "partnerName", title: "외주처" },
                ]}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}
