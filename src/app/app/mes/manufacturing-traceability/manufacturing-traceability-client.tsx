"use client"

import { type ComponentType, type ReactNode, useEffect, useState } from "react"
import {
  Search,
  ClipboardList,
  Package,
  Workflow,
  ShieldCheck,
  PackagePlus,
  Truck,
  History,
  ArrowRight,
  GitBranch,
  Building2,
  type LucideProps,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  getManufacturingTraceability,
  type ManufacturingTraceability,
  type TraceabilityLotGenealogyNode,
} from "@/lib/actions/manufacturing-traceability.actions"
import { formatQuantity } from "@/lib/utils"

const WORK_ORDER_STATUS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "초안", className: "bg-slate-100 text-slate-700" },
  RELEASED: { label: "릴리즈", className: "bg-blue-100 text-blue-700" },
  IN_PROGRESS: { label: "진행중", className: "bg-amber-100 text-amber-800" },
  COMPLETED: { label: "완료", className: "bg-green-100 text-green-800" },
  CANCELLED: { label: "취소", className: "bg-red-100 text-red-700" },
}

const OPERATION_STATUS: Record<string, string> = {
  PENDING: "대기",
  IN_PROGRESS: "진행중",
  COMPLETED: "완료",
  CANCELLED: "취소",
}

const INSPECTION_STAGE: Record<string, string> = {
  FIRST: "초물",
  MID: "중간",
  FINAL: "종물",
}

const INSPECTION_RESULT: Record<string, { label: string; className: string }> = {
  PASS: { label: "합격", className: "bg-green-100 text-green-800" },
  FAIL: { label: "불합격", className: "bg-red-100 text-red-700" },
  CONDITIONAL: { label: "조건부", className: "bg-amber-100 text-amber-800" },
}

const SHIPMENT_STATUS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "초안", className: "bg-slate-100 text-slate-700" },
  CONFIRMED: { label: "확정", className: "bg-blue-100 text-blue-700" },
  SHIPPED: { label: "출하", className: "bg-green-100 text-green-800" },
  CANCELLED: { label: "취소", className: "bg-red-100 text-red-700" },
}

const WIP_MOVEMENT_TYPE: Record<string, { label: string; className: string }> = {
  CREATED: { label: "재공품 생성", className: "bg-sky-100 text-sky-700" },
  STARTED: { label: "작업시작", className: "bg-blue-100 text-blue-700" },
  MOVED: { label: "공정이동", className: "bg-indigo-100 text-indigo-700" },
  HOLD: { label: "보류", className: "bg-amber-100 text-amber-800" },
  RELEASED: { label: "보류해제", className: "bg-emerald-100 text-emerald-700" },
  SPLIT: { label: "수량 분리", className: "bg-purple-100 text-purple-700" },
  MERGE: { label: "병합", className: "bg-purple-100 text-purple-700" },
  DEFECT: { label: "불량 발생", className: "bg-red-100 text-red-700" },
  REWORK: { label: "재작업", className: "bg-orange-100 text-orange-700" },
  SCRAP: { label: "폐기", className: "bg-rose-100 text-rose-700" },
  OUTSOURCED: { label: "외주출고", className: "bg-cyan-100 text-cyan-700" },
  RETURNED: { label: "외주입고", className: "bg-cyan-100 text-cyan-700" },
  COMPLETED: { label: "완료", className: "bg-green-100 text-green-800" },
  ADJUSTED: { label: "조정", className: "bg-slate-100 text-slate-700" },
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toISOString().slice(0, 10)
}

