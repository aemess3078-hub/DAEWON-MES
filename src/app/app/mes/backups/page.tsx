import { getBackupManagementData } from "@/lib/actions/backup.actions"
import { BackupManagementClient } from "./backup-management-client"

export const dynamic = "force-dynamic"

export default async function BackupManagementPage() {
  const data = await getBackupManagementData()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-foreground">
          백업관리
        </h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          MES 시스템 백업 상태를 확인합니다. 필요한 백업은 분류하거나 목록에서 숨길 수 있습니다.
        </p>
      </div>

      <BackupManagementClient data={data} />
    </div>
  )
}
