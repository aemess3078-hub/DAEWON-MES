import { AuditLogTable } from "@/app/app/mes/users/audit-log-table"
import { getAuditLogs } from "@/lib/actions/user-management.actions"

export const dynamic = "force-dynamic"

export default async function AuditLogPage() {
  const initialData = await getAuditLogs({ days: 90, page: 1, pageSize: 20 })

  return (
    <main className="space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-[28px] font-semibold tracking-tight text-slate-950">감사로그</h1>
        <p className="text-[15px] text-slate-600">
          핵심 MES 변경 이력을 사용자, 업무 대상, 동작, 변경 전후 데이터 기준으로 확인합니다.
        </p>
      </div>
      <AuditLogTable initialData={initialData} />
    </main>
  )
}
