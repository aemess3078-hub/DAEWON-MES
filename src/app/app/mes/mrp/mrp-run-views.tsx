"use client"

import type { MrpRunSnapshot } from "../../../../lib/mrp/mrp-run-snapshot"
import type { MrpRunDetail, MrpRunListItem, MrpRunPurchaseView } from "../../../../lib/services/mrp-run.service"

/**
 * MRP 실행이력 표시 컴포넌트 (표시 전용 — 서버 호출 없음, 저장된 Snapshot 값을 그대로 보여 준다)
 *  - 목록: 요약 컬럼만(Snapshot JSON 을 읽지 않는다)
 *  - 상세: 저장 당시 계산 결과. 현재 재고/수주로 다시 계산하지 않는다.
 */

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 3 })
const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const kst = new Date(d.getTime() + 9 * 3600 * 1000)
  const p = (n: number) => String(n).padStart(2, "0")
  return `${kst.getUTCFullYear()}-${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`
}

export const RUN_TYPE_LABEL: Record<string, string> = { ORDER_MRP: "수주기준 MRP" }
export const RUN_STATUS_LABEL: Record<string, string> = { SAVED: "저장됨" }
export const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "DRAFT(미확정)",
  ORDERED: "발주완료",
  PARTIAL_RECEIVED: "부분입고",
  RECEIVED: "입고완료",
  CLOSED: "종결",
  CANCELLED: "취소",
  DELETED: "삭제됨",
}
const KIND_LABEL: Record<string, string> = {
  FINAL_SHORTAGE: "최종 부족",
  SAFETY_STOCK_SHORTAGE: "안전재고 부족",
  TEMPORARY_SHORTAGE: "일시 결품",
  SAFETY_STOCK_TEMPORARY: "안전재고 일시 미달",
}
const COVERAGE_LABEL: Record<string, string> = {
  NONE: "-",
  PARTIAL: "일부 충족(추가 필요)",
  COVERED: "기존 DRAFT 발주로 제안량 충족",
}

export function periodLabel(from: string | null, to: string | null): string {
  if (!from && !to) return "전체 기간"
  return `${from ?? "처음"} ~ ${to ?? "끝"}`
}

type ListProps = {
  items: MrpRunListItem[]
  page: number
  totalPages: number
  total: number
  loading?: boolean
  onOpen: (id: string) => void
  onPage: (page: number) => void
}

