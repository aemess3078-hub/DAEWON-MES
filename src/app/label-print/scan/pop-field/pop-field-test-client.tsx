"use client"

import { useCallback, useState } from "react"
import { WorkSelectClient } from "@/app/pop/work-select/work-select-client"
import { fakeLookup } from "../pop-wip/fake-wip-lookup"

const op = (id: string, seq: number, status: string, name: string, assignmentId?: string) => ({
  id,
  seq,
  status,
  plannedQty: 100,
  completedQty: 0,
  routingOperation: { name },
  equipment: null,
  assignments: assignmentId ? [{ id: assignmentId, status: "PENDING", equipment: null }] : [],
})

// 가짜 오늘의 작업지시: wo-1(2개 공정, 첫 공정에 설비 배정), wo-2(진행중), wo-3
const WORK_ORDERS = [
  { id: "wo-1", orderNo: "WO-0001", status: "RELEASED", plannedQty: 100, dueDate: null, item: { name: "완제품 1", code: "FG-1" }, operations: [op("op-1", 1, "PENDING", "절삭", "asg-1"), op("op-2", 2, "PENDING", "연마")] },
  { id: "wo-2", orderNo: "WO-0002", status: "IN_PROGRESS", plannedQty: 50, dueDate: null, item: { name: "완제품 2", code: "FG-2" }, operations: [op("op-3", 1, "IN_PROGRESS", "조립")] },
  { id: "wo-3", orderNo: "WO-0003", status: "RELEASED", plannedQty: 30, dueDate: null, item: { name: "완제품 3", code: "FG-3" }, operations: [op("op-4", 1, "PENDING", "검사")] },
]

export function PopFieldScanTestClient() {
  const [calls, setCalls] = useState(0)
  const lookup = useCallback(async ({ wipUnitId }: { wipUnitId: string }) => {
    setCalls((n) => n + 1)
    return fakeLookup(wipUnitId)
  }, [])

  return (
    <div className="space-y-4 p-6" style={{ fontSize: "18px" }}>
      <div className="rounded-md border bg-white p-3 text-[14px]">
        <p className="font-semibold">현장 POP WIP QR 연동 점검 (가짜 목록 · 가짜 서버 조회)</p>
        <p className="text-muted-foreground">
          WIP 조회 호출 수: <span data-testid="lookup-calls">{calls}</span>
        </p>
      </div>
      <h1 className="text-2xl font-bold text-slate-800">작업지시</h1>
      <WorkSelectClient workOrders={WORK_ORDERS} wipLookup={lookup} />
    </div>
  )
}
