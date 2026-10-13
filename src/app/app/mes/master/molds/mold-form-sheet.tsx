"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { EquipmentStatus } from "@prisma/client"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createMold,
  updateMold,
  type MoldEquipmentType,
  type MoldRow,
} from "@/lib/actions/mold.actions"

const MOLD_TYPES = ["TOOL", "JIG", "FIXTURE"] as const
import { MOLD_TYPE_LABELS, MOLD_STATUS_LABELS } from "./columns"

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  siteId: z.string().min(1, "사이트를 선택하세요"),
  workCenterId: z.string().min(1, "작업장을 선택하세요"),
  code: z.string().min(1, "코드를 입력하세요").max(50),
  name: z.string().min(1, "명칭을 입력하세요").max(100),
  equipmentType: z.enum(MOLD_TYPES),
  status: z.nativeEnum(EquipmentStatus),
})
type FormValues = z.infer<typeof schema>

// ─── Props ────────────────────────────────────────────────────────────────────

type SiteOption = { id: string; code: string; name: string }
type WorkCenterOption = { id: string; code: string; name: string; siteId: string }

interface Props {
  mode: "create" | "edit"
  mold?: MoldRow | null
  sites: SiteOption[]
  workCenters: WorkCenterOption[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MoldFormSheet({
  mode,
  mold,
  sites,
  workCenters,
  open,
  onOpenChange,
}: Props) {
  const router = useRouter()
  const [filteredWC, setFilteredWC] = useState<WorkCenterOption[]>(workCenters)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      siteId: sites[0]?.id ?? "",
      workCenterId: "",
      code: "",
      name: "",
      equipmentType: "JIG",
      status: EquipmentStatus.ACTIVE,
    },
  })

  const watchedSiteId = form.watch("siteId")
  useEffect(() => {
    const wcs = workCenters.filter((wc) => wc.siteId === watchedSiteId)
    setFilteredWC(wcs)
    const currentWC = form.getValues("workCenterId")
    if (!wcs.find((wc) => wc.id === currentWC)) {
      form.setValue("workCenterId", wcs[0]?.id ?? "")
    }
  }, [watchedSiteId, workCenters, form])

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && mold) {
      // MoldRow has siteName/workCenterName but not IDs — resolve from lookup
      const matchedSite = sites.find((s) => s.name === mold.siteName)
      const matchedWC = workCenters.find((wc) => wc.name === mold.workCenterName)
      form.reset({
        siteId: matchedSite?.id ?? sites[0]?.id ?? "",
        workCenterId: matchedWC?.id ?? "",
        code: mold.code,
        name: mold.name,
        equipmentType: mold.equipmentType,
        status: mold.status,
      })
    } else {
      const defaultSite = sites[0]?.id ?? ""
      const defaultWC = workCenters.find((wc) => wc.siteId === defaultSite)?.id ?? ""
      form.reset({
        siteId: defaultSite,
        workCenterId: defaultWC,
        code: "",
        name: "",
        equipmentType: "JIG",
        status: EquipmentStatus.ACTIVE,
      })
    }
  }, [open, mode, mold, sites, workCenters, form])

  const onSubmit = async (values: FormValues) => {
    try {
      if (mode === "create") {
        await createMold(values)
      } else {
        const { siteId: _s, code: _c, ...rest } = values
        await updateMold(mold!.id, rest as Parameters<typeof updateMold>[1])
      }
      router.refresh()
      onOpenChange(false)
    } catch (e: unknown) {
      form.setError("root", {
        message: e instanceof Error ? e.message : "오류가 발생했습니다.",
      })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {mode === "create" ? "금형/치공구 등록" : "금형/치공구 수정"}
          </SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
            {/* 사이트 */}
            <FormField
              control={form.control}
              name="siteId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>사업장</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={mode === "edit"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="사업장 선택" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {sites.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 작업장/위치 */}
            <FormField
              control={form.control}
              name="workCenterId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>위치 (작업장)</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="위치 선택" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {filteredWC.map((wc) => (
                        <SelectItem key={wc.id} value={wc.id}>
                          {wc.name}
                          <span className="ml-1 text-muted-foreground text-[12px]">
                            ({wc.code})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 코드 */}
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>코드</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="예: JIG-001"
                      className="font-mono"
                      disabled={mode === "edit"}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 명칭 */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>명칭</FormLabel>
                  <FormControl>
                    <Input placeholder="예: 프레스 상형 지그 #1" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 유형 */}
            <FormField
              control={form.control}
              name="equipmentType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>유형</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MOLD_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {MOLD_TYPE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 상태 */}
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>상태</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(MOLD_STATUS_LABELS).map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <p className="text-[13px] text-destructive bg-destructive/10 px-3 py-2 rounded-md">
                {form.formState.errors.root.message}
              </p>
            )}

            <SheetFooter className="pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
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
