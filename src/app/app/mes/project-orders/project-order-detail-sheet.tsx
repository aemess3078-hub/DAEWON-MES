"use client"

import type { ReactNode } from "react"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ProjectOrderRow, STATUS_CONFIG, PRIORITY_CONFIG } from "./columns"
import { formatDDay } from "@/lib/date/kst"

interface ProjectOrderDetailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectOrder: ProjectOrderRow | null
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[12px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-[14px] font-medium">{value}</p>
    </div>
  )
}

export function ProjectOrderDetailSheet({
  open,
  onOpenChange,
  projectOrder,
}: ProjectOrderDetailSheetProps) {
  if (!projectOrder) return null

  const statusCfg = STATUS_CONFIG[projectOrder.status]
  const priorityCfg = PRIORITY_CONFIG[projectOrder.priority]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl overflow-y-auto">
        <SheetHeader className="pb-6 border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <SheetTitle className="text-[20px] font-semibold font-mono">
                {projectOrder.code}
              </SheetTitle>
              <p className="text-[15px] text-muted-foreground font-medium">{projectOrder.name}</p>
            </div>
            <div className="flex gap-1.5 mt-1">
              <Badge variant={priorityCfg.variant} className="text-[12px]">
                {priorityCfg.label}
              </Badge>
              <Badge variant={statusCfg.variant} className="text-[12px]">
                {statusCfg.label}
              </Badge>
            </div>
          </div>
        </SheetHeader>

        <div className="pt-6 grid grid-cols-2 gap-y-5 gap-x-4">
          <Field label="사업장" value={`[${projectOrder.site.code}] ${projectOrder.site.name}`} />
          <Field label="거래처" value={projectOrder.customer.name} />
          <Field label="담당자" value={projectOrder.owner.name} />
          <Field
            label="연결 수주"
            value={projectOrder.salesOrder?.orderNo ?? "—"}
          />
          <Field
            label="품목/모델"
            value={projectOrder.item ? `[${projectOrder.item.code}] ${projectOrder.item.name}` : "—"}
          />
          <Field
            label="시작 예정일"
            value={
              projectOrder.plannedStartDate
                ? format(new Date(projectOrder.plannedStartDate), "yyyy-MM-dd")
                : "—"
            }
          />
          <Field
            label="납기 예정일"
            value={
              projectOrder.dueDate ? (
                <span className="tabular-nums">
                  {format(new Date(projectOrder.dueDate), "yyyy-MM-dd")}{" "}
                  <span className="text-muted-foreground font-normal">
                    ({formatDDay(new Date(projectOrder.dueDate))})
                  </span>
                </span>
              ) : (
                "—"
              )
            }
          />
        </div>

        <div className="pt-6">
          <p className="text-[12px] text-muted-foreground uppercase tracking-wide mb-1">설명/비고</p>
          <p className="text-[14px] whitespace-pre-wrap">
            {projectOrder.description || "등록된 설명이 없습니다."}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
