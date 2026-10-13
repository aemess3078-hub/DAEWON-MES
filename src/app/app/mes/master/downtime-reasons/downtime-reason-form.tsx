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
import { Input }    from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button }   from "@/components/ui/button"
import { Switch }   from "@/components/ui/switch"
import {
  createDowntimeReason,
  updateDowntimeReason,
  type DowntimeReason,
} from "@/lib/actions/downtime-reason.actions"

// ─── 스키마 ───────────────────────────────────────────────────────────────────

const schema = z.object({
  code:         z.string().min(1, "코드를 입력하세요").max(50).regex(/^[A-Z0-9_]+$/, "영문 대문자, 숫자, 밑줄만 허용됩니다"),
  name:         z.string().min(1, "사유명을 입력하세요").max(100),
  description:  z.string().max(500).optional(),
  displayOrder: z.coerce.number().int().min(0).default(0),
  isActive:     z.boolean().default(true),
})

type FormValues = z.infer<typeof schema>

// ─── 에러 메시지 매핑 ──────────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  DUPLICATE_CODE: "동일한 코드가 이미 존재합니다.",
  NOT_FOUND:      "항목을 찾을 수 없습니다.",
  UNAUTHORIZED:   "로그인이 필요합니다.",
  FORBIDDEN:      "권한이 없습니다.",
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  mode:         "create" | "edit"
  reason?:      DowntimeReason | null
  open:         boolean
  onOpenChange: (open: boolean) => void
}

// ─── 컴포넌트 ─────────────────────────────────────────────────────────────────

export function DowntimeReasonFormSheet({ mode, reason, open, onOpenChange }: Props) {
  const router = useRouter()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code:         "",
      name:         "",
      description:  "",
      displayOrder: 0,
      isActive:     true,
    },
  })

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && reason) {
      form.reset({
        code:         reason.code,
        name:         reason.name,
        description:  reason.description ?? "",
        displayOrder: reason.displayOrder,
        isActive:     reason.isActive,
      })
    } else {
      form.reset({ code: "", name: "", description: "", displayOrder: 0, isActive: true })
    }
  }, [open, mode, reason, form])

  const onSubmit = async (values: FormValues) => {
    try {
      const payload = { ...values, description: values.description || null }
      if (mode === "create") {
        await createDowntimeReason(payload)
      } else {
        const { code: _code, ...rest } = payload
        await updateDowntimeReason(reason!.id, rest)
      }
      router.refresh()
      onOpenChange(false)
    } catch (e: unknown) {
      const msg = e instanceof Error
        ? (ERROR_MESSAGES[e.message] ?? e.message)
        : "오류가 발생했습니다."
      form.setError("root", { message: msg })
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-[18px]">
            {mode === "create" ? "비가동사유 등록" : "비가동사유 수정"}
          </SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 mt-6">

            {/* 코드 */}
            <FormField control={form.control} name="code" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">코드 <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input
                    placeholder="예: EQUIP_FAIL"
                    className="font-mono text-[14px] uppercase"
                    disabled={mode === "edit"}
                    {...field}
                    onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                  />
                </FormControl>
                <p className="text-[12px] text-muted-foreground">영문 대문자, 숫자, 밑줄(_)만 사용 가능합니다.</p>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 사유명 */}
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">사유명 <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input placeholder="예: 설비고장" className="text-[14px]" {...field} />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 설명 */}
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">설명</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="사유에 대한 추가 설명을 입력하세요"
                    className="text-[14px] resize-none"
                    rows={3}
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 정렬순서 */}
            <FormField control={form.control} name="displayOrder" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">정렬순서</FormLabel>
                <FormControl>
                  <Input type="number" min={0} className="w-28 text-[14px]" {...field} />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 사용여부 */}
            <FormField control={form.control} name="isActive" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
                <div>
                  <FormLabel className="text-[14px]">사용여부</FormLabel>
                  <p className="text-[13px] text-muted-foreground mt-0.5">
                    미사용 시 비가동 사유 선택 목록에서 제외됩니다
                  </p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
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
