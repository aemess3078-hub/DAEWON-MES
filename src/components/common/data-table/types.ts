import * as React from "react"
import type { RowData } from "@tanstack/react-table"

export interface DataTableFilterOption {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
}

export interface DataTableSearchableColumn<TData> {
  id: keyof TData & string
  title: string
}

export interface DataTableFilterableColumn<TData> {
  id: keyof TData & string
  title: string
  options: DataTableFilterOption[]
}

// 컬럼 정렬·너비 옵션. 설정하지 않은 화면은 기존 동작(좌측 정렬, 자동 너비)을 그대로 유지한다.
declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right" | "center"
    width?: number
    minWidth?: number
  }
}
