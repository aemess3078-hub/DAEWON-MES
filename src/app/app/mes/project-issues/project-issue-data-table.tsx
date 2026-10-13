"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/common/data-table"
import { getColumns, ProjectIssueRow } from "./columns"
import { ProjectIssueDetailSheet } from "./issue-detail-sheet"
import { IssueFormDialog } from "./issue-form-dialog"

interface ProjectIssueDataTableProps {
  data: ProjectIssueRow[]
}

export function ProjectIssueDataTable({ data }: ProjectIssueDataTableProps) {
  const router = useRouter()
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailIssueId, setDetailIssueId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const handleViewDetail = (row: ProjectIssueRow) => {
    setDetailIssueId(row.id)
    setDetailOpen(true)
  }

  const columns = getColumns(handleViewDetail)

  // §17: 담당자 필터 옵션은 고정 enum이 아니라 실제 데이터에 등장하는 담당자
  // 목록에서 동적으로 만든다(미지정 포함).
  const assigneeOptions = useMemo(() => {
    const names = new Set<string>()
    data.forEach((row) => names.add(row.assignee?.name ?? "미지정"))
    return Array.from(names)
      .sort((a, b) => a.localeCompare(b, "ko"))
      .map((name) => ({ label: name, value: name }))
  }, [data])

  const filterableColumns = [
    {
      id: "type" as keyof ProjectIssueRow,
      title: "유형",
      options: [
        { label: "이슈", value: "ISSUE" },
        { label: "리스크", value: "RISK" },
      ],
    },
    {
      id: "severity" as keyof ProjectIssueRow,
      title: "중요도",
      options: [
        { label: "낮음", value: "LOW" },
        { label: "보통", value: "MEDIUM" },
        { label: "높음", value: "HIGH" },
        { label: "긴급", value: "CRITICAL" },
      ],
    },
    {
      id: "status" as keyof ProjectIssueRow,
      title: "상태",
      options: [
        { label: "미조치", value: "OPEN" },
        { label: "조치중", value: "IN_PROGRESS" },
        { label: "해결완료", value: "RESOLVED" },
      ],
    },
    {
      id: "assignee" as keyof ProjectIssueRow,
      title: "담당자",
      options: assigneeOptions,
    },
    {
      id: "delayStatus" as keyof ProjectIssueRow,
      title: "지연 여부",
      options: [
        { label: "일정없음", value: "NO_DUE_DATE" },
        { label: "완료", value: "RESOLVED" },
        { label: "정상", value: "NORMAL" },
        { label: "마감임박", value: "DUE_SOON" },
        { label: "지연", value: "DELAYED" },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" />
          이슈 등록
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchableColumns={[
          { id: "code" as keyof ProjectIssueRow, title: "이슈번호" },
          { id: "title" as keyof ProjectIssueRow, title: "제목" },
          { id: "projectOrderCode" as keyof ProjectIssueRow, title: "오더번호" },
          { id: "projectName" as keyof ProjectIssueRow, title: "프로젝트명" },
          { id: "customerName" as keyof ProjectIssueRow, title: "거래처" },
        ]}
        filterableColumns={filterableColumns}
      />

      <ProjectIssueDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        issueId={detailIssueId}
        onChanged={() => router.refresh()}
      />

      <IssueFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        onSuccess={() => {
          setCreateOpen(false)
          router.refresh()
        }}
      />
    </div>
  )
}
