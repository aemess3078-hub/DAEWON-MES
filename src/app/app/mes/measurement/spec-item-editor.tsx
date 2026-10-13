"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Trash2, Save } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { InspectionSpecWithItems, upsertInspectionItems } from "@/lib/actions/quality.actions"
import { INSPECTION_INPUT_TYPE_OPTIONS } from "./measurement-form-schema"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItemEditorRow {
  id?: string       // undefined means new
  seq: number
  name: string
  inputType: string
  lowerLimit: string
  upperLimit: string
  unit: string
}

interface SpecItemEditorProps {
  spec: InspectionSpecWithItems
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SpecItemEditor({ spec }: SpecItemEditorProps) {
  const router = useRouter()
  const [rows, setRows] = useState<ItemEditorRow[]>(
    spec.inspectionItems.map((item) => ({
      id: item.id,
      seq: item.seq,
      name: item.name,
      inputType: item.inputType,
      lowerLimit: item.lowerLimit != null ? String(Number(item.lowerLimit)) : "",
      upperLimit: item.upperLimit != null ? String(Number(item.upperLimit)) : "",
      unit: item.unit ?? "",
    }))
  )
  const [saving, setSaving] = useState(false)

  function addRow() {
    const nextSeq = rows.length > 0 ? Math.max(...rows.map((r) => r.seq)) + 10 : 10
    setRows((prev) => [
      ...prev,
      {
        seq: nextSeq,
        name: "",
        inputType: "NUMERIC",
        lowerLimit: "",
        upperLimit: "",
        unit: "",
      },
    ])
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index))
  }

  function updateRow(index: number, field: keyof ItemEditorRow, value: string | number) {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    )
  }

  async function handleSave() {
    // Validate required fields
    for (const row of rows) {
      if (!row.name.trim()) {
        alert("모든 검사항목에 항목명을 입력해야 합니다.")
        return
      }
    }

    setSaving(true)
    try {
      await upsertInspectionItems(
        spec.id,
        rows.map((row) => ({
          seq: Number(row.seq),
          name: row.name.trim(),
          inputType: row.inputType as any,
          lowerLimit: row.lowerLimit !== "" ? parseFloat(row.lowerLimit) : null,
          upperLimit: row.upperLimit !== "" ? parseFloat(row.upperLimit) : null,
          unit: row.unit.trim() !== "" ? row.unit.trim() : null,
        }))
      )
      router.refresh()
      alert("검사항목이 저장되었습니다.")
    } catch (error) {
      alert(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full border rounded-lg bg-background overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div>
          <h2 className="text-[15px] font-semibold">검사항목</h2>
          <p className="text-[12px] text-muted-foreground">
            [{spec.item.code}] {spec.item.name} / {spec.routingOperation.name}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={addRow} className="h-8 text-[13px]">
            <Plus className="h-3.5 w-3.5 mr-1" />
            항목 추가
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="h-8 text-[13px]">
            <Save className="h-3.5 w-3.5 mr-1" />
            {saving ? "저장 중..." : "저장"}
          </Button>
        </div>
      </div>

      {/* 테이블 */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-[14px] text-muted-foreground gap-2">
            <p>등록된 검사항목이 없습니다.</p>
            <Button variant="outline" size="sm" onClick={addRow} className="h-8 text-[13px]">
              <Plus className="h-3.5 w-3.5 mr-1" />
              항목 추가
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-16 text-[13px]">순서</TableHead>
                <TableHead className="text-[13px]">항목명</TableHead>
                <TableHead className="w-28 text-[13px]">입력유형</TableHead>
                <TableHead className="w-24 text-[13px]">하한값</TableHead>
                <TableHead className="w-24 text-[13px]">상한값</TableHead>
                <TableHead className="w-16 text-[13px]">단위</TableHead>
                <TableHead className="w-10 text-[13px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Input
                      type="number"
                      className="h-7 text-[13px] w-14 text-center"
                      value={row.seq}
                      onChange={(e) => updateRow(index, "seq", parseInt(e.target.value) || 0)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-7 text-[13px]"
                      placeholder="항목명 입력"
                      value={row.name}
                      onChange={(e) => updateRow(index, "name", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={row.inputType}
                      onValueChange={(v) => updateRow(index, "inputType", v)}
                    >
                      <SelectTrigger className="h-7 text-[13px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INSPECTION_INPUT_TYPE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-[13px]">
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      className="h-7 text-[13px]"
                      placeholder="—"
                      value={row.lowerLimit}
                      onChange={(e) => updateRow(index, "lowerLimit", e.target.value)}
                      disabled={row.inputType !== "NUMERIC"}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      className="h-7 text-[13px]"
                      placeholder="—"
                      value={row.upperLimit}
                      onChange={(e) => updateRow(index, "upperLimit", e.target.value)}
                      disabled={row.inputType !== "NUMERIC"}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-7 text-[13px]"
                      placeholder="mm"
                      value={row.unit}
                      onChange={(e) => updateRow(index, "unit", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => removeRow(index)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
