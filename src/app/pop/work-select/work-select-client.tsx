"use client"

import { useRouter } from "next/navigation"
import { formatQuantity } from "@/lib/utils"

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
  status: string
  plannedQty: unknown
  dueDate: Date | string | null
  item: { name: string; code: string } | null
  operations: Operation[]
}

type Props = {
  workOrders: WorkOrder[]
}

export function WorkSelectClient({ workOrders }: Props) {
  const router = useRouter()

  const handleCardClick = (wo: WorkOrder) => {
    // 진행 중이거나 대기 중인 첫 번째 공정으로 이동
    const targetOp = wo.operations.find(
      (op) => op.status === "IN_PROGRESS" || op.status === "PENDING"
    )
    if (targetOp) {
      const targetAssignment = targetOp.assignments?.find(
        (assignment) => assignment.status === "IN_PROGRESS" || assignment.status === "PENDING"
      )
      const suffix = targetAssignment ? `?assignmentId=${targetAssignment.id}` : ""
      router.push(`/pop/production/${targetOp.id}${suffix}`)
    }
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {workOrders.map((wo) => {
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
  )
}
