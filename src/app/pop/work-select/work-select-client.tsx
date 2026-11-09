"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { formatQuantity } from "@/lib/utils"
import type { PopWipLookupResult } from "@/lib/actions/pop-wip-lookup.actions"
import { PopWipQrScan, type PopWipFound } from "@/components/pop/pop-wip-qr-scan"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  ALL_PROCESSES,
  filterWorkOrders,
  getProcessOptions,
  operationHref,
  targetOperation,
  type PopStatusFilter,
} from "@/lib/pop-process-filter"

type Operation = {
  id: string
  seq: number
  status: string
  plannedQty: unknown
  completedQty: unknown
  routingOperation: { name: string } | null
  equipment: { name: string } | null
  assignments: {
    id: string
    status: string
    equipment: { name: string } | null
  }[]
}

type WorkOrder = {
  id: string
  orderNo: string
  manufacturingNo?: string | null
  status: string
  plannedQty: unknown
  dueDate: Date | string | null
  item: { name: string; code: string } | null
  operations: Operation[]
}

type Props = {
  workOrders: WorkOrder[]
  /** WIP QR 조회 함수(기본: 읽기 전용 서버 액션). 점검 화면/테스트에서 가짜를 주입한다. */
  wipLookup?: (input: { wipUnitId: string }) => Promise<PopWipLookupResult>
}

