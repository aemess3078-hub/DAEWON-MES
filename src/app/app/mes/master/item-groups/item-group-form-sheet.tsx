"use client"

import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from "@/components/ui/sheet"
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  createItemGroup,
  updateItemGroup,
  type ItemGroupWithDetails,
} from "@/lib/actions/item-group.actions"
import { itemGroupFormSchema, type ItemGroupFormValues } from "./item-group-form-schema"

const ERROR_MESSAGES: Record<string, string> = {
  DUPLICATE_CODE:   "동일한 품목군코드가 이미 존재합니다.",
  INVALID_CATEGORY: "유효하지 않은 품목분류입니다.",
  NOT_FOUND:        "품목군을 찾을 수 없습니다.",
  UNAUTHORIZED:     "로그인이 필요합니다.",
  FORBIDDEN:        "권한이 없습니다.",
}

type Category = { id: string; code: string; name: string }

type Props = {
  mode:         "create" | "edit"
  group?:       ItemGroupWithDetails | null
  categories:   Category[]
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export function ItemGroupFormSheet({ mode, group, categories, open, onOpenChange }: Props) {
  const router = useRouter()

  const form = useForm<ItemGroupFormValues>({
    resolver: zodResolver(itemGroupFormSchema),
    defaultValues: {
      categoryId:   "",
      code:         "",
      name:         "",
      description:  "",
      displayOrder: 0,
      isActive:     true,
    },
  })

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && group) {
      form.reset({
        categoryId:   group.categoryId,
        code:         group.code,
        name:         group.name,
        description:  group.description ?? "",
        displayOrder: group.displayOrder,
        isActive:     group.isActive,
      })
    } else {
      form.reset({
        categoryId:   categories[0]?.id ?? "",
        code:         "",
        name:         "",
        description:  "",
        displayOrder: 0,
        isActive:     true,
      })
    }
  }, [open, mode, group, categories, form])

  const onSubmit = async (values: ItemGroupFormValues) => {
    try {
      const payload = {
        ...values,
        description: values.description || null,
      }
      if (mode === "create") {
        await createItemGroup(payload)
      } else {
        await updateItemGroup(group!.id, payload)
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
            {mode === "create" ? "품목군 등록" : "품목군 수정"}
          </SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5 mt-6">

            {/* 품목분류 */}
            <FormField control={form.control} name="categoryId" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">품목분류 <span className="text-destructive">*</span></FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="text-[14px]">
                      <SelectValue placeholder="품목분류 선택" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-[14px]">
                        {c.name}
                        <span className="ml-1.5 text-[12px] text-muted-foreground font-mono">
                          ({c.code})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 품목군코드 */}
            <FormField control={form.control} name="code" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">품목군코드 <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input
                    placeholder="예: GRP-001"
                    className="font-mono text-[14px]"
                    disabled={mode === "edit"}
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 품목군명 */}
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">품목군명 <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input placeholder="예: SUS 소재" className="text-[14px]" {...field} />
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
                    placeholder="품목군에 대한 설명을 입력하세요"
                    className="text-[14px] resize-none"
                    rows={3}
                    {...field}
                  />
                </FormControl>
                <FormMessage className="text-[13px]" />
              </FormItem>
            )} />

            {/* 표시순서 */}
            <FormField control={form.control} name="displayOrder" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[14px]">표시순서</FormLabel>
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
                    미사용 시 품목 연결에서 제외됩니다
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
