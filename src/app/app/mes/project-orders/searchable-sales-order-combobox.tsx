"use client"

import { useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

// §5/§17: SearchableItemCombobox(공용 컴포넌트)와 상호작용 패턴(Popover+검색+
// 키보드 탐색+선택없음 메시지)은 동일하게 맞추되, orderNo/거래처명 형태의 다른
// 데이터 모양이라 별도 최소 컴포넌트로 둔다 — 공용 컴포넌트를 억지로 제네릭하게
// 리팩토링하지 않는다(불필요한 공통 리팩토링 금지).

export type SearchableSalesOrderOption = {
  id: string
  orderNo: string
  customer: { name: string }
}

interface SearchableSalesOrderComboboxProps {
  salesOrders: SearchableSalesOrderOption[]
  value: string
  onSelect: (salesOrderId: string) => void
  disabled?: boolean
  placeholder?: string
  searchPlaceholder?: string
  clearLabel?: string
}

export function SearchableSalesOrderCombobox({
  salesOrders,
  value,
  onSelect,
  disabled = false,
  placeholder = "연결할 수주 선택",
  searchPlaceholder = "수주번호 또는 거래처명 검색",
  clearLabel = "연결 안 함",
}: SearchableSalesOrderComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = salesOrders.find((so) => so.id === value)
  const normalizedSearch = search.trim().toLocaleLowerCase()

  const searchableOrders = useMemo(
    () =>
      salesOrders.map((so) => ({
        ...so,
        searchText: `${so.orderNo} ${so.customer.name}`.trim().toLocaleLowerCase(),
      })),
    [salesOrders],
  )
  const filteredOrders = useMemo(
    () =>
      normalizedSearch
        ? searchableOrders.filter((so) => so.searchText.includes(normalizedSearch))
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

  const chooseOrder = (salesOrderId: string) => {
    onSelect(salesOrderId)
    setOpen(false)
    setSearch("")
    setActiveIndex(0)
  }

  const clearSelection = () => chooseOrder("")

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
            {selected ? `[${selected.orderNo}] ${selected.customer.name}` : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-50 w-[max(var(--radix-popover-trigger-width),320px)] p-0"
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
                  const so = filteredOrders[activeIndex]
                  if (so) chooseOrder(so.id)
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  handleOpenChange(false)
                }
              }}
            />
          </div>
          <div role="listbox" className="max-h-[300px] overflow-y-auto p-1">
            <button
              type="button"
              onClick={clearSelection}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[14px] text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
            >
              <Check className={cn("h-4 w-4 shrink-0", value === "" ? "opacity-100" : "opacity-0")} />
              {clearLabel}
            </button>
            {filteredOrders.length === 0 && (
              <p className="py-5 text-center text-[13px] text-muted-foreground">검색 결과가 없습니다.</p>
            )}
            {filteredOrders.map((so, index) => {
              const active = index === activeIndex
              return (
                <button
                  key={so.id}
                  type="button"
                  role="option"
                  aria-selected={so.id === value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseOrder(so.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[14px] outline-none cursor-pointer",
                    active && "bg-accent text-accent-foreground",
                    "hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Check className={cn("h-4 w-4 shrink-0", so.id === value ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-muted-foreground">[{so.orderNo}]</span> {so.customer.name}
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
