"use client"

import { useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type SearchableItemOption = {
  id: string
  code: string
  name: string
  itemType: string
}

interface SearchableItemComboboxProps {
  items: SearchableItemOption[]
  value: string
  onSelect: (itemId: string) => void
  disabled?: boolean
  disabledItemIds?: Set<string>
  placeholder?: string
  searchPlaceholder?: string
  triggerClassName?: string
  /** true면 목록 맨 위에 선택 해제용 행을 고정 노출한다(onSelect("")를 호출). */
  allowClear?: boolean
  clearLabel?: string
}

const EMPTY_DISABLED_ITEM_IDS = new Set<string>()

const itemTypeLabels: Record<string, string> = {
  RAW_MATERIAL: "원자재",
  SEMI_FINISHED: "반제품",
  FINISHED: "완제품",
  CONSUMABLE: "소모품",
}

function getItemTypeLabel(itemType: string) {
  return itemTypeLabels[itemType] ?? itemType
}

export function SearchableItemCombobox({
  items,
  value,
  onSelect,
  disabled = false,
  disabledItemIds = EMPTY_DISABLED_ITEM_IDS,
  placeholder = "품목 선택",
  searchPlaceholder = "품목코드, 품목명 또는 유형 검색",
  triggerClassName,
  allowClear = false,
  clearLabel = "선택 안 함",
}: SearchableItemComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedItem = items.find((item) => item.id === value)
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const searchableItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        searchText: `${item.code} ${item.name} ${getItemTypeLabel(item.itemType)} ${item.itemType} ${item.itemType.replaceAll("_", " ")}`
          .trim()
          .toLocaleLowerCase(),
      })),
    [items],
  )
  const filteredItems = useMemo(
    () =>
      normalizedSearch
        ? searchableItems.filter((item) => item.searchText.includes(normalizedSearch))
        : searchableItems,
    [searchableItems, normalizedSearch],
  )
  const selectableItems = filteredItems.filter((item) => !disabledItemIds.has(item.id))

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    setSearch("")
    setActiveIndex(0)
    if (nextOpen) {
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const chooseItem = (itemId: string) => {
    if (disabledItemIds.has(itemId)) return
    onSelect(itemId)
    setOpen(false)
    setSearch("")
    setActiveIndex(0)
  }

  const clearSelection = () => {
    onSelect("")
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
          className={cn(
            "w-full justify-between font-normal",
            triggerClassName,
          )}
        >
          <span className="min-w-0 truncate text-left">
            {selectedItem
              ? `[${selectedItem.code}] ${selectedItem.name} (${getItemTypeLabel(selectedItem.itemType)})`
              : placeholder}
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
                  setActiveIndex((current) =>
                    Math.min(current + 1, Math.max(selectableItems.length - 1, 0)),
                  )
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  setActiveIndex((current) => Math.max(current - 1, 0))
                } else if (event.key === "Enter") {
                  event.preventDefault()
                  const item = selectableItems[activeIndex]
                  if (item) chooseItem(item.id)
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  handleOpenChange(false)
                }
              }}
            />
          </div>
          <div role="listbox" className="max-h-[300px] overflow-y-auto p-1">
            {allowClear && (
              <button
                type="button"
                onClick={clearSelection}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[14px] text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground"
              >
                <Check className={cn("h-4 w-4 shrink-0", value === "" ? "opacity-100" : "opacity-0")} />
                {clearLabel}
              </button>
            )}
            {filteredItems.length === 0 && (
              <p className="py-5 text-center text-[13px] text-muted-foreground">
                검색 결과가 없습니다.
              </p>
            )}
            {filteredItems.map((item) => {
              const itemDisabled = disabledItemIds.has(item.id)
              const selectableIndex = selectableItems.findIndex(
                (selectableItem) => selectableItem.id === item.id,
              )
              const active = selectableIndex === activeIndex && !itemDisabled
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={item.id === value}
                  disabled={itemDisabled}
                  onMouseEnter={() => {
                    if (selectableIndex >= 0) setActiveIndex(selectableIndex)
                  }}
                  onClick={() => chooseItem(item.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-[14px] outline-none",
                    active && "bg-accent text-accent-foreground",
                    itemDisabled
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      item.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono text-muted-foreground">[{item.code}]</span>{" "}
                    {item.name} ({getItemTypeLabel(item.itemType)})
                  </span>
                  {itemDisabled && (
                    <span className="shrink-0 text-[13px] text-muted-foreground">
                      이미 선택됨
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