export function MrpRunListTable({ items, page, totalPages, total, loading, onOpen, onPage }: ListProps) {
  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b bg-muted/30 text-[13px] font-semibold text-muted-foreground">
                <th className="px-3 py-3 text-left whitespace-nowrap">실행일시</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">실행자</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">유형</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">기간</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">자재 수</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">구매 필요 자재</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">경고</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">생성 PO</th>
                <th className="px-3 py-3 text-left whitespace-nowrap">상태</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-10 text-center text-[14px] text-muted-foreground">
                    {loading ? "불러오는 중..." : "저장된 MRP 실행이력이 없습니다. 발주제안 화면의 \"MRP 실행 저장\"으로 현재 결과를 저장할 수 있습니다."}
                  </td>
                </tr>
              )}
              {items.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-3 py-3 whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.createdByName ?? <span className="text-muted-foreground">-</span>}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {RUN_TYPE_LABEL[r.runType] ?? r.runType}
                    <span className="ml-1 text-[13px] text-muted-foreground">{r.mode}</span>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {periodLabel(r.fromDate, r.toDate)}
                    {r.includeDraft && <span className="ml-1 text-[13px] text-muted-foreground">(임시 수주 포함)</span>}
                  </td>
                  <td className="px-3 py-3 text-right">{fmt(r.materialCount)}</td>
                  <td className="px-3 py-3 text-right">{fmt(r.purchaseNeededCount)}</td>
                  <td className={`px-3 py-3 text-right ${r.warningCount > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                    {fmt(r.warningCount)}
                  </td>
                  <td className="px-3 py-3 text-right">{fmt(r.purchaseOrderCount)}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <span className="rounded-full border px-2 py-0.5 text-[13px]">{RUN_STATUS_LABEL[r.status] ?? r.status}</span>
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button type="button" className="text-[14px] text-primary underline" onClick={() => onOpen(r.id)}>
                      상세 보기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="flex items-center justify-between text-[14px]">
        <span className="text-muted-foreground">
          총 {fmt(total)}건 · {page} / {totalPages} 페이지
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            className="h-9 rounded-md border px-3 text-[14px] disabled:opacity-50"
            disabled={page <= 1 || loading}
            onClick={() => onPage(page - 1)}
          >
            이전
          </button>
          <button
            type="button"
            className="h-9 rounded-md border px-3 text-[14px] disabled:opacity-50"
            disabled={page >= totalPages || loading}
            onClick={() => onPage(page + 1)}
          >
            다음
          </button>
        </span>
      </div>
    </div>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warn" }) {
  return (
    <div
      className={`rounded-xl border p-4 ${tone === "danger" ? "border-red-200 bg-red-50/60" : tone === "warn" ? "border-amber-200 bg-amber-50/60" : "bg-muted/30"}`}
    >
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={`text-[28px] font-bold leading-tight ${tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : ""}`}>
        {fmt(value)}
      </p>
    </div>
  )
}

function SuggestionTable({ snapshot }: { snapshot: MrpRunSnapshot }) {
  const rows = snapshot.suggestions
  if (rows.length === 0) {
    return <p className="rounded-xl border py-8 text-center text-[14px] text-muted-foreground">저장 당시 구매 제안이 필요한 자재가 없었습니다.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b bg-muted/30 text-[13px] font-semibold text-muted-foreground">
              <th className="px-3 py-3 text-left whitespace-nowrap">자재</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">유형</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">MRP 정책 필요량</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">기존 DRAFT(미확정)</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">추가 DRAFT 제안</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">추천 공급업체</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">구매조건</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">목표입고일</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">발주 필요일</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const supplier = r.suppliers.find((s) => s.supplierId === r.recommendedSupplierId)
              return (
                <tr key={r.itemId} className="border-b align-top last:border-0">
                  <td className="px-3 py-3">
                    <div className="font-mono text-[13px]">{r.code}</div>
                    <div>{r.name}</div>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td className="px-3 py-3 text-right">{fmt(r.rawNeed)}</td>
                  <td className="px-3 py-3 text-right">
                    {r.draftCoverageQty > 0 ? fmt(r.draftCoverageQty) : <span className="text-muted-foreground">-</span>}
                    {r.draftOrders.length > 0 && (
                      <div className="text-[13px] text-muted-foreground">{r.draftOrders.map((o) => o.orderNo).join(", ")}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold">
                    {fmt(r.additionalQty)}
                    {r.coverageStatus !== "NONE" && (
                      <div className="text-[13px] font-normal text-muted-foreground">{COVERAGE_LABEL[r.coverageStatus] ?? r.coverageStatus}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{supplier?.supplierName ?? <span className="text-muted-foreground">미지정</span>}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-[13px] text-muted-foreground">
                    LT {r.leadTimeDays === null ? "미등록" : `${fmt(r.leadTimeDays)}일`} · MOQ {r.moq === null ? "없음" : fmt(r.moq)} · 배수{" "}
                    {r.orderMultiple === null ? "없음" : fmt(r.orderMultiple)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.requiredDate ?? "-"}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{r.orderByDate ?? "-"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ShortageTable({ snapshot }: { snapshot: MrpRunSnapshot }) {
  const rows = snapshot.materials.filter((m) => m.finalBalance < 0 || m.peakShortageQty > 0 || m.netting !== null)
  if (rows.length === 0) return <p className="rounded-xl border py-8 text-center text-[14px] text-muted-foreground">저장 당시 결품 자재가 없었습니다.</p>
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b bg-muted/30 text-[13px] font-semibold text-muted-foreground">
              <th className="px-3 py-3 text-left whitespace-nowrap">자재</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">가용재고</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">총 소요</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">입고예정</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">최종 예상</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">안전재고</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">결품예정일</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">반제품 Netting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id} className="border-b last:border-0">
                <td className="px-3 py-3">
                  <div className="font-mono text-[13px]">{m.code}</div>
                  <div>{m.name}</div>
                </td>
                <td className="px-3 py-3 text-right">{fmt(m.qtyAvailable)}</td>
                <td className="px-3 py-3 text-right">{fmt(m.totalRequirement)}</td>
                <td className="px-3 py-3 text-right">{m.scheduledReceiptQty > 0 ? `+${fmt(m.scheduledReceiptQty)}` : "-"}</td>
                <td className={`px-3 py-3 text-right ${m.finalBalance < 0 ? "font-medium text-red-600" : ""}`}>{fmt(m.finalBalance)}</td>
                <td className="px-3 py-3 text-right">{m.safetyStock > 0 ? fmt(m.safetyStock) : "-"}</td>
                <td className="px-3 py-3 whitespace-nowrap">{m.firstShortageDate ?? "-"}</td>
                <td className="px-3 py-3 whitespace-nowrap text-[13px]">
                  {m.netting ? `총 ${fmt(m.netting.grossQty)} − 재고 사용 ${fmt(m.netting.usedQty)} = 순소요 ${fmt(m.netting.netQty)}` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PurchasesTable({ purchases }: { purchases: MrpRunPurchaseView[] }) {
  if (purchases.length === 0) {
    return <p className="rounded-xl border py-8 text-center text-[14px] text-muted-foreground">이 실행에서 생성된 DRAFT 구매발주가 없습니다.</p>
  }
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr className="border-b bg-muted/30 text-[13px] font-semibold text-muted-foreground">
              <th className="px-3 py-3 text-left whitespace-nowrap">발주번호</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">공급업체</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">품목 수</th>
              <th className="px-3 py-3 text-right whitespace-nowrap">총 수량</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">현재 상태</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">추가 발주 사유</th>
              <th className="px-3 py-3 text-left whitespace-nowrap">생성</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="px-3 py-3 font-mono text-[13px] whitespace-nowrap">{p.orderNo}</td>
                <td className="px-3 py-3">{p.supplierName}</td>
                <td className="px-3 py-3 text-right">{fmt(p.itemCount)}</td>
                <td className="px-3 py-3 text-right">{fmt(p.totalQty)}</td>
                <td className="px-3 py-3 whitespace-nowrap">{PO_STATUS_LABEL[p.currentStatus] ?? p.currentStatus}</td>
                <td className="px-3 py-3 text-[13px]">
                  {p.overrideUsed ? <span className="text-amber-700">{p.overrideReason}</span> : <span className="text-muted-foreground">-</span>}
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-[13px] text-muted-foreground">
                  {fmtDateTime(p.createdAt)}
                  {p.createdByName ? ` · ${p.createdByName}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function MrpRunDetailView({ detail, onBack }: { detail: MrpRunDetail; onBack?: () => void }) {
  const { run, snapshot, purchases } = detail
  const s = snapshot.summary
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold">MRP 실행 상세</h2>
          <p className="mt-1 text-[14px] text-muted-foreground">
            {fmtDateTime(run.createdAt)} · {run.createdByName ?? "실행자 미상"} · {RUN_TYPE_LABEL[run.runType] ?? run.runType} ({run.mode}) · 기준일{" "}
            {run.baseDate} · {periodLabel(run.fromDate, run.toDate)}
            {run.includeDraft ? " · 임시(DRAFT) 수주 포함" : ""}
          </p>
        </div>
        {onBack && (
          <button type="button" className="h-9 rounded-md border px-3 text-[14px]" onClick={onBack}>
            목록으로
          </button>
        )}
      </div>

      <div className="rounded-xl border bg-muted/20 px-4 py-3 text-[14px]">
        <p>
          <strong>저장된 실행 결과(Snapshot)</strong>입니다. 저장 당시의 계산 값을 그대로 보여 주며, 현재 재고·수주·발주 상태로 다시 계산하지 않습니다.
          DRAFT 구매발주는 확정 공급이 아니므로 입고예정/예상재고에 포함되지 않고 &quot;기존 DRAFT(미확정)&quot;로 따로 표시됩니다.
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          결과 해시 {run.resultHash.slice(0, 12)} · 입력 해시 {run.sourceHash.slice(0, 12)} · 형식 v{run.snapshotVersion}
          {snapshot.compacted ? " · 크기 제한으로 무결품 자재의 수주 단계는 생략됨" : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Kpi label="수주 라인" value={s.demandLineCount} />
        <Kpi label="필요 자재" value={s.requiredMaterialCount} />
        <Kpi label="최종 부족 자재" value={s.shortageMaterialCount} tone={s.shortageMaterialCount > 0 ? "danger" : undefined} />
        <Kpi label="구매 필요 자재" value={s.purchaseNeededCount} tone={s.purchaseNeededCount > 0 ? "warn" : undefined} />
        <Kpi label="기존 DRAFT로 충족" value={s.coveredCount} />
        <Kpi label="경고" value={s.warningCount} tone={s.warningCount > 0 ? "warn" : undefined} />
      </div>

      <section className="space-y-3">
        <h3 className="text-[18px] font-semibold">발주제안 (저장 당시)</h3>
        <SuggestionTable snapshot={snapshot} />
      </section>

      <section className="space-y-3">
        <h3 className="text-[18px] font-semibold">결품 · 반제품 Netting</h3>
        <ShortageTable snapshot={snapshot} />
      </section>

      <section className="space-y-3">
        <h3 className="text-[18px] font-semibold">입고예정 반영</h3>
        <p className="text-[14px] text-muted-foreground">
          확정 발주(발주완료/부분입고)의 미입고 {fmt(snapshot.scheduledReceipts.appliedReceiptCount)}건 · 자재 {fmt(snapshot.scheduledReceipts.appliedMaterialCount)}종 반영
          {snapshot.scheduledReceipts.overdue.length > 0 && ` · 예정일 경과로 제외 ${fmt(snapshot.scheduledReceipts.overdue.length)}건`}
          {snapshot.scheduledReceipts.excludedOutsourcingCount > 0 && ` · 외주발주 제외 ${fmt(snapshot.scheduledReceipts.excludedOutsourcingCount)}건`}
        </p>
      </section>

      {snapshot.warnings.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-[18px] font-semibold">경고</h3>
          <ul className="space-y-1 text-[14px]">
            {snapshot.warnings.slice(0, 50).map((w, i) => (
              <li key={i} className="text-amber-800">
                • {w.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-[18px] font-semibold">생성된 DRAFT 구매발주</h3>
        <PurchasesTable purchases={purchases} />
      </section>
    </div>
  )
}
