"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  moveSelection,
  presetSelection,
  selectionLabel,
  unitsEqual,
  type PeriodPreset,
  type PeriodSelection,
} from "@/lib/mrp/period"
import type { DateOnly } from "@/lib/mrp/types"

const PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "ALL", label: "전체 미출하" },
  { id: "THIS_MONTH", label: "이번 달" },
  { id: "NEXT_MONTH", label: "다음 달" },
  { id: "THIS_QUARTER", label: "이번 분기" },
  { id: "NEXT_QUARTER", label: "다음 분기" },
  { id: "H1", label: "상반기" },
  { id: "H2", label: "하반기" },
  { id: "THIS_YEAR", label: "올해" },
]

const UNIT_NAME = { MONTH: "월", QUARTER: "분기", HALF: "반기", YEAR: "연도" } as const

type Props = {
  selection: PeriodSelection
  /** 오늘(KST date-only). 클라이언트 마운트 후 설정되며 프리셋 계산 기준일 */
  today: DateOnly | null
  from: string
  to: string
  disabled?: boolean
  /** 프리셋/이전·다음 이동/전체: 선택과 동시에 조회를 실행한다 */
  onSelect: (selection: PeriodSelection) => void
  /** 날짜 직접 입력: 상태만 바꾸고 조회 버튼으로 실행한다 */
  onCustomChange: (from: string, to: string) => void
}

export function PeriodSelector({ selection, today, from, to, disabled, onSelect, onCustomChange }: Props) {
  const isActive = (preset: PeriodPreset): boolean => {
    if (preset === "ALL") return selection.mode === "ALL"
    if (!today || selection.mode !== "UNIT") return false
    const target = presetSelection(preset, today)
    return target.mode === "UNIT" && unitsEqual(target.unit, selection.unit)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="기간 빠른 선택">
        {PRESETS.map((p) => {
          const needsToday = p.id !== "ALL"
          return (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant={isActive(p.id) ? "default" : "outline"}
              disabled={disabled || (needsToday && !today)}
              aria-pressed={isActive(p.id)}
              className="text-[14px]"
              onClick={() => onSelect(presetSelection(p.id, (today ?? "2000-01-01") as DateOnly))}
            >
              {p.label}
            </Button>
          )
        })}
        <Button
          type="button"
          size="sm"
          variant={selection.mode === "CUSTOM" ? "default" : "outline"}
          disabled={disabled}
          aria-pressed={selection.mode === "CUSTOM"}
          className="text-[14px]"
          onClick={() => onCustomChange(from, to)}
        >
          직접 선택
        </Button>
      </div>

      {selection.mode === "UNIT" && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            aria-label={`이전 ${UNIT_NAME[selection.unit.kind]}`}
            onClick={() => onSelect(moveSelection(selection, -1))}
            className="gap-1 text-[14px]"
          >
            <ChevronLeft className="w-4 h-4" />
            이전 {UNIT_NAME[selection.unit.kind]}
          </Button>
          <span className="min-w-[140px] text-center text-[16px] font-semibold">{selectionLabel(selection)}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            aria-label={`다음 ${UNIT_NAME[selection.unit.kind]}`}
            onClick={() => onSelect(moveSelection(selection, 1))}
            className="gap-1 text-[14px]"
          >
            다음 {UNIT_NAME[selection.unit.kind]}
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="mrp-from" className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
            납기 시작일
          </label>
          <Input
            id="mrp-from"
            type="date"
            value={from}
            onChange={(e) => onCustomChange(e.target.value, to)}
            className="w-[170px] text-[14px]"
          />
        </div>
        <div>
          <label htmlFor="mrp-to" className="text-[13px] font-medium text-muted-foreground mb-1.5 block">
            납기 종료일
          </label>
          <Input
            id="mrp-to"
            type="date"
            value={to}
            onChange={(e) => onCustomChange(from, e.target.value)}
            className="w-[170px] text-[14px]"
          />
        </div>
        <p className="text-[13px] text-muted-foreground pb-2">
          {selection.mode === "ALL"
            ? "기간 없음: 현재 존재하는 모든 미출하 수주"
            : `납기 ${selectionLabel(selection)} (시작일·종료일 포함)`}
        </p>
      </div>
    </div>
  )
}
