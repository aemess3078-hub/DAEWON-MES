"use client"

import { useCallback, useState } from "react"
import { WorkQueueClient } from "@/app/app/pop/work-queue/work-queue-client"
import type { PopWorkQueueRow } from "@/lib/actions/pop.actions"
import type { PopWipLookupResult } from "@/lib/actions/pop-wip-lookup.actions"
import { fakeLookup } from "./fake-wip-lookup"

const row = (over: Partial<PopWorkQueueRow> & Pick<PopWorkQueueRow, "rowId" | "operationId" | "workOrderId" | "orderNo" | "seq" | "status">): PopWorkQueueRow => ({
  assignmentId: null,
  manufacturingNo: null,
  itemCode: "FG-1",
  itemName: "완제품 1",
  processName: "절삭",
  equipmentName: null,
  operationStatus: over.status,
  assignmentStatus: null,
  plannedQty: 100,
  assignedQty: null,
  completedQty: 0,
  remainingQty: 100,
  dueDate: null,
  materialLotCount: 1,
  materialLotQty: 100,
  canWork: true,
  availabilityLabel: "작업가능",
  materialIssuanceReady: true,
  availableTools: [],
  ...over,
})

// 가짜 작업대기 목록: wo-1(2개 공정), wo-2(진행중), wo-3
const ROWS: PopWorkQueueRow[] = [
  row({ rowId: "op-1", operationId: "op-1", workOrderId: "wo-1", orderNo: "WO-0001", manufacturingNo: "26A01", seq: 1, status: "PENDING", processName: "절삭" }),
  row({ rowId: "op-2", operationId: "op-2", workOrderId: "wo-1", orderNo: "WO-0001", manufacturingNo: "26A01", seq: 2, status: "PENDING", processName: "연마", canWork: false, availabilityLabel: "이전 공정 대기" }),
  row({ rowId: "op-3", operationId: "op-3", workOrderId: "wo-2", orderNo: "WO-0002", manufacturingNo: "26A02", itemCode: "FG-2", itemName: "완제품 2", seq: 1, status: "IN_PROGRESS", processName: "조립" }),
  row({ rowId: "op-4", operationId: "op-4", workOrderId: "wo-3", orderNo: "WO-0003", manufacturingNo: "26A03", itemCode: "FG-3", itemName: "완제품 3", seq: 1, status: "PENDING", processName: "검사" }),
]

export function PopWipScanTestClient() {
  const [calls, setCalls] = useState(0)
  const lookup = useCallback(async ({ wipUnitId }: { wipUnitId: string }) => {
    setCalls((n) => n + 1)
    return fakeLookup(wipUnitId)
  }, [])

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-md border bg-white p-3 text-[14px]">
        <p className="font-semibold">POP WIP QR 연동 점검 (가짜 목록 · 가짜 서버 조회)</p>
        <p className="text-muted-foreground">
          WIP 조회 호출 수: <span data-testid="lookup-calls">{calls}</span>
        </p>
      </div>
      <WorkQueueClient rows={ROWS} wipLookup={lookup} />
    </div>
  )
}
