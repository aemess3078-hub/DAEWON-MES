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
import {
  LocationWithSite,
  createLocation,
  updateLocation,
} from "@/lib/actions/location.actions"

const schema = z.object({
  siteId: z.string().min(1, "사이트를 선택하세요"),
  code: z.string().min(1, "코드를 입력하세요"),
  name: z.string().min(1, "이름을 입력하세요"),
  zone: z.string().optional(),
})
type FormValues = z.infer<typeof schema>

type Props = {
  mode: "create" | "edit"
  location?: LocationWithSite | null
  sites: { id: string; code: string; name: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LocationFormSheet({ mode, location, sites, open, onOpenChange }: Props) {
  const router = useRouter()
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { siteId: "", code: "", name: "", zone: "" },
  })

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && location) {
      form.reset({
        siteId: location.siteId,
        code: location.code,
        name: location.name,
        zone: location.zone ?? "",
      })
    } else {
      form.reset({
        siteId: sites[0]?.id ?? "",
        code: "",
        name: "",
        zone: "",
      })
    }
  }, [mode, location, open, form, sites])

  const onSubmit = async (values: FormValues) => {
    try {
      if (mode === "create") {
        await createLocation({
          siteId: values.siteId,
          code: values.code,
          name: values.name,
          zone: values.zone || undefined,
        })
      } else {
        await updateLocation(location!.id, {
          code: values.code,
          name: values.name,
          zone: values.zone || undefined,
        })
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
            {mode === "create" ? "로케이션 등록" : "로케이션 수정"}
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
                  <FormLabel className="text-[14px]">사이트</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={mode === "edit"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="사이트 선택" />
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

            {/* 코드 */}
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[14px]">코드</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="예: WH-RAW"
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
                      placeholder="예: 원자재 창고"
                      className="text-[14px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* 상세구역 */}
            <FormField
              control={form.control}
              name="zone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[14px]">
                    상세구역{" "}
                    <span className="text-[13px] text-muted-foreground font-normal">(선택)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="예: A구역, 1층 좌측"
                      className="text-[14px]"
                      {...field}
                    />
                  </FormControl>
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
