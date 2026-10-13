"use client"

import { useState } from "react"
import { DataTable } from "@/components/common/data-table"
import { getColumns, ProjectProgressRow } from "./columns"
import { ProjectProgressDetailSheet } from "./project-progress-detail-sheet"

interface ProjectProgressDataTableProps {
  data: ProjectProgressRow[]
}

export function ProjectProgressDataTable({ data }: ProjectProgressDataTableProps) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailProjectOrderId, setDetailProjectOrderId] = useState<string | null>(null)

  const handleViewDetail = (row: ProjectProgressRow) => {
    setDetailProjectOrderId(row.id)
    setDetailOpen(true)
  }

  const columns = getColumns(handleViewDetail)

  const filterableColumns = [
    {
      id: "status" as keyof ProjectProgressRow,
      title: "프로젝트 상태",
      options: [
        { label: "초안", value: "DRAFT" },
        { label: "수주확정", value: "CONFIRMED" },
        { label: "진행중", value: "IN_PROGRESS" },
        { label: "보류", value: "ON_HOLD" },
        { label: "완료", value: "COMPLETED" },
        { label: "취소", value: "CANCELLED" },
      ],
    },
    {
      id: "priority" as keyof ProjectProgressRow,
      title: "우선순위",
      options: [
        { label: "낮음", value: "LOW" },
        { label: "보통", value: "MEDIUM" },
        { label: "높음", value: "HIGH" },
      ],
    },
    {
      id: "delayStatus" as keyof ProjectProgressRow,
      title: "지연 여부",
      options: [
        { label: "정상", value: "NORMAL" },
        { label: "마감임박", value: "DUE_SOON" },
        { label: "지연", value: "DELAYED" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "code" as keyof ProjectProgressRow, title: "오더번호" },
          { id: "name" as keyof ProjectProgressRow, title: "프로젝트명" },
          { id: "customer" as keyof ProjectProgressRow, title: "거래처" },
        ]}
        filterableColumns={filterableColumns}
      />

      <ProjectProgressDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        projectOrderId={detailProjectOrderId}
      />
    </div>
  )
}
