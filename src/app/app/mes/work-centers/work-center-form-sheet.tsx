"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { WorkCenterKind } from "@prisma/client"
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
import { WorkCenterWithDetails, createWorkCenter, updateWorkCenter } from "@/lib/actions/work-center.actions"

const KIND_LABELS: Record<WorkCenterKind, string> = {
  ASSEMBLY: "조립",
  MACHINING: "가공",
  INSPECTION: "검사",
  PACKAGING: "포장",
  STORAGE: "창고",
}

const schema = z.object({
  siteId: z.string().min(1, "공장을 선택하세요"),
  code: z.string().min(1, "공정코드를 입력하세요"),
  name: z.string().min(1, "공정명을 입력하세요"),
  kind: z.nativeEnum(WorkCenterKind),
})
type FormValues = z.infer<typeof schema>

type Props = {
  mode: "create" | "edit"
  workCenter?: WorkCenterWithDetails | null
  sites: { id: string; code: string; name: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkCenterFormSheet({ mode, workCenter, sites, open, onOpenChange }: Props) {
  const router = useRouter()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { siteId: "", code: "", name: "", kind: WorkCenterKind.ASSEMBLY },
  })

  useEffect(() => {
    if (mode === "edit" && workCenter && open) {
      form.reset({
        siteId: workCenter.siteId,
        code: workCenter.code,
        name: workCenter.name,
        kind: workCenter.kind,
      })
    }
    if (mode === "create" && open) {
      form.reset({ siteId: sites[0]?.id ?? "", code: "", name: "", kind: WorkCenterKind.ASSEMBLY })
    }
  }, [mode, workCenter, open, form, sites])

  const onSubmit = async (values: FormValues) => {
    try {
      if (mode === "create") {
        await createWorkCenter(values)
      } else {
        const { siteId, ...rest } = values
        await updateWorkCenter(workCenter!.id, rest)
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
          <SheetTitle>{mode === "create" ? "공정 등록" : "공정 수정"}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
            {/* 공장 */}
            <FormField control={form.control} name="siteId" render={({ field }) => (
              <FormItem>
                <FormLabel>공장/사이트</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={mode === "edit"}
                >
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="공장 선택" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {sites.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* 공정코드 */}
            <FormField control={form.control} name="code" render={({ field }) => (
              <FormItem>
                <FormLabel>공정코드</FormLabel>
                <FormControl>
                  <Input placeholder="예: WC-CNC-001" className="font-mono" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* 공정명 */}
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>공정명</FormLabel>
                <FormControl>
                  <Input placeholder="예: CNC 가공" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* 공정유형 */}
            <FormField control={form.control} name="kind" render={({ field }) => (
              <FormItem>
                <FormLabel>공정유형</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Object.entries(KIND_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {form.formState.errors.root && (
              <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
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