function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`
}

function formatNumber(value: number | null | undefined): string {
  return formatQuantity(value ?? 0)
}

function displayProcessName(processName: string): string {
  return processName.includes("후처리") ? "후처리공정" : processName
}

function Section({
  icon: Icon,
  title,
  empty,
  emptyText = "이력이 없습니다.",
  children,
}: {
  icon: ComponentType<LucideProps>
  title: string
  empty?: boolean
  emptyText?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border bg-white">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[18px] font-semibold text-foreground">{title}</h2>
      </div>
      <div className="p-5">
        {empty ? (
          <p className="py-3 text-center text-[14px] text-muted-foreground">
            {emptyText}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

const ITEM_TYPE_BADGE: Record<string, { label: string; className: string }> = {
  FINISHED: { label: "완제품", className: "bg-green-100 text-green-700" },
  SEMI_FINISHED: { label: "반제품", className: "bg-blue-100 text-blue-700" },
  RAW_MATERIAL: { label: "원자재", className: "bg-amber-100 text-amber-700" },
  CONSUMABLE: { label: "소모품", className: "bg-slate-100 text-slate-600" },
}

function LotTreeNode({
  node,
  depth = 0,
}: {
  node: TraceabilityLotGenealogyNode
  depth?: number
}) {
  const badge = node.itemType ? ITEM_TYPE_BADGE[node.itemType] : null
  return (
    <div>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
        style={{ paddingLeft: `${depth * 24}px` }}
      >
        {depth > 0 && (
          <span className="shrink-0 font-mono text-[13px] text-slate-400">└─</span>
        )}
        <span className="shrink-0 font-mono text-[13px] font-medium text-blue-700">
          {node.lotNo}
        </span>
        {badge && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${badge.className}`}>
            {badge.label}
          </span>
        )}
        <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{node.itemCode}</span>
        <span className="text-[13px] text-foreground">{node.itemName}</span>
        {node.qty != null && (
          <span className="ml-auto shrink-0 text-[13px] text-muted-foreground">
            투입 <span className="font-medium text-foreground">{formatNumber(node.qty)}</span>
          </span>
        )}
      </div>
      {node.parents.map((parent) => (
        <LotTreeNode key={parent.lotId} node={parent} depth={depth + 1} />
      ))}
    </div>
  )
}

interface ManufacturingTraceabilityClientProps {
  tenantId: string
  initialManufacturingNo?: string
}

