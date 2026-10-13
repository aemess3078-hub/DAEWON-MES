export const dynamic = "force-dynamic"

import { getProjectProgressList } from "@/lib/actions/project-stage.actions"
import { getOpenProjectIssueCounts } from "@/lib/actions/project-issue.actions"
import { ProjectProgressDataTable } from "./project-progress-data-table"

export default async function ProjectProgressPage() {
  const [projectsRaw, openIssueCounts] = await Promise.all([
    getProjectProgressList(),
    getOpenProjectIssueCounts(),
  ])
  const projects = projectsRaw.map((p) => ({ ...p, openIssueCount: openIssueCounts[p.id] ?? 0 }))

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[26px] font-bold leading-tight">프로젝트 진행현황</h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          프로젝트 오더별 단계 완료율과 납기를 관리합니다
        </p>
      </div>
      <ProjectProgressDataTable data={projects} />
    </div>
  )
}
