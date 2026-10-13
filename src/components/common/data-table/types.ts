import * as React from "react"

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
