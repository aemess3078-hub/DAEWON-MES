"use client"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export type CompletionTab = "active" | "completed"

interface CompletionTabsProps {
  value: CompletionTab
  onChange: (value: CompletionTab) => void
  activeCount: number
  completedCount: number
  activeLabel?: string
  completedLabel?: string
}

/** 진행(미완료) / 완료 이력 구분 탭. 목록 화면 상단에서 공통으로 쓴다. */
export function CompletionTabs({
  value,
  onChange,
  activeCount,
  completedCount,
  activeLabel = "진행",
  completedLabel = "완료 이력",
}: CompletionTabsProps) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as CompletionTab)}>
      <TabsList className="h-11">
        <TabsTrigger value="active" className="px-4 text-[15px]">
          {activeLabel}
          <span className="ml-2 text-[13px] tabular-nums text-muted-foreground">{activeCount}</span>
        </TabsTrigger>
        <TabsTrigger value="completed" className="px-4 text-[15px]">
          {completedLabel}
          <span className="ml-2 text-[13px] tabular-nums text-muted-foreground">{completedCount}</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

/** 진행 탭이 비었는데 완료 건만 있으면 완료 탭에서 시작한다(수주·계획 연결 화면 등). */
export function initialCompletionTab(activeCount: number, completedCount: number): CompletionTab {
  return activeCount === 0 && completedCount > 0 ? "completed" : "active"
}
