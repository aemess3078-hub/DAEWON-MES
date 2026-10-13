"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
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
import { SiteRow, createSite, updateSite } from "@/lib/actions/site.actions"

const SITE_TYPE_VALUES = ["FACTORY", "WAREHOUSE", "OFFICE"] as const
type SiteType = typeof SITE_TYPE_VALUES[number]

const SITE_TYPE_LABELS: Record<SiteType, string> = {
  FACTORY: "공장",
  WAREHOUSE: "창고",
  OFFICE: "사무소",
}

const schema = z.object({
  code: z.string().min(1, "코드를 입력하세요"),
  name: z.string().min(1, "이름을 입력하세요"),
  type: z.enum(SITE_TYPE_VALUES),
})
type FormValues = z.infer<typeof schema>

type Props = {
  mode: "create" | "edit"
  site?: SiteRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SiteFormSheet({ mode, site, open, onOpenChange }: Props) {
  const router = useRouter()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "", name: "", type: "FACTORY" as SiteType },
  })

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && site) {
      form.reset({
        code: site.code,
        name: site.name,
        type: site.type,
      })
    } else {
      form.reset({ code: "", name: "", type: "FACTORY" as SiteType })
    }
  }, [mode, site, open, form])

  const onSubmit = async (values: FormValues) => {
    try {
      if (mode === "create") {
        await createSite(values)
      } else {
        await updateSite(site!.id, values)
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
          <SheetTitle className="text-[18px]">
            {mode === "create" ? "사이트 등록" : "사이트 수정"}
          </SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-6">
            {/* 코드 */}
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[14px]">코드</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="예: FAC-01"
                      className="font-mono text-[14px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 이름 */}
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[14px]">이름</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="예: 본공장"
                      className="text-[14px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 유형 */}
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[14px]">유형</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(SITE_TYPE_LABELS).map(([v, label]) => (
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
              <p className="text-[13px] text-destructive">
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
