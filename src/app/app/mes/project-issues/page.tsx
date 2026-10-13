export const dynamic = "force-dynamic"

import { getProjectIssueList } from "@/lib/actions/project-issue.actions"
import { ProjectIssueDataTable } from "./project-issue-data-table"

export default async function ProjectIssuesPage() {
  const issues = await getProjectIssueList()

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">이슈 관리</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          프로젝트 수행 중 발생한 문제/리스크를 등록하고 조치 진행 상황을 관리합니다
        </p>
      </div>
      <ProjectIssueDataTable data={issues} />
    </div>
  )
}
