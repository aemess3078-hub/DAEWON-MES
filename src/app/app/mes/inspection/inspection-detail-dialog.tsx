"use client"

import { format } from "date-fns"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { QualityInspectionWithDetails } from "@/lib/actions/quality.actions"
import { RESULT_CONFIG } from "./inspection-columns"
import { formatQuantity } from "@/lib/utils"
import { AttachmentSection } from "@/components/common/attachments/attachment-section"

// ─── 불량 중요도 / 처리방법 레이블 ───────────────────────────────────────────

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: "치명",
  MAJOR:    "주요",
  MINOR:    "경미",
}

const SEVERITY_CLASSES: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800",
  MAJOR:    "bg-amber-100 text-amber-800",
  MINOR:    "bg-blue-100 text-blue-800",
}

const DISPOSITION_LABELS: Record<string, string> = {
  SCRAP:     "폐기",
  REWORK:    "재작업",
  ACCEPT:    "허용",
  USE_AS_IS: "현상유지",
}

const JUDGEMENT_CLASSES: Record<string, string> = {
  PASS: "bg-emerald-100 text-emerald-800",
  FAIL: "bg-red-100 text-red-800",
}

const JUDGEMENT_LABELS: Record<string, string> = {
  PASS: "합격",
  FAIL: "불합격",
}

function formatMeasurementValue(m: {
  inputTypeSnapshot: string
  numericValue: number | null
  textValue: string | null
  booleanValue: boolean | null
}): string {
  switch (m.inputTypeSnapshot) {
    case "NUMERIC":
      return m.numericValue != null ? String(m.numericValue) : "—"
    case "BOOLEAN":
      return m.booleanValue == null ? "—" : m.booleanValue ? "합격" : "불합격"
    default:
      return m.textValue ?? "—"
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface InspectionDetailDialogProps {
  inspection: QualityInspectionWithDetails | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InspectionDetailDialog({
  inspection,
  open,
  onOpenChange,
}: InspectionDetailDialogProps) {
  if (!inspection) return null

  const wo = inspection.workOrderOperation.workOrder
  const op = inspection.workOrderOperation.routingOperation
  const resultCfg = inspection.result ? RESULT_CONFIG[inspection.result] : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[18px]">검사 상세 정보</DialogTitle>
        </DialogHeader>

        {/* 기본 정보 그리드 */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 py-2">
          <InfoRow label="작업지시" value={wo.orderNo} mono />
          <InfoRow label="품목" value={`[${wo.item.code}] ${wo.item.name}`} />
          <InfoRow label="공정" value={`${op.name} (seq.${op.seq})`} />
          <InfoRow
            label="검사기준"
            value={`${inspection.inspectionSpec.item.name} v${inspection.inspectionSpec.version}`}
          />
          <InfoRow label="검사자" value={inspection.inspector.name} />
          <InfoRow
            label="검사일시"
            value={format(new Date(inspection.inspectedAt), "yyyy-MM-dd HH:mm")}
            mono
          />
          <InfoRow
            label="검사수량"
            value={formatQuantity(Number(inspection.inspectedQty))}
            mono
          />
          <div className="space-y-1">
            <p className="text-[12px] text-muted-foreground">판정</p>
            {resultCfg ? (
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${resultCfg.className}`}
              >
                {resultCfg.label}
              </span>
            ) : (
              <span className="text-[13px] text-muted-foreground">미판정</span>
            )}
          </div>
        </div>

        <div className="border-t pt-4">
          <AttachmentSection entityType="QUALITY_INSPECTION" entityId={inspection.id} />
        </div>

        {/* 측정값 */}
        <div className="border-t pt-4 space-y-3">
          <p className="text-[15px] font-medium">
            측정값
            {inspection.measurements.length > 0 && (
              <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                ({inspection.measurements.length}건)
              </span>
            )}
          </p>

          {inspection.measurements.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-2">등록된 측정값이 없습니다.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[13px]">검사항목</TableHead>
                  <TableHead className="text-[13px] w-16 text-center">sample</TableHead>
                  <TableHead className="text-[13px] w-24 text-right">측정값</TableHead>
                  <TableHead className="text-[13px] w-16">단위</TableHead>
                  <TableHead className="text-[13px] w-20 text-right">LSL</TableHead>
                  <TableHead className="text-[13px] w-20 text-right">USL</TableHead>
                  <TableHead className="text-[13px] w-20">판정</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inspection.measurements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-[13px]">{m.itemNameSnapshot}</TableCell>
                    <TableCell className="text-[13px] text-center font-mono">{m.sampleNo}</TableCell>
                    <TableCell className="text-[13px] text-right font-mono">
                      {formatMeasurementValue(m)}
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">
                      {m.unitSnapshot ?? "—"}
                    </TableCell>
                    <TableCell className="text-[13px] text-right font-mono text-muted-foreground">
                      {m.lowerLimitSnapshot != null ? m.lowerLimitSnapshot : "—"}
                    </TableCell>
                    <TableCell className="text-[13px] text-right font-mono text-muted-foreground">
                      {m.upperLimitSnapshot != null ? m.upperLimitSnapshot : "—"}
                    </TableCell>
                    <TableCell>
                      {m.judgement ? (
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${
                            JUDGEMENT_CLASSES[m.judgement] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {JUDGEMENT_LABELS[m.judgement] ?? m.judgement}
                        </span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        {/* 불량 기록 */}
        <div className="border-t pt-4 space-y-3">
          <p className="text-[15px] font-medium">
            불량 기록
            {inspection.defectRecords.length > 0 && (
              <span className="ml-2 text-[13px] font-normal text-muted-foreground">
                ({inspection.defectRecords.length}건)
              </span>
            )}
          </p>

          {inspection.defectRecords.length === 0 ? (
            <p className="text-[13px] text-muted-foreground py-2">불량 기록이 없습니다.</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[13px]">불량코드</TableHead>
                    <TableHead className="text-[13px]">불량명</TableHead>
                    <TableHead className="text-[13px] w-16 text-right">수량</TableHead>
                    <TableHead className="text-[13px] w-20">중요도</TableHead>
                    <TableHead className="text-[13px] w-24">처리방법</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inspection.defectRecords.map((dr) => (
                    <TableRow key={dr.id}>
                      <TableCell className="font-mono text-[13px]">
                        {dr.defectCode.code}
                      </TableCell>
                      <TableCell className="text-[13px]">{dr.defectCode.name}</TableCell>
                      <TableCell className="text-right font-mono text-[13px]">
                        {formatQuantity(Number(dr.qty))}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${
                            SEVERITY_CLASSES[dr.severity] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {SEVERITY_LABELS[dr.severity] ?? dr.severity}
                        </span>
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">
                        {dr.disposition
                          ? (DISPOSITION_LABELS[dr.disposition] ?? dr.disposition)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="space-y-3 pt-2">
                {inspection.defectRecords.map((dr) => (
                  <div key={`attachment-${dr.id}`} className="rounded-lg bg-muted/20 p-2">
                    <p className="mb-2 text-[13px] font-medium text-muted-foreground">
                      불량기록 첨부 · [{dr.defectCode.code}] {dr.defectCode.name}
                    </p>
                    <AttachmentSection entityType="DEFECT_RECORD" entityId={dr.id} />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── 헬퍼 컴포넌트 ────────────────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  mono = false,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className={`text-[13px] font-medium ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  )
}
