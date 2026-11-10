"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  startOperation,
  submitProductionResult,
} from "@/lib/actions/pop.actions"
import { PopQuantityInput } from "../../components/pop-quantity-input"
import { formatQuantity } from "@/lib/utils"

type ProductionResult = {
  id: string
  goodQty: unknown
  defectQty: unknown
  reworkQty: unknown
  startedAt: Date | string | null
}

type RoutingOperation = {
  name: string
}

type Equipment = {
  name: string
}

type Item = {
  name: string
  code: string
}

type WorkOrder = {
  orderNo: string
  item: Item | null
}

type Assignment = {
  id: string
  status: string
  assignedQty: unknown
  completedQty: unknown
  equipment: Equipment | null
}

type DefectCode = {
  id: string
  code: string
  name: string
  category: string
}

type DefectLine = {
  defectCodeId: string
  qty: number
}

type MaterialSufficiency = {
  plannedQty: number
  producedQty: number
  materialProducibleQty: number | null
  remainingPlanQty: number
  remainingMaterialQty: number | null
  maxAdditionalProductionQty: number
  shortages: Array<{
    itemId: string
    itemCode: string
    itemName: string
    requiredQty: number
    issuedQty: number
    shortageQty: number
  }>
}

type Operation = {
  id: string
  seq: number
  status: string
  materialIssuanceReady: boolean
  plannedQty: unknown
  completedQty: unknown
  availableWipQty?: number | null
  materialSufficiency?: MaterialSufficiency | null
  defectCodes?: DefectCode[]
  workOrder: WorkOrder | null
  routingOperation: RoutingOperation | null
  equipment: Equipment | null
  assignments: Assignment[]
  selectedAssignment: Assignment | null
  productionResults: ProductionResult[]
}

type Props = {
  operation: Operation
}

