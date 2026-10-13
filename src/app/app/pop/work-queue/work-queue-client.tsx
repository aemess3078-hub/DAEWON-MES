"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  ClipboardEdit,
  Clock,
  Factory,
  Loader2,
  PackageCheck,
  Play,
  Search,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  startOperation,
  submitProductionResult,
  type PopWorkQueueRow,
} from "@/lib/actions/pop.actions"

// ─── Filter types ────────────────────────────────────────────────────────────

type QueueFilter = "ALL" | "PENDING" | "IN_PROGRESS" | "AVAILABLE" | "BLOCKED"

const FILTERS: { label: string; value: QueueFilter }[] = [
  { label: "전체", value: "ALL" },
  { label: "대기", value: "PENDING" },
  { label: "진행중", value: "IN_PROGRESS" },
  { label: "작업가능", value: "AVAILABLE" },
  { label: "작업불가", value: "BLOCKED" },
]

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: "대기", className: "border-slate-200 bg-slate-100 text-slate-700" },
  IN_PROGRESS: { label: "진행중", className: "border-amber-200 bg-amber-100 text-amber-800" },
  COMPLETED: { label: "완료", className: "border-green-200 bg-green-100 text-green-800" },
  CANCELLED: { label: "취소", className: "border-red-200 bg-red-100 text-red-700" },
  SKIPPED: { label: "건너뜀", className: "border-zinc-200 bg-zinc-100 text-zinc-700" },
}

// ─── Form state type ──────────────────────────────────────────────────────────

type QuantityField = "goodQty" | "defectQty" | "reworkQty"
type FormState = { goodQty: string; defectQty: string; reworkQty: string; toolIds: string[] }

const EMPTY_FORM: FormState = { goodQty: "", defectQty: "", reworkQty: "", toolIds: [] }

// ─── Helper components ───────────────────────────────────────────────────────

function displayProcessName(processName: string): string {
  return processName.includes("후처리") ? "후처리공정" : processName
}

function formatDate(value: string | null): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toISOString().slice(0, 10)
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status]
  return (
    <Badge
      variant="outline"
      className={`px-3 py-1 text-[14px] ${config?.className ?? "border-slate-200 bg-slate-100 text-slate-700"}`}
    >
      {config?.label ?? (status || "미정")}
    </Badge>
  )
}