export function WorkSelectClient({ workOrders, wipLookup }: Props) {
  const router = useRouter()
  // WIP QR 로 찾은 작업지시(표시 필터일 뿐 — 카드 클릭·화면 이동·작업 시작과 무관)
  const [qrWip, setQrWip] = useState<PopWipFound | null>(null)
  const workOrderIdsInList = useMemo(() => new Set(workOrders.map((wo) => wo.id)), [workOrders])
  // 공정별 조회 · 상태 · 통합 검색(표시 필터일 뿐 — 서버의 작업 가능 여부 검증과 무관, 카드 클릭 이동 대상만 선택 공정으로 바뀐다)
  const [selectedProcess, setSelectedProcess] = useState<string>(ALL_PROCESSES)
  const [statusFilter, setStatusFilter] = useState<PopStatusFilter>("ALL")
  const [keyword, setKeyword] = useState("")
  const processOptions = useMemo(() => getProcessOptions(workOrders), [workOrders])

  const handleCardClick = (wo: WorkOrder) => {
    // 공정을 선택했으면 그 공정의 작업 화면으로, 전체이면 기존처럼 진행중/대기 중인 첫 번째 공정으로 이동
    const targetOp = targetOperation(wo, selectedProcess)
    if (targetOp) router.push(operationHref(targetOp))
  }

  if (workOrders.length === 0) {
    return (
      <div className="text-center py-20 text-slate-500">
        <p className="text-xl">오늘 배정된 작업이 없습니다</p>
        <p className="text-base text-slate-400 mt-2">
          RELEASED 또는 IN_PROGRESS 상태의 작업지시가 없습니다
        </p>
      </div>
    )
  }

  // QR 로 찾았다면 그 작업지시의 기존 카드만 보여 준다(새 카드를 만들지 않는다)
  const filteredWorkOrders = filterWorkOrders(workOrders, { process: selectedProcess, status: statusFilter, keyword })
  const visibleWorkOrders = qrWip ? workOrders.filter((wo) => wo.id === qrWip.workOrderId) : filteredWorkOrders
  const selectedSummary = processOptions.find((option) => option.name === selectedProcess)

  return (
    <div className="space-y-4">
      {/* WIP QR 스캔: 라벨의 WIP 로 작업지시를 찾아 표시한다(선택적 편의기능 — 카드 목록·카드 클릭은 그대로) */}
      <PopWipQrScan
        variant="field"
        workOrderIdsInList={workOrderIdsInList}
        selected={qrWip}
        lookup={wipLookup}
        onSelect={(found) => {
          // 찾은 작업지시가 현재 공정·상태·검색어에 가려지지 않도록 전체 보기로 돌린다
          setSelectedProcess(ALL_PROCESSES)
          setStatusFilter("ALL")
          setKeyword("")
          setQrWip(found)
        }}
        onClear={() => setQrWip(null)}
      />

      {/* 공정별 조회: 등록된 공정정보(라우팅 공정) 중 진행중/대기 작업이 있는 공정 */}
      {processOptions.length > 0 && (
        <div className="space-y-3" data-testid="pop-process-filter">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-slate-600">공정별 조회</span>
            {[{ name: ALL_PROCESSES, total: 0 }, ...processOptions].map((option) => {
              const active = selectedProcess === option.name
              return (
                <button
                  key={option.name}
                  type="button"
                  onClick={() => setSelectedProcess(option.name)}
                  aria-pressed={active}
                  className={`min-h-[44px] rounded-full border px-5 text-[15px] font-medium transition-colors ${
                    active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-blue-400"
                  }`}
                >
                  {option.name === ALL_PROCESSES ? "전체 공정" : `${option.name} ${option.total}`}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-slate-600">작업 상태</span>
            {([["ALL", "전체"], ["IN_PROGRESS", "진행중"], ["PENDING", "대기"]] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatusFilter(value)}
                aria-pressed={statusFilter === value}
                className={`min-h-[44px] rounded-full border px-5 text-[15px] font-medium transition-colors ${
                  statusFilter === value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-blue-400"
                }`}
              >
                {label}
              </button>
            ))}
            {selectedSummary && (
              <span className="text-[15px] text-slate-500">
                {selectedSummary.name}: 진행중 {selectedSummary.inProgress} · 대기 {selectedSummary.pending}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <Input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="작업지시번호, 제조번호, 품목, 공정, 설비 검색"
          aria-label="작업 통합 검색"
          className="h-12 rounded-xl pl-12 text-[16px]"
        />
      </div>

      {!qrWip && filteredWorkOrders.length === 0 && (
        <div className="py-16 text-center text-slate-500">
          <p className="text-xl">조건에 해당하는 작업이 없습니다</p>
          <p className="mt-2 text-[15px] text-slate-400">공정·상태·검색어를 확인해 주세요.</p>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {visibleWorkOrders.map((wo) => {
        const totalOps = wo.operations.length
        const completedOps = wo.operations.filter(
          (op) => op.status === "COMPLETED"
        ).length
        const progress =
          totalOps > 0 ? Math.round((completedOps / totalOps) * 100) : 0
        const opNames = wo.operations
          .map((op) => op.routingOperation?.name ?? "공정")
          .join(" → ")

        return (
          <button
            key={wo.id}
            onClick={() => handleCardClick(wo)}
            className="bg-white rounded-2xl p-6 border-2 border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all text-left active:scale-[0.98]"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-mono font-bold text-lg text-slate-800">
                  {wo.orderNo}
                </div>
                <div className="text-slate-600 mt-1">{wo.item?.name}</div>
                {wo.manufacturingNo && (
                  <div className="mt-0.5 font-mono text-[13px] text-blue-700">제조번호 {wo.manufacturingNo}</div>
                )}
                {selectedProcess !== ALL_PROCESSES && targetOperation(wo, selectedProcess) && (
                  <div className="mt-1 text-[14px] font-medium text-slate-700">
                    {selectedProcess} · {targetOperation(wo, selectedProcess)?.status === "IN_PROGRESS" ? "진행중" : "대기"}
                    {targetOperation(wo, selectedProcess)?.equipment?.name ? " · " + targetOperation(wo, selectedProcess)?.equipment?.name : ""}
                  </div>
                )}
              </div>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  wo.status === "IN_PROGRESS"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-blue-100 text-blue-800"
                }`}
              >
                {wo.status === "IN_PROGRESS" ? "진행중" : "대기"}
              </span>
            </div>

            <div className="text-sm text-slate-500 mb-3">
              계획 {formatQuantity(Number(wo.plannedQty))}개
            </div>

            {/* 진행률 바 */}
            <div className="mb-3">
              <div className="flex justify-between text-sm text-slate-500 mb-1">
                <span>공정 진행률</span>
                <span>
                  {completedOps}/{totalOps} ({progress}%)
                </span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full">
                <div
                  className="h-2 bg-blue-500 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="text-xs text-slate-400 truncate">{opNames}</div>
          </button>
        )
      })}
      </div>
    </div>
  )
}
