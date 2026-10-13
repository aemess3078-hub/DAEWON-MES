"use client"

import { useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// PR #51의 SearchableSalesOrderCombobox와 동일한 상호작용 패턴(Popover+검색+
// 키보드 탐색)을 따르되, 데이터 모양(오더번호/프로젝트명/거래처)이 달라 별도
// 최소 컴포넌트로 둔다 — 공용 컴포넌트를 억지로 제네릭화하지 않는다.

export type SearchableProjectOrderOption = {
  id: string
  code: string
  name: string
  customer: { name: string }
  item: { code: string; name: string }
}

interface SearchableProjectOrderComboboxProps {
  projectOrders: SearchableProjectOrderOption[]
  value: string
  onSelect: (projectOrderId: string) => void
  disabled?: boolean
  placeholder?: string
  searchPlaceholder?: string
}

export function SearchableProjectOrderCombobox({
  projectOrders,
  value,
  onSelect,
  disabled = false,
  placeholder = "프로젝트 선택",
  searchPlaceholder = "프로젝트번호, 프로젝트명 또는 거래처명 검색",
}: SearchableProjectOrderComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = projectOrders.find((p) => p.id === value)
  const normalizedSearch = search.trim().toLocaleLowerCase()

  const searchableOrders = useMemo(
    () =>
      projectOrders.map((p) => ({
        ...p,
        searchText: `${p.code} ${p.name} ${p.customer.name}`.trim().toLocaleLowerCase(),
      })),
    [projectOrders],
  )
  const filteredOrders = useMemo(
    () =>
      normalizedSearch
        ? searchableOrders.filter((p) => p.searchText.includes(normalizedSearch))
        : searchableOrders,
    [searchableOrders, normalizedSearch],
  )

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    setSearch("")
    setActiveIndex(0)
    if (nextOpen) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const chooseOrder = (projectOrderId: string) => {
    onSelect(projectOrderId)
    setOpen(false)
    setSearch("")
    setActiveIndex(0)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="min-w-0 truncate text-left">
            {selected ? `[${selected.code}] ${selected.name} · ${selected.customer.name}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-50 w-[max(var(--radix-popover-trigger-width),360px)] p-0"
        align="start"
      >
        <div>
          <div className="border-b p-2">
            <Input
              ref={inputRef}
              value={search}
              placeholder={searchPlaceholder}
              className="h-9 text-[14px]"
              onChange={(event) => {
                setSearch(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault()
                  setActiveIndex((current) => Math.min(current + 1, Math.max(filteredOrders.length - 1, 0)))
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setActiveIndex((current) => Math.max(current - 1, 0))
                } else if (event.key === "Enter") {
                  event.preventDefault()
                  const p = filteredOrders[activeIndex]
                  if (p) chooseOrder(p.id)
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  handleOpenChange(false)
                }
              }}
            />
          </div>
          <div role="listbox" className="max-h-[300px] overflow-y-auto p-1">
            {filteredOrders.length === 0 && (
              <p className="py-5 text-center text-[13px] text-muted-foreground">검색 결과가 없습니다.</p>
            )}
            {filteredOrders.map((p, index) => {
              const active = index === activeIndex
              return (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={p.id === value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseOrder(p.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[14px] outline-none cursor-pointer",
                    active && "bg-accent text-accent-foreground",
                    "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Check className={cn("h-4 w-4 shrink-0", p.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-muted-foreground">[{p.code}]</span> {p.name}
                    <span className="text-muted-foreground"> · {p.customer.name} · {p.item.code}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