export function ManufacturingTraceabilityClient({
  tenantId,
  initialManufacturingNo,
}: ManufacturingTraceabilityClientProps) {
  const [query, setQuery] = useState(initialManufacturingNo ?? "")
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<ManufacturingTraceability | null>(null)

  useEffect(() => {
    const manufacturingNo = initialManufacturingNo?.trim()
    if (!manufacturingNo) return
    const nextManufacturingNo = manufacturingNo

    let cancelled = false
    setQuery(nextManufacturingNo)
    setLoading(true)
    setMessage(null)
    setResult(null)

    async function fetchTraceability() {
      try {
        const data = await getManufacturingTraceability(nextManufacturingNo, tenantId)
        if (cancelled) return

        if (!data?.workOrder) {
          setMessage("해당 제조번호의 작업지시를 찾을 수 없습니다.")
          return
        }
        setResult(data)
      } catch (error) {
        console.error(error)
        if (!cancelled) setMessage("조회 중 오류가 발생했습니다.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchTraceability()

    return () => {
      cancelled = true
    }
  }, [initialManufacturingNo, tenantId])

  const handleSearch = async () => {
    const manufacturingNo = query.trim()

    if (!manufacturingNo) {
      setResult(null)
      setMessage("제조번호를 입력한 뒤 조회해 주세요.")
      return
    }

    setLoading(true)
    setMessage(null)
    setResult(null)

    try {
      const data = await getManufacturingTraceability(manufacturingNo, tenantId)
      if (!data?.workOrder) {
        setMessage("해당 제조번호의 작업지시를 찾을 수 없습니다.")
        return
      }
      setResult(data)
    } catch (error) {
      console.error(error)
      setMessage("조회 중 오류가 발생했습니다.")
    } finally {
      setLoading(false)
    }
  }

  const workOrder = result?.workOrder

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-white p-6">
        <p className="mb-4 text-[15px] font-medium text-foreground">제조번호 입력</p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleSearch()
            }}
            placeholder="예: MFG-20260521-001"
            className="flex-1 text-[14px] font-mono"
          />
          <Button
            onClick={handleSearch}
            disabled={loading}
            className="shrink-0 gap-2"
          >
            <Search className="h-4 w-4" />
            {loading ? "조회 중..." : "조회"}
          </Button>
        </div>
        {message && <p className="mt-3 text-[14px] text-muted-foreground">{message}</p>}
      </div>

      {result && workOrder && (
        <div className="space-y-4">
          <Section icon={ClipboardList} title="제조번호 기본정보">
            <div className="grid grid-cols-1 gap-x-8 gap-y-4 text-[14px] sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <span className="mb-0.5 block text-[13px] text-muted-foreground">제조번호</span>
                <span className="font-mono font-semibold">{result.manufacturingNo}</span>
              </div>
              <div>
                <span className="mb-0.5 block text-[13px] text-muted-foreground">작업지시번호</span>
                <span className="font-mono">{workOrder.orderNo}</span>
              </div>
              <div>
                <span className="mb-0.5 block text-[13px] text-muted-foreground">상태</span>
                {(() => {
                  const config = WORK_ORDER_STATUS[workOrder.status]
                  return (
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[13px] font-medium ${config?.className ?? "bg-slate-100 text-slate-700"}`}>
                      {config?.label ?? workOrder.status}
                    </span>
                  )
                })()}
              </div>
              <div>
                <span className="mb-0.5 block text-[13px] text-muted-foreground">품목코드</span>
                <span className="font-mono">{workOrder.item.code}</span>
              </div>
              <div>
                <span className="mb-0.5 block text-[13px] text-muted-foreground">품목명</span>
                <span>{workOrder.item.name}</span>
              </div>
              <div>
                <span className="mb-0.5 block text-[13px] text-muted-foreground">규격</span>
                <span>{workOrder.item.spec ?? "-"}</span>
              </div>
              <div>
                <span className="mb-0.5 block text-[13px] text-muted-foreground">계획수량</span>
                <span className="font-semibold">
                  {formatNumber(workOrder.plannedQty)} {workOrder.item.uom}
                </span>
              </div>
            </div>
          </Section>

          <Section
            icon={GitBranch}
            title="LOT 계보"
            empty={!result.lotGenealogyTrees?.length}
            emptyText="등록된 LOT 계보가 없습니다."
          >
            <div className="space-y-4">
              {result.lotGenealogyTrees?.map((tree, index) => (
                <div key={tree.lotId} className="rounded-lg border border-slate-200 px-4 py-3">
                  {(result.lotGenealogyTrees?.length ?? 0) > 1 && (
                    <p className="mb-2 text-[12px] font-medium text-muted-foreground">
                      입고 {index + 1}차
                    </p>
                  )}
                  <LotTreeNode node={tree} depth={0} />
                </div>
              ))}
            </div>
          </Section>

          <Section
            icon={Package}
            title="투입 원자재 LOT"
            empty={result.materialLots.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">품목코드</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">품목명</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">규격</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">LOT 번호</th>
                    <th className="pb-2 pr-4 text-right text-[13px] font-medium text-muted-foreground">수량</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">단위</th>
                    <th className="pb-2 text-left text-[13px] font-medium text-muted-foreground">출고일시</th>
                  </tr>
                </thead>
                <tbody>
                  {result.materialLots.map((lot, index) => (
                    <tr key={`${lot.lotNo}-${index}`} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-2.5 pr-4 font-mono text-[13px]">{lot.materialCode ?? "-"}</td>
                      <td className="py-2.5 pr-4">{lot.materialName ?? "-"}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{lot.materialSpec ?? "-"}</td>
                      <td className="py-2.5 pr-4 font-mono text-[13px] text-blue-700">{lot.lotNo}</td>
                      <td className="py-2.5 pr-4 text-right">{formatNumber(lot.qty)}</td>
                      <td className="py-2.5 pr-4 text-muted-foreground">{lot.unit ?? "-"}</td>
                      <td className="py-2.5 text-[13px] text-muted-foreground">{formatDateTime(lot.issuedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            icon={History}
            title="재공 이동 이력"
            empty={result.wipMovements.length === 0}
            emptyText="재공 이동 이력이 없습니다."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">일시</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">구분</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">이동</th>
                    <th className="pb-2 pr-4 text-right text-[13px] font-medium text-muted-foreground">수량</th>
                    <th className="pb-2 text-left text-[13px] font-medium text-muted-foreground">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {result.wipMovements.map((movement) => {
                    const typeConfig = WIP_MOVEMENT_TYPE[movement.movementType]
                    const fromLabel = movement.fromOperationName
                      ? displayProcessName(movement.fromOperationName)
                      : movement.fromWorkCenterName ?? "-"
                    const toLabel = movement.toOperationName
                      ? displayProcessName(movement.toOperationName)
                      : movement.toWorkCenterName
                        ?? (movement.movementType === "COMPLETED" ? "완료" : "-")
                    return (
                      <tr key={movement.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">{formatDateTime(movement.createdAt)}</td>
                        <td className="py-2.5 pr-4">
                          <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${typeConfig?.className ?? "bg-slate-100 text-slate-700"}`}>
                            {typeConfig?.label ?? movement.movementType}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-1.5 text-[13px]">
                            <span className="text-muted-foreground">{fromLabel}</span>
                            <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                            <span className="font-medium text-foreground">{toLabel}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-right">{formatNumber(movement.qty)}</td>
                        <td className="py-2.5 text-[13px] text-muted-foreground">{movement.note ?? "-"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {(() => {
            const outsourcingMovements = result.wipMovements.filter(
              (m) => m.movementType === "OUTSOURCED" || m.movementType === "RETURNED",
            )
            return (
              <Section
                icon={Building2}
                title="외주공정 이력"
                empty={outsourcingMovements.length === 0}
                emptyText="외주공정 이력이 없습니다."
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr className="border-b">
                        <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">일시</th>
                        <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">구분</th>
                        <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">외주처</th>
                        <th className="pb-2 pr-4 text-right text-[13px] font-medium text-muted-foreground">수량</th>
                        <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">출처</th>
                        <th className="pb-2 text-left text-[13px] font-medium text-muted-foreground">비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outsourcingMovements.map((movement) => {
                        const typeConfig = WIP_MOVEMENT_TYPE[movement.movementType]
                        const partnerName =
                          movement.movementType === "OUTSOURCED"
                            ? (movement.toPartnerName ?? "-")
                            : (movement.fromPartnerName ?? "-")
                        return (
                          <tr key={movement.id} className="border-b last:border-0 hover:bg-slate-50">
                            <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">{formatDateTime(movement.createdAt)}</td>
                            <td className="py-2.5 pr-4">
                              <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${typeConfig?.className ?? "bg-slate-100 text-slate-700"}`}>
                                {typeConfig?.label ?? movement.movementType}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 text-[13px] font-medium text-foreground">{partnerName}</td>
                            <td className="py-2.5 pr-4 text-right text-[13px]">{formatNumber(movement.qty)}</td>
                            <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">{movement.sourceType ?? "-"}</td>
                            <td className="py-2.5 text-[13px] text-muted-foreground">{movement.note ?? "-"}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>
            )
          })()}

          <Section
            icon={Workflow}
            title="공정 진행 이력"
            empty={result.processHistory.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">순서</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">공정명</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">상태</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">시작일시</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">완료일시</th>
                    <th className="pb-2 pr-4 text-right text-[13px] font-medium text-muted-foreground">양품</th>
                    <th className="pb-2 text-right text-[13px] font-medium text-muted-foreground">불량</th>
                  </tr>
                </thead>
                <tbody>
                  {result.processHistory.map((history) => (
                    <tr key={history.operationId} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-2.5 pr-4 text-muted-foreground">{history.seq}</td>
                      <td className="py-2.5 pr-4 font-medium">{displayProcessName(history.processName)}</td>
                      <td className="py-2.5 pr-4">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[13px] text-slate-700">
                          {OPERATION_STATUS[history.status] ?? history.status}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">{formatDateTime(history.startedAt)}</td>
                      <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">{formatDateTime(history.completedAt)}</td>
                      <td className="py-2.5 pr-4 text-right">{formatNumber(history.goodQty)}</td>
                      <td className="py-2.5 text-right">
                        {history.defectQty > 0 ? (
                          <span className="font-medium text-red-600">{formatNumber(history.defectQty)}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            icon={ShieldCheck}
            title="검사 결과"
            empty={result.inspections.length === 0}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">공정명</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">단계</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">결과</th>
                    <th className="pb-2 pr-4 text-right text-[13px] font-medium text-muted-foreground">검사수량</th>
                    <th className="pb-2 pr-4 text-right text-[13px] font-medium text-muted-foreground">불량수량</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">검사일시</th>
                    <th className="pb-2 text-left text-[13px] font-medium text-muted-foreground">검사자</th>
                  </tr>
                </thead>
                <tbody>
                  {result.inspections.map((inspection) => {
                    const resultConfig = inspection.result ? INSPECTION_RESULT[inspection.result] : null
                    return (
                      <tr key={inspection.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="py-2.5 pr-4 font-medium">{displayProcessName(inspection.processName)}</td>
                        <td className="py-2.5 pr-4">
                          <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[13px] text-violet-700">
                            {INSPECTION_STAGE[inspection.stage] ?? inspection.stage}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          {resultConfig ? (
                            <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${resultConfig.className}`}>
                              {resultConfig.label}
                            </span>
                          ) : (
                            <span className="text-[13px] text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-right">{formatNumber(inspection.inspectedQty)}</td>
                        <td className="py-2.5 pr-4 text-right">
                          {inspection.defectQty > 0 ? (
                            <span className="font-medium text-red-600">{formatNumber(inspection.defectQty)}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">{formatDateTime(inspection.inspectedAt)}</td>
                        <td className="py-2.5 text-[13px]">{inspection.inspectorName ?? "-"}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            icon={PackagePlus}
            title="완제품 입고 이력"
            empty={result.finishedGoodsReceipts.length === 0}
            emptyText="완제품 입고 이력이 없습니다."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">입고일시</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">완제품 LOT</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">품목</th>
                    <th className="pb-2 pr-4 text-right text-[13px] font-medium text-muted-foreground">수량</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">창고 / 로케이션</th>
                    <th className="pb-2 text-left text-[13px] font-medium text-muted-foreground">입고번호</th>
                  </tr>
                </thead>
                <tbody>
                  {result.finishedGoodsReceipts.map((receipt) => (
                    <tr key={receipt.id} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">{formatDateTime(receipt.receiptAt)}</td>
                      <td className="py-2.5 pr-4 font-mono text-[13px]">
                        {receipt.lotNo ? (
                          <span className="text-blue-700">{receipt.lotNo}</span>
                        ) : (
                          <span className="text-muted-foreground">LOT 미등록</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4">
                        <div className="flex flex-col">
                          <span className="font-mono text-[13px]">{receipt.itemCode}</span>
                          <span className="text-[13px] text-muted-foreground">{receipt.itemName}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-4 text-right font-semibold">{formatNumber(receipt.receiptQty)}</td>
                      <td className="py-2.5 pr-4 text-[13px]">
                        <div className="flex flex-col">
                          <span>{receipt.warehouseName ?? "-"}</span>
                          <span className="text-muted-foreground">{receipt.locationName ?? "-"}</span>
                        </div>
                      </td>
                      <td className="py-2.5 font-mono text-[13px] text-muted-foreground">
                        {receipt.inventoryTransactionNo ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            icon={Truck}
            title="출고 이력"
            empty={result.shipments.length === 0}
            emptyText="출고 이력이 없습니다."
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[14px]">
                <thead>
                  <tr className="border-b">
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">출고일시</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">출하번호</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">수주번호</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">고객</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">완제품 LOT</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">품목</th>
                    <th className="pb-2 pr-4 text-right text-[13px] font-medium text-muted-foreground">수량</th>
                    <th className="pb-2 pr-4 text-left text-[13px] font-medium text-muted-foreground">출고창고</th>
                    <th className="pb-2 text-left text-[13px] font-medium text-muted-foreground">출고번호</th>
                  </tr>
                </thead>
                <tbody>
                  {result.shipments.map((shipment, index) => {
                    const statusConfig = SHIPMENT_STATUS[shipment.shipmentStatus ?? shipment.status]
                    return (
                      <tr key={`${shipment.shipmentNo}-${index}`} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">
                          {formatDateTime(shipment.shippedDate ?? shipment.plannedDate)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex flex-col gap-1">
                            <span className="font-mono text-[13px]">{shipment.shipmentNo}</span>
                            <span className={`w-fit rounded-full px-2 py-0.5 text-[13px] font-medium ${statusConfig?.className ?? "bg-slate-100 text-slate-700"}`}>
                              {statusConfig?.label ?? shipment.status}
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-[13px] text-muted-foreground">
                          {shipment.salesOrderNo ?? "-"}
                        </td>
                        <td className="py-2.5 pr-4 text-[13px]">{shipment.customerName ?? "-"}</td>
                        <td className="py-2.5 pr-4 font-mono text-[13px]">
                          {shipment.lotNo ? (
                            <span className="text-blue-700">{shipment.lotNo}</span>
                          ) : (
                            <span className="text-muted-foreground">LOT 미등록</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex flex-col">
                            <span className="font-mono text-[13px]">{shipment.itemCode}</span>
                            <span className="text-[13px] text-muted-foreground">{shipment.itemName}</span>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-right font-medium">{formatNumber(shipment.qty)}</td>
                        <td className="py-2.5 pr-4 text-[13px] text-muted-foreground">{shipment.warehouseName ?? "-"}</td>
                        <td className="py-2.5 font-mono text-[13px] text-muted-foreground">
                          {shipment.inventoryTransactionNo ?? "-"}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}

      {!result && !loading && !message && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-12 text-center">
          <Search className="mx-auto mb-3 h-10 w-10 text-slate-300" />
          <p className="text-[15px] text-slate-500">
            제조번호를 입력하고 조회 버튼을 클릭해 주세요.
          </p>
          <p className="mt-1 text-[13px] text-slate-400">
            투입 원자재 LOT부터 출고까지 전체 이력을 확인할 수 있습니다.
          </p>
        </div>
      )}
    </div>
  )
}
