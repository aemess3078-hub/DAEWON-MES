"use client"

import { useRouter } from "next/navigation"
import { Plus, Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { InspectionSpecWithItems, deleteInspectionSpec } from "@/lib/actions/quality.actions"
import { INSPECTION_STATUS_OPTIONS } from "./measurement-form-schema"

// ─── 상태 배지 설정 ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT:    { label: "초안",   className: "bg-slate-100 text-slate-600" },
  ACTIVE:   { label: "활성",   className: "bg-green-100 text-green-800" },
  INACTIVE: { label: "비활성", className: "bg-red-100 text-red-700" },
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SpecListPanelProps {
  specs: InspectionSpecWithItems[]
  selectedSpecId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onEdit: (spec: InspectionSpecWithItems) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SpecListPanel({
  specs,
  selectedSpecId,
  onSelect,
  onCreate,
  onEdit,
}: SpecListPanelProps) {
  const router = useRouter()

  async function handleDelete(spec: InspectionSpecWithItems, e: React.MouseEvent) {
    e.stopPropagation()
    if (
      !confirm(
        `'[${spec.item.code}] ${spec.item.name}' 검사기준을 삭제하시겠습니까?\n연결된 검사항목도 함께 삭제됩니다.`
      )
    )
      return
    try {
      await deleteInspectionSpec(spec.id)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : "삭제 중 오류가 발생했습니다.")
    }
  }

  return (
    <div className="flex flex-col h-full border rounded-lg bg-background overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="text-[15px] font-semibold">검사기준 목록</h2>
        <Button size="sm" onClick={onCreate} className="h-8 text-[13px]">
          <Plus className="h-3.5 w-3.5 mr-1" />
          등록
        </Button>
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-auto">
        {specs.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-[13px] text-muted-foreground">
            등록된 검사기준이 없습니다
          </div>
        ) : (
          <ul className="divide-y">
            {specs.map((spec) => {
              const statusCfg = STATUS_CONFIG[spec.status] ?? STATUS_CONFIG.DRAFT
              const isSelected = spec.id === selectedSpecId
              return (
                <li
                  key={spec.id}
                  className={`group/item flex items-start justify-between px-4 py-3 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-accent"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => onSelect(spec.id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${statusCfg.className}`}
                      >
                        {statusCfg.label}
                      </span>
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {spec.version}
                      </span>
                    </div>
                    <p className="text-[13px] font-medium truncate">
                      [{spec.item.code}] {spec.item.name}
                    </p>
                    <p className="text-[12px] text-muted-foreground truncate">
                      {spec.routingOperation.name} (seq.{spec.routingOperation.seq})
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      검사항목 {spec.inspectionItems.length}개
                    </p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover/item:opacity-100 transition-opacity shrink-0 ml-2 mt-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(spec)
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={(e) => handleDelete(spec, e)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
