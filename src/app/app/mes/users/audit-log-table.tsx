"use client"

import { useState, useTransition } from "react"
import { Search, Download, ChevronLeft, ChevronRight } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AuditAction } from "@prisma/client"
import {
  getAuditLogs,
  getAuditLogsExport,
  type AuditLogRow,
  type AuditLogFilter,
  type PaginatedResult,
} from "@/lib/actions/user-management.actions"

const ACTION_CONFIG: Record<string, { label: string; className: string }> = {
  CREATE: { label: "생성", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  UPDATE: { label: "수정", className: "bg-blue-50 text-blue-700 border-blue-200" },
  DELETE: { label: "삭제", className: "bg-red-50 text-red-700 border-red-200" },
  APPROVE: { label: "승인", className: "bg-purple-50 text-purple-700 border-purple-200" },
  REJECT: { label: "반려", className: "bg-amber-50 text-amber-700 border-amber-200" },
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  TenantUser: "사용자",
  Profile: "프로필",
  UserCredential: "비밀번호/PIN",
  EngineeringChange: "변경관리(ECN)",
  SignupRequest: "가입신청",
  SalesOrder: "수주",
  ProductionPlan: "생산계획",
  WorkOrder: "작업지시",
  MaterialIssue: "자재출고",
  FinishedGoodsReceipt: "완제품입고",
  ShipmentOrder: "출하",
  PurchaseOrder: "발주",
  ReceivingInspection: "자재입고",
  OutsourcingOrder: "외주발주",
  WipMovement: "재공 이동",
  QualityInspection: "검사",
  DefectRecord: "불량",
  InventoryBalance: "재고",
  RolePermission: "역할권한",
  EquipmentProblemType: "설비 문제유형",
  EquipmentRepairRequest: "설비 수리요청",
  BOM: "BOM",
  Item: "품목",
  BusinessPartner: "거래처",
  Routing: "라우팅",
  WorkCenter: "작업센터",
  Site: "사업장",
  Warehouse: "창고/로케이션",
  ItemCategory: "품목 카테고리",
  ItemGroup: "품목 그룹",
  ItemPrice: "품목 가격",
  CodeGroup: "공통코드 그룹",
  CommonCode: "공통코드",
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "medium", timeZone: "Asia/Seoul" })
}

const ENTITY_FILTERS = [
  "SalesOrder",
  "ProductionPlan",
  "WorkOrder",
  "MaterialIssue",
  "FinishedGoodsReceipt",
  "ShipmentOrder",
  "PurchaseOrder",
  "ReceivingInspection",
  "OutsourcingOrder",
  "WipMovement",
  "QualityInspection",
  "EquipmentRepairRequest",
  "RolePermission",
  "TenantUser",
]