function AvailabilityBadge({ row }: { row: PopWorkQueueRow }) {
  if (row.status === "IN_PROGRESS") {
    return (
      <Badge className="bg-amber-500 px-3 py-1 text-[14px] text-white hover:bg-amber-500">
        진행중
      </Badge>
    )
  }

  if (!row.materialIssuanceReady) {
    return (
      <Badge variant="outline" className="border-amber-300 bg-amber-50 px-3 py-1 text-[14px] text-amber-800">
        자재출고 대기
      </Badge>
    )
  }

  if (row.canWork) {
    return (
      <Badge className="bg-emerald-500 px-3 py-1 text-[14px] text-white hover:bg-emerald-500">
        작업가능
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="border-slate-300 bg-white px-3 py-1 text-[14px] text-slate-500">
      이전 공정 대기
    </Badge>
  )
}

function MaterialLotStatus({ row }: { row: PopWorkQueueRow }) {
  if (row.materialLotCount === 0) {
    return <span className="text-[15px] font-medium text-slate-500">미투입</span>
  }

  return (
    <span className="text-[15px] font-semibold text-emerald-700">
      {row.materialLotCount}개 LOT 투입
    </span>
  )
}

// ─── Result inline form ───────────────────────────────────────────────────────

function ResultForm({
  row,
  form,
  error,
  isPending,
  onChange,
  onToggleTool,
  onClearTools,
  onSubmit,
  onCancel,
}: {
  row: PopWorkQueueRow
  form: FormState
  error: string
  isPending: boolean
  onChange: (field: QuantityField, value: string) => void
  onToggleTool: (toolId: string) => void
  onClearTools: () => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const FIELDS: { field: QuantityField; label: string; colorClass: string }[] = [
    { field: "goodQty", label: "양품", colorClass: "text-emerald-700" },
    { field: "defectQty", label: "불량", colorClass: "text-red-600" },
    { field: "reworkQty", label: "재작업", colorClass: "text-amber-700" },
  ]

  return (
    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold text-slate-800">실적 입력</p>
        <span className="text-[13px] text-slate-500">
          잔여 {row.remainingQty.toLocaleString()}개
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {FIELDS.map(({ field, label, colorClass }) => (
          <div key={field}>
            <label className={`block text-[13px] font-medium mb-1 ${colorClass}`}>
              {label}
            </label>
            <Input
              type="number"
              min="0"
              value={form[field]}
              onChange={(e) => onChange(field, e.target.value)}
              className="h-11 text-[15px] text-center bg-white"
              placeholder="0"
              disabled={isPending}
            />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[14px] font-semibold text-slate-800">실제 사용 공구</p>
            <p className="text-[13px] text-slate-500">미선택 시 공구 이력/수명은 변경되지 않습니다.</p>
          </div>
          <Button
            type="button"
            variant={form.toolIds.length === 0 ? "default" : "outline"}
            onClick={onClearTools}
            disabled={isPending}
            className="h-9 px-3 text-[13px]"
          >
            사용 안 함
          </Button>
        </div>
        {row.availableTools.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[13px] text-slate-500">
            이 공정에 계획 공구가 없습니다. 공구 없이 등록할 수 있습니다.
          </p>
        ) : (
          <div className="grid gap-2">
            {row.availableTools.map((tool) => {
              const checked = form.toolIds.includes(tool.id)
              return (
                <label
                  key={tool.id}
                  className={`flex cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-[14px] ${
                    checked ? "border-blue-300 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isPending}
                      onChange={() => onToggleTool(tool.id)}
                    />
                    <span className="font-medium">[{tool.code}] {tool.name}</span>
                  </span>
                  <span className="text-[13px] text-slate-500">{tool.equipmentType}</span>
                </label>
              )
            })}
          </div>
        )}
      </div>

      {error && (
        <p className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          onClick={onSubmit}
          disabled={isPending}
          className="h-11 flex-1 bg-blue-600 hover:bg-blue-700 text-white"
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              저장 중
            </>
          ) : (
            "등록"
          )}
        </Button>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isPending}
          className="h-11 px-5"
        >
          취소
        </Button>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WorkQueueClient({ rows }: { rows: PopWorkQueueRow[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState<QueueFilter>("ALL")
  const [keyword, setKeyword] = useState("")

  const [pendingId, setPendingId] = useState<string | null>(null)
  const [openFormId, setOpenFormId] = useState<string | null>(null)
  const [formValues, setFormValues] = useState<Record<string, FormState>>({})
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})

  function getForm(id: string): FormState {
    return formValues[id] ?? EMPTY_FORM
  }

  function setFormField(id: string, field: QuantityField, value: string) {
    setFormValues((prev) => ({ ...prev, [id]: { ...getForm(id), [field]: value } }))
  }

  function toggleFormTool(id: string, toolId: string) {
    const form = getForm(id)
    const toolIds = form.toolIds.includes(toolId)
      ? form.toolIds.filter((candidate) => candidate !== toolId)
      : [...form.toolIds, toolId]
    setFormValues((prev) => ({ ...prev, [id]: { ...form, toolIds } }))
  }

  function clearFormTools(id: string) {
    const form = getForm(id)
    setFormValues((prev) => ({ ...prev, [id]: { ...form, toolIds: [] } }))
  }

  function clearError(id: string) {
    setActionErrors((prev) => ({ ...prev, [id]: "" }))
  }

  async function handleStart(row: PopWorkQueueRow) {
    const rowId = row.rowId
    setPendingId(rowId)
    clearError(rowId)
    try {
      const result = await startOperation(row.operationId, row.assignmentId)
      if (result.success) {
        router.refresh()
      } else {
        setActionErrors((prev) => ({ ...prev, [rowId]: result.error ?? "오류가 발생했습니다." }))
      }
    } catch {
      setActionErrors((prev) => ({ ...prev, [rowId]: "오류가 발생했습니다." }))
    } finally {
      setPendingId(null)
    }
  }

  async function handleSubmitResult(row: PopWorkQueueRow) {
    const rowId = row.rowId
    const form = getForm(rowId)
    const goodQty = Math.max(0, Number(form.goodQty) || 0)
    const defectQty = Math.max(0, Number(form.defectQty) || 0)
    const reworkQty = Math.max(0, Number(form.reworkQty) || 0)
    const total = goodQty + defectQty + reworkQty

    if (total === 0) {
      setActionErrors((prev) => ({ ...prev, [rowId]: "수량을 1 이상 입력해 주세요." }))
      return
    }
    if (row.remainingQty > 0 && total > row.remainingQty) {
      setActionErrors((prev) => ({
        ...prev,
        [rowId]: `잔여 수량(${row.remainingQty.toLocaleString()})을 초과할 수 없습니다.`,
      }))
      return
    }

    setPendingId(rowId)
    clearError(rowId)

    try {
      const result = await submitProductionResult({
        workOrderOperationId: row.operationId,
        assignmentId: row.assignmentId,
        goodQty,
        defectQty,
        reworkQty,
        toolIds: form.toolIds,
      })

      if (result.success) {
        setFormValues((prev) => ({ ...prev, [rowId]: EMPTY_FORM }))
        if (result.isCompleted) setOpenFormId(null)
        router.refresh()
      } else {
        setActionErrors((prev) => ({ ...prev, [rowId]: result.error ?? "오류가 발생했습니다." }))
      }
    } catch {
      setActionErrors((prev) => ({ ...prev, [rowId]: "오류가 발생했습니다." }))
    } finally {
      setPendingId(null)
    }
  }

  const filteredRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase()

    return rows.filter((row) => {
      const matchesFilter =
        filter === "ALL" ||
        (filter === "PENDING" && row.status === "PENDING") ||
        (filter === "IN_PROGRESS" && row.status === "IN_PROGRESS") ||
        (filter === "AVAILABLE" && row.canWork) ||
        (filter === "BLOCKED" && !row.canWork)

      if (!matchesFilter) return false
      if (!normalizedKeyword) return true

      return [
        row.orderNo,
        row.manufacturingNo ?? "",
        row.itemCode,
        row.itemName,
        row.equipmentName ?? "",
        displayProcessName(row.processName),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedKeyword)
    })
  }, [filter, keyword, rows])

  const availableCount = rows.filter((row) => row.canWork).length
  const inProgressCount = rows.filter((row) => row.status === "IN_PROGRESS").length

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex flex-col gap-4 rounded-xl border bg-white p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[15px] font-medium text-slate-500">POP</p>
          <h1 className="mt-1 text-[28px] font-bold tracking-tight text-slate-900">
            작업지시
          </h1>
          <p className="mt-2 text-[16px] text-slate-500">
            작업자가 수행해야 할 작업지시와 공정 단위 대기 목록을 확인합니다.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-slate-50 px-4 py-3">
            <p className="text-[13px] text-slate-500">전체</p>
            <p className="text-[24px] font-bold text-slate-900">{rows.length}</p>
          </div>
          <div className="rounded-lg border bg-emerald-50 px-4 py-3">
            <p className="text-[13px] text-emerald-700">작업가능</p>
            <p className="text-[24px] font-bold text-emerald-800">{availableCount}</p>
          </div>
          <div className="rounded-lg border bg-amber-50 px-4 py-3">
            <p className="text-[13px] text-amber-700">진행중</p>
            <p className="text-[24px] font-bold text-amber-800">{inProgressCount}</p>
          </div>
        </div>
      </div>

      {/* 필터 */}
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant={filter === item.value ? "default" : "outline"}
                size="lg"
                className="h-11 text-[15px]"
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="relative min-w-0 xl:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="작업지시번호, 제조번호, 품목, 공정 검색"
              className="h-11 pl-9 text-[15px]"
            />
          </div>
        </div>
      </div>

      {/* 작업 카드 목록 */}
      {filteredRows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-slate-50 px-6 py-16 text-center">
          <Factory className="mx-auto mb-4 h-12 w-12 text-slate-300" />
          <p className="text-[18px] font-semibold text-slate-700">표시할 작업대기 공정이 없습니다.</p>
          <p className="mt-2 text-[15px] text-slate-500">필터나 검색어를 변경해 주세요.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredRows.map((row) => {
            const progress =
              row.plannedQty > 0
                ? Math.min(100, Math.round((row.completedQty / row.plannedQty) * 100))
                : 0
            const isThisPending = pendingId === row.rowId
            const isFormOpen = openFormId === row.rowId

            return (
              <article
                key={row.rowId}
                className={`rounded-xl border bg-white p-5 shadow-sm transition-colors ${
                  row.status === "IN_PROGRESS"
                    ? "border-amber-200"
                    : row.canWork
                    ? "border-emerald-200"
                    : "border-slate-200"
                }`}
              >
                {/* 상단 정보 */}
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <AvailabilityBadge row={row} />
                      <StatusBadge status={row.status} />
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-[14px] font-medium text-slate-600">
                        {row.seq}공정
                      </span>
                    </div>
                    <div>
                      <p className="font-mono text-[16px] font-semibold text-slate-700">
                        {row.orderNo}
                      </p>
                      <h2 className="mt-1 text-[23px] font-bold text-slate-950">
                        {displayProcessName(row.processName)}
                      </h2>
                      {row.equipmentName && (
                        <p className="mt-1 text-[16px] font-semibold text-blue-700">
                          {row.equipmentName}
                        </p>
                      )}
                      <p className="mt-1 text-[16px] text-slate-500">
                        [{row.itemCode}] {row.itemName}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 xl:w-[460px]">
                    <div className="rounded-lg bg-slate-50 px-4 py-3">
                      <p className="text-[13px] text-slate-500">제조번호</p>
                      <p className="mt-1 truncate font-mono text-[16px] font-semibold text-blue-700">
                        {row.manufacturingNo ?? "-"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-4 py-3">
                      <p className="text-[13px] text-slate-500">납기일</p>
                      <p className="mt-1 text-[16px] font-semibold text-slate-800">
                        {formatDate(row.dueDate)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* 수량 진행 + 자재 */}
                <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="rounded-lg border bg-white p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-slate-400" />
                      <p className="text-[15px] font-semibold text-slate-800">수량 진행</p>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div>
                        <p className="text-[13px] text-slate-500">계획</p>
                        <p className="text-[20px] font-bold tabular-nums text-slate-900">
                          {row.plannedQty.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-[13px] text-slate-500">완료</p>
                        <p className="text-[20px] font-bold tabular-nums text-emerald-700">
                          {row.completedQty.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-[13px] text-slate-500">잔여</p>
                        <p className="text-[20px] font-bold tabular-nums text-amber-700">
                          {row.remainingQty.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="mt-4 h-3 rounded-full bg-slate-100">
                      <div
                        className="h-3 rounded-full bg-blue-500 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border bg-white p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <PackageCheck className="h-4 w-4 text-slate-400" />
                      <p className="text-[15px] font-semibold text-slate-800">원자재 LOT 투입</p>
                    </div>
                    <MaterialLotStatus row={row} />
                    {row.materialLotCount > 0 && (
                      <p className="mt-2 text-[14px] text-slate-500">
                        총 투입수량 {row.materialLotQty.toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>

                {/* ── 액션 영역 ── */}

                {/* 자재출고 미완료 → 작업시작/실적등록 차단 안내 */}
                {!row.materialIssuanceReady && row.status !== "COMPLETED" && (
                  <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <PackageCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-[14px] text-amber-800">
                      자재출고가 완료되지 않아 작업을 시작할 수 없습니다. 먼저 자재출고를 처리해 주세요.
                    </p>
                  </div>
                )}

                {/* PENDING + 작업가능 → 작업시작 버튼 */}
                {row.status === "PENDING" && row.canWork && (
                  <div className="mt-4 space-y-2">
                    {actionErrors[row.rowId] && (
                      <p className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        {actionErrors[row.rowId]}
                      </p>
                    )}
                    <Button
                      onClick={() => handleStart(row)}
                      disabled={isThisPending}
                      className="h-11 bg-emerald-600 hover:bg-emerald-700 text-white text-[15px] px-6"
                    >
                      {isThisPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          처리 중
                        </>
                      ) : (
                        <>
                          <Play className="mr-2 h-4 w-4" />
                          작업시작
                        </>
                      )}
                    </Button>
                  </div>
                )}

                {/* IN_PROGRESS → 실적등록 버튼 + 인라인 폼 (자재출고 완료 시에만) */}
                {row.status === "IN_PROGRESS" && row.materialIssuanceReady && (
                  <div className="mt-4">
                    {!isFormOpen ? (
                      <div className="space-y-2">
                        {actionErrors[row.rowId] && (
                          <p className="text-[13px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            {actionErrors[row.rowId]}
                          </p>
                        )}
                        <Button
                          onClick={() => {
                            setOpenFormId(row.rowId)
                            clearError(row.rowId)
                          }}
                          variant="outline"
                          className="h-11 border-blue-300 text-blue-700 hover:bg-blue-50 text-[15px] px-6"
                        >
                          <ClipboardEdit className="mr-2 h-4 w-4" />
                          실적등록
                        </Button>
                      </div>
                    ) : (
                      <ResultForm
                        row={row}
                        form={getForm(row.rowId)}
                        error={actionErrors[row.rowId] ?? ""}
                        isPending={isThisPending}
                        onChange={(field, value) => setFormField(row.rowId, field, value)}
                        onToggleTool={(toolId) => toggleFormTool(row.rowId, toolId)}
                        onClearTools={() => clearFormTools(row.rowId)}
                        onSubmit={() => handleSubmitResult(row)}
                        onCancel={() => {
                          setOpenFormId(null)
                          clearError(row.rowId)
                        }}
                      />
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
