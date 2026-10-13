"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useForm, useFieldArray } from "react-hook-form"
import { Plus, Trash2 } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ECNWithDetails,
  CreateECNInput,
  createECN,
  updateECN,
  getCurrentBOM,
  getCurrentRouting,
} from "@/lib/actions/ecn.actions"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: "create" | "edit"
  editingECN: ECNWithDetails | null
  items: { id: string; code: string; name: string; itemType: string }[]
  tenantId: string
  userId: string
}

type FormValues = {
  title: string
  reason: string
  changeType: string
  targetItemId: string
  note: string
  details: {
    changeTarget: string
    actionType: string
    description: string
    beforeValue: string
    afterValue: string
  }[]
}

export function ECNFormSheet({ open, onOpenChange, mode, editingECN, items, tenantId, userId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [currentBOM, setCurrentBOM] = useState<any>(null)
  const [currentRouting, setCurrentRouting] = useState<any>(null)

  const { register, control, handleSubmit, watch, setValue, reset } = useForm<FormValues>({
    defaultValues: {
      title: "",
      reason: "",
      changeType: "BOM",
      targetItemId: "",
      note: "",
      details: [],
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "details" })
  const targetItemId = watch("targetItemId")
  const changeType = watch("changeType")

  useEffect(() => {
    if (mode === "edit" && editingECN) {
      reset({
        title: editingECN.title,
        reason: editingECN.reason,
        changeType: editingECN.changeType,
        targetItemId: editingECN.targetItemId,
        note: editingECN.note ?? "",
        details: editingECN.details.map((d) => ({
          changeTarget: d.changeTarget,
          actionType: d.actionType,
          description: d.description ?? "",
          beforeValue: d.beforeValue ? JSON.stringify(d.beforeValue) : "",
          afterValue: d.afterValue ? JSON.stringify(d.afterValue) : "",
        })),
      })
    } else if (mode === "create") {
      reset({
        title: "",
        reason: "",
        changeType: "BOM",
        targetItemId: "",
        note: "",
        details: [],
      })
    }
  }, [mode, editingECN, open, reset])

  useEffect(() => {
    if (!targetItemId) return
    const fetchData = async () => {
      const [bom, routing] = await Promise.all([
        getCurrentBOM(targetItemId),
        getCurrentRouting(targetItemId),
      ])
      setCurrentBOM(bom)
      setCurrentRouting(routing)
    }
    fetchData()
  }, [targetItemId])

  const onSubmit = async (values: FormValues) => {
    setLoading(true)
    try {
      const data: CreateECNInput = {
        title: values.title,
        reason: values.reason,
        changeType: values.changeType,
        targetItemId: values.targetItemId,
        note: values.note || undefined,
        details: values.details.map((d) => ({
          changeTarget: d.changeTarget,
          actionType: d.actionType,
          description: d.description || undefined,
          beforeValue: d.beforeValue ? JSON.parse(d.beforeValue) : undefined,
          afterValue: d.afterValue ? JSON.parse(d.afterValue) : undefined,
        })),
      }
      if (mode === "create") {
        await createECN(data, tenantId, userId)
      } else if (editingECN) {
        await updateECN(editingECN.id, data)
      }
      onOpenChange(false)
      router.refresh()
    } catch (e: any) {
      alert(e.message ?? "저장 실패")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[20px]">
            {mode === "create" ? "ECN 등록" : "ECN 수정"}
          </SheetTitle>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 mt-6">
          {/* 제목 */}
          <div className="space-y-1.5">
            <Label>제목 *</Label>
            <Input {...register("title", { required: true })} placeholder="변경 제목" />
          </div>

          {/* 변경 이유 */}
          <div className="space-y-1.5">
            <Label>변경 이유 *</Label>
            <Textarea {...register("reason", { required: true })} placeholder="변경이 필요한 이유" rows={2} />
          </div>

          {/* 변경유형 + 대상 품목 */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>변경유형 *</Label>
              <Select value={changeType} onValueChange={(v) => setValue("changeType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOM">BOM</SelectItem>
                  <SelectItem value="ROUTING">라우팅</SelectItem>
                  <SelectItem value="BOTH">BOM + 라우팅</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>대상 품목 *</Label>
              <Select value={targetItemId} onValueChange={(v) => setValue("targetItemId", v)}>
                <SelectTrigger><SelectValue placeholder="품목 선택" /></SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      [{item.code}] {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 현재 BOM 미리보기 */}
          {targetItemId && currentBOM && (changeType === "BOM" || changeType === "BOTH") && (
            <div className="rounded-lg border bg-muted/10 p-4">
              <p className="text-[13px] font-semibold mb-2 text-muted-foreground">
                현재 BOM v{currentBOM.version} ({currentBOM.bomItems.length}개 자재)
              </p>
              <div className="space-y-1">
                {currentBOM.bomItems.slice(0, 5).map((bi: any) => (
                  <div key={bi.id} className="text-[12px] text-muted-foreground">
                    {bi.seq}. {bi.componentItem.name} ({bi.componentItem.code}) × {Number(bi.qtyPer)} {bi.componentItem.uom}
                  </div>
                ))}
                {currentBOM.bomItems.length > 5 && (
                  <div className="text-[12px] text-muted-foreground">외 {currentBOM.bomItems.length - 5}건...</div>
                )}
              </div>
            </div>
          )}

          {/* 현재 라우팅 미리보기 */}
          {targetItemId && currentRouting && (changeType === "ROUTING" || changeType === "BOTH") && (
            <div className="rounded-lg border bg-muted/10 p-4">
              <p className="text-[13px] font-semibold mb-2 text-muted-foreground">
                현재 라우팅 v{currentRouting.version} ({currentRouting.operations.length}개 공정)
              </p>
              <div className="space-y-1">
                {currentRouting.operations.slice(0, 5).map((op: any) => (
                  <div key={op.id} className="text-[12px] text-muted-foreground">
                    {op.seq}. {op.name} — {op.workCenter.name}
                  </div>
                ))}
                {currentRouting.operations.length > 5 && (
                  <div className="text-[12px] text-muted-foreground">외 {currentRouting.operations.length - 5}건...</div>
                )}
              </div>
            </div>
          )}

          {/* 변경 상세 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>변경 상세</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ changeTarget: "BOM_ITEM", actionType: "MODIFY", description: "", beforeValue: "", afterValue: "" })}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                상세 추가
              </Button>
            </div>
            {fields.map((field, idx) => (
              <div key={field.id} className="border rounded-lg p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[13px] font-medium text-muted-foreground">#{idx + 1}</span>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(idx)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[12px]">변경 대상</Label>
                    <Select
                      value={watch(`details.${idx}.changeTarget`)}
                      onValueChange={(v) => setValue(`details.${idx}.changeTarget`, v)}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BOM_ITEM">BOM 자재</SelectItem>
                        <SelectItem value="ROUTING_OPERATION">라우팅 공정</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[12px]">변경 유형</Label>
                    <Select
                      value={watch(`details.${idx}.actionType`)}
                      onValueChange={(v) => setValue(`details.${idx}.actionType`, v)}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ADD">추가</SelectItem>
                        <SelectItem value="MODIFY">수정</SelectItem>
                        <SelectItem value="DELETE">삭제</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[12px]">변경 설명</Label>
                  <Input {...register(`details.${idx}.description`)} className="h-8" placeholder="변경 내용 설명" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[12px]">변경 전 (JSON)</Label>
                    <Textarea
                      {...register(`details.${idx}.beforeValue`)}
                      className="text-[12px] font-mono"
                      rows={2}
                      placeholder='{"qty": 5}'
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[12px]">변경 후 (JSON)</Label>
                    <Textarea
                      {...register(`details.${idx}.afterValue`)}
                      className="text-[12px] font-mono"
                      rows={2}
                      placeholder='{"qty": 7}'
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 비고 */}
          <div className="space-y-1.5">
            <Label>비고</Label>
            <Textarea {...register("note")} rows={2} placeholder="추가 메모" />
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "저장 중..." : mode === "create" ? "ECN 등록" : "저장"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              취소
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