function formatJsonPreview(value: unknown): string {
  if (value === null || value === undefined) return "—"
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function AuditLogTable({ initialData }: { initialData: PaginatedResult<AuditLogRow> }) {
  const [rows, setRows] = useState<AuditLogRow[]>(initialData.rows)
  const [total, setTotal] = useState(initialData.total)
  const [page, setPage] = useState(initialData.page)
  const [pageSize, setPageSize] = useState(initialData.pageSize)

  const [search, setSearch] = useState("")
  const [action, setAction] = useState<AuditAction | "ALL">("ALL")
  const [entityType, setEntityType] = useState("ALL")
  const [days, setDays] = useState<string>("90")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const [isPending, startTransition] = useTransition()
  const [isExporting, setIsExporting] = useState(false)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  function buildFilter(overrides: Partial<AuditLogFilter> = {}): AuditLogFilter {
    return {
      search,
      action,
      entityType: entityType === "ALL" ? undefined : entityType,
      days: Number(days),
      dateFrom: days === "0" ? dateFrom : undefined,
      dateTo: days === "0" ? dateTo : undefined,
      page,
      pageSize,
      ...overrides,
    }
  }

  function refetch(overrides: Partial<AuditLogFilter> = {}) {
    startTransition(async () => {
      const data = await getAuditLogs(buildFilter(overrides))
      setRows(data.rows)
      setTotal(data.total)
      setPage(data.page)
      setPageSize(data.pageSize)
    })
  }

  function changeFilter(overrides: Partial<AuditLogFilter>) {
    // 필터 변경 시 page=1 초기화
    refetch({ page: 1, ...overrides })
  }

  async function handleExport() {
    setIsExporting(true)
    try {
      const allRows = await getAuditLogsExport({
        search,
        action,
        entityType: entityType === "ALL" ? undefined : entityType,
        days: Number(days),
        dateFrom: days === "0" ? dateFrom : undefined,
        dateTo: days === "0" ? dateTo : undefined,
      })
      const XLSX = await import("xlsx")
      const wsData = [
        ["일시", "사용자", "동작", "대상 유형", "작업 대상", "메뉴", "IP", "변경 전", "변경 후"],
        ...allRows.map((r) => [
          formatDateTime(r.actedAt),
          r.actorName ?? r.actorLabel ?? "시스템",
          ACTION_CONFIG[r.action]?.label ?? r.action,
          ENTITY_TYPE_LABELS[r.entityType] ?? r.entityType,
          r.targetLabel || r.entityId,
          r.menuName ?? "",
          r.ipAddress ?? "",
          formatJsonPreview(r.beforeData),
          formatJsonPreview(r.afterData),
        ]),
      ]
      const wb = XLSX.utils.book_new()
      const ws = XLSX.utils.aoa_to_sheet(wsData)
      XLSX.utils.book_append_sheet(wb, ws, "이용로그")
      const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).replace(/-/g, "")
      XLSX.writeFile(wb, `이용로그_${date}.xlsx`)
    } finally {
      setIsExporting(false)
    }
  }

  const startItem = total === 0 ? 0 : (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, total)

  return (
    <div className="space-y-4">
      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            changeFilter({ search })
          }}
          className="relative"
        >
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="사용자 / 작업 대상 / 이메일 / 메뉴 검색"
            className="h-9 w-[280px] pl-9 text-[14px]"
          />
        </form>

        <Select
          value={action}
          onValueChange={(v) => {
            const next = v as AuditAction | "ALL"
            setAction(next)
            changeFilter({ action: next })
          }}
        >
          <SelectTrigger className="h-9 w-[130px] text-[14px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 동작</SelectItem>
            <SelectItem value="CREATE">생성</SelectItem>
            <SelectItem value="UPDATE">수정</SelectItem>
            <SelectItem value="DELETE">삭제</SelectItem>
            <SelectItem value="APPROVE">승인</SelectItem>
            <SelectItem value="REJECT">반려</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={entityType}
          onValueChange={(v) => {
            setEntityType(v)
            changeFilter({ entityType: v === "ALL" ? undefined : v })
          }}
        >
          <SelectTrigger className="h-9 w-[160px] text-[14px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">전체 업무영역</SelectItem>
            {ENTITY_FILTERS.map((type) => (
              <SelectItem key={type} value={type}>
                {ENTITY_TYPE_LABELS[type] ?? type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={days}
          onValueChange={(v) => {
            setDays(v)
            changeFilter({ days: Number(v), page: 1 })
          }}
        >
          <SelectTrigger className="h-9 w-[140px] text-[14px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">최근 7일</SelectItem>
            <SelectItem value="30">최근 30일</SelectItem>
            <SelectItem value="90">최근 3개월</SelectItem>
            <SelectItem value="0">직접 기간</SelectItem>
          </SelectContent>
        </Select>

        {days === "0" && (
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 w-[140px] text-[14px]"
            />
            <span className="text-[13px] text-muted-foreground">~</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="h-9 w-[140px] text-[14px]"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-[13px]"
              onClick={() => changeFilter({ days: 0, dateFrom, dateTo })}
            >
              조회
            </Button>
          </div>
        )}

        <Select
          value={String(pageSize)}
          onValueChange={(v) => {
            const next = Number(v)
            setPageSize(next)
            changeFilter({ pageSize: next, page: 1 })
          }}
        >
          <SelectTrigger className="h-9 w-[120px] text-[14px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="20">20개씩 보기</SelectItem>
            <SelectItem value="50">50개씩 보기</SelectItem>
            <SelectItem value="100">100개씩 보기</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 text-[13px]"
          onClick={handleExport}
          disabled={isExporting || total === 0}
        >
          <Download className="h-4 w-4" />
          {isExporting ? "다운로드 중…" : "엑셀"}
        </Button>

        {isPending && <span className="text-[13px] text-muted-foreground">불러오는 중…</span>}
      </div>

      {/* 테이블 */}
      <div className="border rounded-xl overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b bg-muted/30">
              {["일시", "사용자", "동작", "대상 유형", "작업 대상", "메뉴", "IP", "상세"].map((h) => (
                <th key={h} className="text-left px-4 py-3 text-[12px] font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-[14px] text-muted-foreground">
                  기록된 감사로그가 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const cfg = ACTION_CONFIG[r.action] ?? { label: r.action, className: "bg-slate-50 text-slate-600 border-slate-200" }
                return (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/10">
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground whitespace-nowrap">
                      {formatDateTime(r.actedAt)}
                    </td>
                    <td className="px-4 py-2.5 text-[14px]">
                      {r.actorName ?? r.actorLabel ?? <span className="text-muted-foreground">시스템</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={`text-[12px] whitespace-nowrap ${cfg.className}`}>
                        {cfg.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground whitespace-nowrap">
                      {ENTITY_TYPE_LABELS[r.entityType] ?? r.entityType}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] max-w-[280px]">
                      <span className="block truncate" title={r.targetLabel || r.entityId}>
                        {r.targetLabel || (
                          <span className="text-muted-foreground font-mono text-[12px]">
                            {r.entityId ? `ID: ${r.entityId.slice(0, 12)}…` : "—"}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-muted-foreground whitespace-nowrap">
                      {r.menuName ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[13px] font-mono text-muted-foreground whitespace-nowrap">
                      {r.ipAddress ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[13px]">
                      <details className="max-w-[340px]">
                        <summary className="cursor-pointer text-[13px] text-slate-600 hover:text-slate-950">
                          변경 전후
                        </summary>
                        <div className="mt-2 grid gap-2">
                          <div>
                            <div className="mb-1 text-[12px] font-medium text-muted-foreground">변경 전</div>
                            <pre className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-[12px] leading-relaxed text-slate-700">
                              {formatJsonPreview(r.beforeData)}
                            </pre>
                          </div>
                          <div>
                            <div className="mb-1 text-[12px] font-medium text-muted-foreground">변경 후</div>
                            <pre className="max-h-48 overflow-auto rounded-lg bg-slate-50 p-2 text-[12px] leading-relaxed text-slate-700">
                              {formatJsonPreview(r.afterData)}
                            </pre>
                          </div>
                        </div>
                      </details>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {total === 0 ? "0건" : `${startItem}–${endItem} / 총 ${total.toLocaleString()}건`}
          {total >= 10000 && " (최대 10,000건 표시)"}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page <= 1 || isPending}
            onClick={() => refetch({ page: page - 1 })}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-[13px] min-w-[80px] text-center">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page >= totalPages || isPending}
            onClick={() => refetch({ page: page + 1 })}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
