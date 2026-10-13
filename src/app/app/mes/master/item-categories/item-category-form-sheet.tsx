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
  createItemCategory,
  updateItemCategory,
  type ItemCategoryWithCounts,
} from "@/lib/actions/item-category.actions"
import { ITEM_TYPE_LABELS } from "./columns"

// ─── Schema ───────────────────────────────────────────────────────────────────

const schema = z.object({
  code:         z.string().min(1, "코드를 입력하세요").max(50),
  name:         z.string().min(1, "품목분류명을 입력하세요").max(100),
  itemType:     z.string().optional(),
  displayOrder: z.coerce.number().int().min(0).default(0),
})
type FormValues = z.infer<typeof schema>

const ERROR_MESSAGES: Record<string, string> = {
  DUPLICATE_CODE: "동일한 품목분류 코드가 이미 존재합니다.",
  NOT_FOUND:      "품목분류를 찾을 수 없습니다.",
  UNAUTHORIZED:   "로그인이 필요합니다.",
  FORBIDDEN:      "권한이 없습니다.",
}

// ─── Props ────────────────────────────────────────────────────────────────────

type Props = {
  mode:         "create" | "edit"
  category?:    ItemCategoryWithCounts | null
  open:         boolean
  onOpenChange: (open: boolean) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ItemCategoryFormSheet({ mode, category, open, onOpenChange }: Props) {
  const router = useRouter()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { code: "", name: "", itemType: undefined, displayOrder: 0 },
  })

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && category) {
      form.reset({
        code:         category.code,
        name:         category.name,
        itemType:     category.itemType ?? undefined,
        displayOrder: category.displayOrder,
      })
    } else {
      form.reset({ code: "", name: "", itemType: undefined, displayOrder: 0 })
    }
  }, [open, mode, category, form])

  const onSubmit = async (values: FormValues) => {
    try {
      const payload = {
        code:         values.code,
        name:         values.name,
        itemType:     values.itemType === "NONE" || !values.itemType ? null : values.itemType,
        displayOrder: values.displayOrder,
      }
      if (mode === "create") {
        await createItemCategory(payload)
      } else {
        await updateItemCategory(category!.id, payload)
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
            {mode === "create" ? "품목분류 등록" : "품목분류 수정"}
          </SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 mt-6">

            {/* 코드 */}
            <FormField control={form.control} name="code" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">코드</FormLabel>
                <FormControl>
                  <Input
                    placeholder="예: CAT-001"
                    className="font-mono text-[14px]"
                    disabled={mode === "edit"}
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 품목분류명 */}
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">품목분류명</FormLabel>
                <FormControl>
                  <Input placeholder="예: 전자부품" className="text-[14px]" {...field} />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 시스템 유형 */}
            <FormField control={form.control} name="itemType" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">시스템 유형</FormLabel>
                <Select
                  value={field.value ?? "NONE"}
                  onValueChange={(v) => field.onChange(v === "NONE" ? undefined : v)}
                >
                  <FormControl>
                    <SelectTrigger className="text-[14px]">
                      <SelectValue placeholder="유형 선택 (선택사항)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="NONE" className="text-[14px] text-muted-foreground">
                      선택 안 함
                    </SelectItem>
                    {Object.entries(ITEM_TYPE_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v} className="text-[14px]">
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 표시순서 */}
            <FormField control={form.control} name="displayOrder" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">표시순서</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    placeholder="0"
                    className="w-28 text-[14px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-[13px]" />
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
