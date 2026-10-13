"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { EquipmentType, EquipmentStatus } from "@prisma/client"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet"
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  createEquipment,
  updateEquipment,
  getWorkCentersForEquipment,
  type EquipmentWithDetails,
} from "@/lib/actions/equipment.actions"
import { EQUIPMENT_TYPE_LABELS, EQUIPMENT_STATUS_LABELS } from "./columns"

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  siteId:        z.string().min(1, "사이트를 선택하세요"),
  workCenterId:  z.string().min(1, "작업장을 선택하세요"),
  code:          z.string().min(1, "설비코드를 입력하세요").max(50),
  name:          z.string().min(1, "설비명을 입력하세요").max(100),
  equipmentType: z.nativeEnum(EquipmentType),
  status:        z.nativeEnum(EquipmentStatus),
})
type FormValues = z.infer<typeof schema>

// ─── Props ────────────────────────────────────────────────────────────────────

type WorkCenterOption = { id: string; code: string; name: string; siteId: string }

type Props = {
  mode:        "create" | "edit"
  equipment?:  EquipmentWithDetails | null
  sites:       { id: string; code: string; name: string }[]
  workCenters: WorkCenterOption[]
  open:        boolean
  onOpenChange: (open: boolean) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EquipmentFormSheet({
  mode, equipment, sites, workCenters, open, onOpenChange,
}: Props) {
  const router = useRouter()
  const [filteredWC, setFilteredWC] = useState<WorkCenterOption[]>(workCenters)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      siteId:        sites[0]?.id ?? "",
      workCenterId:  "",
      code:          "",
      name:          "",
      equipmentType: EquipmentType.MACHINE,
      status:        EquipmentStatus.ACTIVE,
    },
  })

  // 사이트 변경 시 작업장 필터링
  const watchedSiteId = form.watch("siteId")
  useEffect(() => {
    const wcs = workCenters.filter((wc) => wc.siteId === watchedSiteId)
    setFilteredWC(wcs)
    const currentWC = form.getValues("workCenterId")
    if (!wcs.find((wc) => wc.id === currentWC)) {
      form.setValue("workCenterId", wcs[0]?.id ?? "")
    }
  }, [watchedSiteId, workCenters, form])

  // open 시 폼 초기화
  useEffect(() => {
    if (!open) return
    if (mode === "edit" && equipment) {
      form.reset({
        siteId:        equipment.siteId,
        workCenterId:  equipment.workCenterId,
        code:          equipment.code,
        name:          equipment.name,
        equipmentType: equipment.equipmentType,
        status:        equipment.status,
      })
    } else {
      const defaultSite = sites[0]?.id ?? ""
      const defaultWC   = workCenters.find((wc) => wc.siteId === defaultSite)?.id ?? ""
      form.reset({
        siteId: defaultSite, workCenterId: defaultWC,
        code: "", name: "",
        equipmentType: EquipmentType.MACHINE,
        status:        EquipmentStatus.ACTIVE,
      })
    }
  }, [open, mode, equipment, sites, workCenters, form])

  const onSubmit = async (values: FormValues) => {
    try {
      if (mode === "create") {
        await createEquipment(values)
      } else {
        const { siteId: _s, code: _c, ...rest } = values
        await updateEquipment(equipment!.id, rest)
      }
      router.refresh()
      onOpenChange(false)
    } catch (e: any) {
      form.setError("root", { message: e.message })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{mode === "create" ? "설비 등록" : "설비 수정"}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">

            {/* 사이트 */}
            <FormField control={form.control} name="siteId" render={({ field }) => (
              <FormItem>
                <FormLabel>사이트</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={mode === "edit"}
                >
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="사이트 선택" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* 작업장 */}
            <FormField control={form.control} name="workCenterId" render={({ field }) => (
              <FormItem>
                <FormLabel>작업장</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="작업장 선택" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {filteredWC.map((wc) => (
                      <SelectItem key={wc.id} value={wc.id}>
                        {wc.name}
                        <span className="ml-1 text-muted-foreground text-[12px]">({wc.code})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* 설비코드 */}
            <FormField control={form.control} name="code" render={({ field }) => (
              <FormItem>
                <FormLabel>설비코드</FormLabel>
                <FormControl>
                  <Input
                    placeholder="예: EQ-CNC-001"
                    className="font-mono"
                    disabled={mode === "edit"}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* 설비명 */}
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>설비명</FormLabel>
                <FormControl>
                  <Input placeholder="예: CNC 머시닝센터 #1" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* 설비유형 */}
            <FormField control={form.control} name="equipmentType" render={({ field }) => (
              <FormItem>
                <FormLabel>설비유형</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.entries(EQUIPMENT_TYPE_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* 상태 */}
            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>상태</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.entries(EQUIPMENT_STATUS_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {form.formState.errors.root && (
              <p className="text-[13px] text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                {form.formState.errors.root.message}
              </p>
            )}

            <SheetFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                취소
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "저장 중..." : "저장"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  )
}
