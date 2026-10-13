"use client"

import { useState } from "react"
import { InspectionSpecWithItems } from "@/lib/actions/quality.actions"
import { SpecListPanel } from "./spec-list-panel"
import { SpecItemEditor } from "./spec-item-editor"
import { SpecFormSheet } from "./spec-form-sheet"

// ─── Types ────────────────────────────────────────────────────────────────────

interface MeasurementManagerProps {
  tenantId: string
  specs: InspectionSpecWithItems[]
  items: { id: string; code: string; name: string }[]
  routingOperations: {
    id: string
    name: string
    seq: number
    routingId: string
    routing: { id: string; code: string; name: string; version: string }
  }[]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MeasurementManager({
  tenantId,
  specs,
  items,
  routingOperations,
}: MeasurementManagerProps) {
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(
    specs[0]?.id ?? null
  )
  const [formOpen, setFormOpen] = useState(false)
  const [editingSpec, setEditingSpec] = useState<InspectionSpecWithItems | null>(null)

  const selectedSpec = specs.find((s) => s.id === selectedSpecId) ?? null

  function handleCreate() {
    setEditingSpec(null)
    setFormOpen(true)
  }

  function handleEdit(spec: InspectionSpecWithItems) {
    setEditingSpec(spec)
    setFormOpen(true)
  }

  return (
    <>
      <div className="flex gap-6 h-[calc(100vh-220px)]">
        {/* 좌측: 검사기준 목록 */}
        <div className="w-80 shrink-0">
          <SpecListPanel
            specs={specs}
            selectedSpecId={selectedSpecId}
            onSelect={setSelectedSpecId}
            onCreate={handleCreate}
            onEdit={handleEdit}
          />
        </div>

        {/* 우측: 검사항목 편집기 */}
        <div className="flex-1 overflow-hidden">
          {selectedSpec ? (
            <SpecItemEditor spec={selectedSpec} />
          ) : (
            <div className="flex items-center justify-center h-full text-[14px] text-muted-foreground border rounded-lg">
              좌측에서 검사기준을 선택하세요
            </div>
          )}
        </div>
      </div>

      <SpecFormSheet
        tenantId={tenantId}
        open={formOpen}
        onOpenChange={setFormOpen}
        editingSpec={editingSpec}
        items={items}
        routingOperations={routingOperations}
      />
    </>
  )
}