export function ProductionClient({ operation }: Props) {
  const router = useRouter()
  const [goodQty, setGoodQty] = useState(0)
  const [defectQty, setDefectQty] = useState(0)
  const [reworkQty, setReworkQty] = useState(0)
  const [defectLines, setDefectLines] = useState<DefectLine[]>([])
  const [loading, setLoading] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const defectCodes = operation.defectCodes ?? []
  const defectLinesTotal = defectLines.reduce((sum, line) => sum + (line.qty || 0), 0)
  // 불량수량 > 0이면 불량코드별 수량 합계가 정확히 일치해야 제출 가능
  const defectDetailsValid =
    defectQty === 0
      ? defectLines.length === 0
      : defectLines.length > 0 &&
        defectLines.every((line) => line.defectCodeId && line.qty > 0) &&
        defectLinesTotal === defectQty

  const addDefectLine = () => {
    // 아직 선택되지 않은 첫 불량코드를 기본값으로
    const usedIds = new Set(defectLines.map((l) => l.defectCodeId))
    const nextCode = defectCodes.find((dc) => !usedIds.has(dc.id))
    setDefectLines((prev) => [
      ...prev,
      { defectCodeId: nextCode?.id ?? "", qty: 0 },
    ])
  }

  const updateDefectLine = (index: number, patch: Partial<DefectLine>) => {
    setDefectLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, ...patch } : line))
    )
  }

  const removeDefectLine = (index: number) => {
    setDefectLines((prev) => prev.filter((_, i) => i !== index))
  }

  const wo = operation.workOrder
  const selectedAssignment = operation.selectedAssignment
  const status = selectedAssignment?.status ?? operation.status
  const completedQty = selectedAssignment
    ? Number(selectedAssignment.completedQty)
    : Number(operation.completedQty)
  const plannedQty = selectedAssignment
    ? Number(selectedAssignment.assignedQty)
    : Number(operation.plannedQty)
  const equipmentName = selectedAssignment?.equipment?.name ?? operation.equipment?.name ?? "-"
  const materialBlocked = !operation.materialIssuanceReady

  // 실제 투입 가능 WIP (전공정 불량 차감 반영). null이면 WIP 추적 없음 → plannedQty 기준 표시.
  const availableWipQty = operation.availableWipQty ?? null
  const materialSufficiency = operation.materialSufficiency ?? null
  const materialMaxAdditional =
    materialSufficiency && materialSufficiency.materialProducibleQty !== null
      ? materialSufficiency.maxAdditionalProductionQty
      : null
  const hasWipShortfall =
    availableWipQty !== null && availableWipQty < plannedQty && status !== "COMPLETED"
  // 잔여수량은 WIP 제약이 있으면 실제 투입 가능 기준, 없으면 계획 기준
  const wipLimitedRemaining = hasWipShortfall
    ? Math.max(availableWipQty - completedQty, 0)
    : Math.max(plannedQty - completedQty, 0)
  const effectiveRemaining =
    materialMaxAdditional !== null
      ? Math.min(wipLimitedRemaining, materialMaxAdditional)
      : wipLimitedRemaining
  const hasMaterialShortfall =
    materialMaxAdditional !== null && materialMaxAdditional < wipLimitedRemaining
  const progress =
    plannedQty > 0
      ? Math.min(100, Math.round((completedQty / plannedQty) * 100))
      : 0

  const handleStart = async () => {
    setLoading(true)
    setStartError(null)
    try {
      const result = await startOperation(operation.id, selectedAssignment?.id)
      if (result.success) {
        router.refresh()
      } else {
        setStartError(result.error ?? "작업 시작에 실패했습니다.")
      }
    } catch {
      setStartError("작업 시작 중 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async () => {
    if (goodQty + defectQty + reworkQty === 0) return
    if (defectQty > 0 && !defectDetailsValid) {
      setStartError(
        `불량코드별 수량 합계(${defectLinesTotal})가 불량수량(${defectQty})과 일치해야 합니다.`
      )
      return
    }
    setLoading(true)
    setStartError(null)
    try {
      const result = await submitProductionResult({
        workOrderOperationId: operation.id,
        assignmentId: selectedAssignment?.id,
        goodQty,
        defectQty,
        reworkQty,
        defectDetails:
          defectQty > 0
            ? defectLines.map((line) => ({
                defectCodeId: line.defectCodeId,
                qty: line.qty,
              }))
            : [],
      })
      if (result.success) {
        setGoodQty(0)
        setDefectQty(0)
        setReworkQty(0)
        setDefectLines([])
        router.refresh()
      } else {
        setStartError(result.error ?? "실적 등록에 실패했습니다.")
      }
    } catch {
      setStartError("실적 등록 중 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const statusLabel =
    status === "PENDING" ? "대기" : status === "IN_PROGRESS" ? "진행중" : "완료"

  const statusClass =
    status === "IN_PROGRESS"
      ? "bg-amber-100 text-amber-800"
      : status === "COMPLETED"
      ? "bg-green-100 text-green-800"
      : "bg-slate-100 text-slate-600"

  return (
    <div className="space-y-6">
      {/* 작업 정보 */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-sm text-slate-500">{wo?.orderNo}</div>
            <div className="text-xl font-bold text-slate-800 mt-1">
              {wo?.item?.name}
            </div>
          </div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusClass}`}>
            {statusLabel}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-500">현재 공정</span>
            <div className="font-semibold mt-1">
              {operation.seq}. {operation.routingOperation?.name}
            </div>
          </div>
          <div>
            <span className="text-slate-500">설비</span>
            <div className="font-semibold mt-1">
              {equipmentName}
            </div>
          </div>
        </div>

        {selectedAssignment && (
          <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-blue-50 p-4 text-center">
            <div>
              <p className="text-sm text-blue-700">배정수량</p>
              <p className="mt-1 text-lg font-bold text-blue-900">{formatQuantity(plannedQty)}</p>
            </div>
            <div>
              <p className="text-sm text-blue-700">완료수량</p>
              <p className="mt-1 text-lg font-bold text-blue-900">{formatQuantity(completedQty)}</p>
            </div>
            <div>
              <p className="text-sm text-blue-700">잔여수량</p>
              <p className="mt-1 text-lg font-bold text-blue-900">
                {formatQuantity(effectiveRemaining)}
              </p>
            </div>
          </div>
        )}

        <div className="mt-4">
          <div className="flex justify-between text-sm text-slate-500 mb-1">
            <span>
              진행률 ({completedQty} / {plannedQty}개 계획)
            </span>
            <span>{progress}%</span>
          </div>
          <div className="h-3 bg-slate-200 rounded-full">
            <div
              className="h-3 bg-blue-500 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          {hasWipShortfall && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>
                전공정 불량으로 투입 가능 수량이 감소했습니다.{" "}
                <strong>잔여 투입 가능: {formatQuantity(effectiveRemaining)}개</strong>{" "}
                (계획: {formatQuantity(plannedQty)}개)
              </span>
            </div>
          )}
          {materialSufficiency && materialSufficiency.materialProducibleQty !== null && (
            <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <span className="text-blue-700">계획수량</span>
                  <div className="font-bold">{formatQuantity(materialSufficiency.plannedQty)}</div>
                </div>
                <div>
                  <span className="text-blue-700">누적실적</span>
                  <div className="font-bold">{formatQuantity(materialSufficiency.producedQty)}</div>
                </div>
                <div>
                  <span className="text-blue-700">자재기준 가능</span>
                  <div className="font-bold">{formatQuantity(materialSufficiency.materialProducibleQty)}</div>
                </div>
                <div>
                  <span className="text-blue-700">추가 생산가능</span>
                  <div className="font-bold">{formatQuantity(effectiveRemaining)}</div>
                </div>
              </div>
              {hasMaterialShortfall && materialSufficiency.shortages.length > 0 && (
                <div className="mt-2 text-[13px] text-blue-800">
                  부족 자재:{" "}
                  {materialSufficiency.shortages.slice(0, 2).map((shortage) => (
                    <span key={shortage.itemId} className="mr-2">
                      {shortage.itemCode} 필요 {formatQuantity(shortage.requiredQty)} / 출고 {formatQuantity(shortage.issuedQty)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 자재출고 미완료 안내 */}
      {materialBlocked && status !== "COMPLETED" && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-[15px] text-amber-800">
          자재출고가 완료되지 않아 작업을 시작할 수 없습니다. 먼저 자재출고를 처리해 주세요.
        </div>
      )}

      {/* 수량 입력 (IN_PROGRESS일 때만, 자재출고 완료 시) */}
      {status === "IN_PROGRESS" && !materialBlocked && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 space-y-4">
          <h2 className="font-bold text-lg text-slate-800">생산실적등록</h2>
          <PopQuantityInput label="양품" value={goodQty} onChange={setGoodQty} steps={[1, 10, 100]} />
          <PopQuantityInput label="불량" value={defectQty} onChange={setDefectQty} steps={[1, 10]} />

          {/* 불량코드별 수량 (자주검사) — 불량수량 > 0일 때만 */}
          {defectQty > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-[15px] text-red-800">
                  불량 원인 입력 (자주검사)
                </h3>
                <span
                  className={`text-sm font-medium ${
                    defectDetailsValid ? "text-emerald-700" : "text-red-600"
                  }`}
                >
                  합계 {defectLinesTotal} / {defectQty}개
                </span>
              </div>

              {defectCodes.length === 0 ? (
                <p className="text-sm text-red-700">
                  등록된 불량코드가 없습니다. 불량관리에서 먼저 불량코드를 등록해 주세요.
                </p>
              ) : (
                <>
                  {defectLines.map((line, index) => {
                    const usedIds = new Set(
                      defectLines
                        .filter((_, i) => i !== index)
                        .map((l) => l.defectCodeId)
                    )
                    return (
                      <div key={index} className="flex items-center gap-2">
                        <select
                          value={line.defectCodeId}
                          onChange={(e) =>
                            updateDefectLine(index, { defectCodeId: e.target.value })
                          }
                          className="flex-1 h-11 rounded-lg border border-slate-300 bg-white px-3 text-[15px]"
                        >
                          <option value="" disabled>
                            불량코드 선택
                          </option>
                          {defectCodes.map((dc) => (
                            <option
                              key={dc.id}
                              value={dc.id}
                              disabled={usedIds.has(dc.id)}
                            >
                              [{dc.code}] {dc.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={line.qty === 0 ? "" : line.qty}
                          placeholder="수량"
                          onChange={(e) =>
                            updateDefectLine(index, {
                              qty: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-20 h-11 rounded-lg border border-slate-300 bg-white px-3 text-[15px] text-center"
                        />
                        <button
                          type="button"
                          onClick={() => removeDefectLine(index)}
                          className="h-11 w-11 shrink-0 rounded-lg border border-slate-300 bg-white text-slate-500 hover:text-red-600"
                          aria-label="불량코드 행 삭제"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}

                  <button
                    type="button"
                    onClick={addDefectLine}
                    disabled={defectLines.length >= defectCodes.length}
                    className="w-full h-11 rounded-lg border border-dashed border-red-300 text-[15px] text-red-700 hover:bg-red-100 disabled:opacity-40"
                  >
                    + 불량코드 추가
                  </button>

                  {!defectDetailsValid && defectLines.length > 0 && (
                    <p className="text-sm text-red-600">
                      불량코드별 수량 합계가 불량수량({defectQty})과 일치해야 등록할 수 있습니다.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <PopQuantityInput label="재작업" value={reworkQty} onChange={setReworkQty} steps={[1, 10]} />
        </div>
      )}

      {/* 이전 실적 이력 */}
      {operation.productionResults.length > 0 && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200">
          <h2 className="font-bold text-lg text-slate-800 mb-4">실적 이력</h2>
          <div className="space-y-2">
            {operation.productionResults.slice(0, 5).map((r) => (
              <div
                key={r.id}
                className="flex justify-between text-sm py-2 border-b last:border-0"
              >
                <span className="text-slate-500">
                  {r.startedAt
                    ? new Date(r.startedAt).toLocaleTimeString("ko-KR")
                    : "—"}
                </span>
                <span>양품 {Number(r.goodQty)}</span>
                <span className="text-red-600">불량 {Number(r.defectQty)}</span>
                <span className="text-amber-600">
                  재작업 {Number(r.reworkQty)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 액션 버튼 */}
      <div className="space-y-3">
        {status === "PENDING" && !materialBlocked && (
          <>
            {startError && (
              <div className="w-full rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {startError}
              </div>
            )}
            <button
              onClick={handleStart}
              disabled={loading}
              className="w-full h-16 text-lg font-bold bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? "처리 중..." : "작업 시작"}
            </button>
          </>
        )}

        {status === "IN_PROGRESS" && !materialBlocked && (
          <>
            {startError && (
              <div className="w-full rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                {startError}
              </div>
            )}
            <button
              onClick={handleSubmit}
              disabled={
                loading ||
                goodQty + defectQty + reworkQty === 0 ||
                (defectQty > 0 && !defectDetailsValid)
              }
              className="w-full h-16 text-lg font-bold bg-blue-500 hover:bg-blue-600 text-white rounded-2xl transition-all active:scale-[0.98] disabled:opacity-50"
            >
              실적 등록
            </button>
          </>
        )}

        {status === "COMPLETED" && (
          <button
            onClick={() => router.push("/pop/work-select")}
            className="w-full h-16 text-lg font-bold bg-slate-500 hover:bg-slate-600 text-white rounded-2xl transition-all active:scale-[0.98]"
          >
            작업 목록으로
          </button>
        )}

        <button
          onClick={() => router.push("/pop/work-select")}
          className="w-full h-12 text-base text-slate-500 hover:text-slate-700 transition-colors"
        >
          목록으로 돌아가기
        </button>
      </div>
    </div>
  )
}
