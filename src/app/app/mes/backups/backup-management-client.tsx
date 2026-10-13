"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, FolderClosed, Plus, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useUserRole } from "@/lib/contexts/user-role-context"
import { hideBackup, unhideBackup, type BackupManagementData, type HiddenBackupRow } from "@/lib/actions/backup.actions"
import { backupStatusLabel, backupTypeLabel, formatBackupDateTimeKst } from "@/lib/actions/backup.helpers"
import { BackupGroupFormSheet } from "./backup-group-form-sheet"
import { BackupGroupDetailSheet } from "./backup-group-detail-sheet"

function statusBadgeClass(status: string | null): string {
  if (status === "COMPLETED") return "bg-green-100 text-green-800"
  if (status === "FAILED") return "bg-red-100 text-red-700"
  if (status === "PENDING") return "bg-blue-100 text-blue-700"
  return "bg-slate-100 text-slate-700"
}

type BackupItem = BackupManagementData["visibleBackups"][number]

interface BackupManagementClientProps {
  data: BackupManagementData
}

export function BackupManagementClient({ data }: BackupManagementClientProps) {
  const router = useRouter()
  const role = useUserRole()
  const canMutate = role !== "VIEWER"

  const [registerOpen, setRegisterOpen] = useState(false)
  const [detailGroupId, setDetailGroupId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  function openDetail(groupId: string) {
    setDetailGroupId(groupId)
    setDetailOpen(true)
  }

  async function handleHide(backup: BackupItem) {
    if (!confirm("이 백업을 화면 목록에서 숨기시겠습니까? 실제 백업은 삭제되지 않습니다.")) return
    const res = await hideBackup(backup.externalBackupId)
    if (!res.ok) {
      alert(res.error ?? "처리 중 오류가 발생했습니다.")
      return
    }
    router.refresh()
  }

  async function handleUnhide(backup: HiddenBackupRow) {
    const res = await unhideBackup(backup.externalBackupId)
    if (!res.ok) {
      alert(res.error ?? "처리 중 오류가 발생했습니다.")
      return
    }
    router.refresh()
  }

  const latestAttempt = data.summary.mostRecentBackupAt
    ? `${formatBackupDateTimeKst(data.summary.mostRecentBackupAt)} · ${backupStatusLabel(data.summary.mostRecentBackupStatus)}`
    : data.available
      ? "-"
      : "조회 불가"

  return (
    <div className="space-y-6">
      {!data.available && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 flex items-center gap-2 text-[14px] text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          백업 상태를 확인하지 못했습니다. 잠시 후 다시 확인해 주세요. 백업 분류와 숨김 설정은 그대로 유지됩니다.
        </div>
      )}

      <div className="rounded-lg border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        MES 시스템 백업 상태를 확인합니다. 필요한 백업은 분류하거나 목록에서 숨길 수 있습니다. 생산·품질 문서의 첨부파일 관리와는 별도 기능입니다.
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard label="전체 백업" value={data.available && data.summary.totalBackups !== null ? `${data.summary.totalBackups}건` : "조회 불가"} />
        <SummaryCard label="표시 백업 수" value={data.available && data.summary.visibleBackups !== null ? `${data.summary.visibleBackups}건` : "조회 불가"} />
        <SummaryCard label="숨김 백업 수" value={data.available && data.summary.hiddenBackups !== null ? `${data.summary.hiddenBackups}건` : "조회 불가"} />
        <SummaryCard label="백업 오류" value={data.available && data.summary.failedBackups !== null ? `${data.summary.failedBackups}건` : "조회 불가"} />
        <SummaryCard label="최근 백업" value={latestAttempt} />
        <SummaryCard
          label="최근 정상 백업"
          value={data.summary.mostRecentSuccessfulBackupAt ? formatBackupDateTimeKst(data.summary.mostRecentSuccessfulBackupAt) : data.available ? "-" : "조회 불가"}
        />
        <SummaryCard label="마지막 확인" value={formatBackupDateTimeKst(data.checkedAt)} />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[15px] font-medium text-foreground">
          백업 분류 <span className="text-muted-foreground font-normal">({data.groups.length}개)</span>
        </p>
        {canMutate && (
          <Button size="sm" onClick={() => setRegisterOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" />
            분류 만들기
          </Button>
        )}
      </div>

      {data.groups.length === 0 ? (
        <EmptyBox message="등록된 백업 분류가 없습니다." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.groups.map((g) => (
            <button
              key={g.id}
              onClick={() => openDetail(g.id)}
              className="rounded-lg border bg-card p-4 text-left hover:border-primary/50 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-3">
                <div className="p-2 bg-amber-50 rounded-lg shrink-0">
                  <FolderClosed className="h-5 w-5 text-amber-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-foreground truncate">{g.name}</p>
                  <p className="text-[12px] text-muted-foreground mt-0.5">{g.memberCount}건 포함</p>
                  {g.description && <p className="text-[12px] text-muted-foreground mt-1 truncate">{g.description}</p>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <p className="text-[15px] font-medium text-foreground">
          분류되지 않은 백업 <span className="text-muted-foreground font-normal">({data.unclassified.length}건)</span>
        </p>
        {!data.available ? (
          <EmptyBox message="현재 백업 정보를 확인할 수 없습니다." />
        ) : data.unclassified.length === 0 ? (
          <EmptyBox message="분류되지 않은 백업이 없습니다." />
        ) : (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 px-4 font-medium">백업일시</th>
                  <th className="py-2 px-4 font-medium">상태</th>
                  <th className="py-2 px-4 font-medium">유형</th>
                  <th className="py-2 px-4 font-medium">작업</th>
                </tr>
              </thead>
              <tbody>
                {data.unclassified.map((b) => (
                  <tr key={b.externalBackupId} className="border-b last:border-0">
                    <td className="py-2 px-4 whitespace-nowrap">{formatBackupDateTimeKst(b.insertedAt)}</td>
                    <td className="py-2 px-4">
                      <Badge className={`border-0 text-[11px] ${statusBadgeClass(b.status)}`}>
                        {backupStatusLabel(b.status)}
                      </Badge>
                    </td>
                    <td className="py-2 px-4">{backupTypeLabel(b.isPhysicalBackup)}</td>
                    <td className="py-2 px-4">
                      {canMutate && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-600 hover:bg-slate-50" onClick={() => handleHide(b)} title="목록에서 숨기기">
                          <EyeOff className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <p className="text-[15px] font-medium text-foreground">
          숨김 백업 <span className="text-muted-foreground font-normal">({data.hiddenBackups.length}건)</span>
        </p>
        {data.hiddenBackups.length === 0 ? (
          <EmptyBox message="숨김 처리된 백업이 없습니다." />
        ) : (
          <div className="rounded-lg border bg-card overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 px-4 font-medium">백업일시</th>
                  <th className="py-2 px-4 font-medium">상태</th>
                  <th className="py-2 px-4 font-medium">유형</th>
                  <th className="py-2 px-4 font-medium">숨김일시</th>
                  <th className="py-2 px-4 font-medium">작업</th>
                </tr>
              </thead>
              <tbody>
                {data.hiddenBackups.map((b) => (
                  <tr key={b.id} className="border-b last:border-0">
                    <td className="py-2 px-4 whitespace-nowrap">{b.sourceAvailable ? formatBackupDateTimeKst(b.insertedAt) : "확인 불가"}</td>
                    <td className="py-2 px-4">
                      <Badge className={`border-0 text-[11px] ${statusBadgeClass(b.status)}`}>
                        {b.sourceAvailable ? backupStatusLabel(b.status) : "현재 목록에 없음"}
                      </Badge>
                    </td>
                    <td className="py-2 px-4">{b.sourceAvailable ? backupTypeLabel(b.isPhysicalBackup) : "-"}</td>
                    <td className="py-2 px-4 whitespace-nowrap">{formatBackupDateTimeKst(b.hiddenAt)}</td>
                    <td className="py-2 px-4">
                      {canMutate && (
                        <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={() => handleUnhide(b)} title="다시 표시">
                          <Eye className="h-3.5 w-3.5" />
                          다시 표시
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BackupGroupFormSheet
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        mode="create"
        visibleBackups={data.visibleBackups}
        onSaved={() => router.refresh()}
      />

      <BackupGroupDetailSheet
        open={detailOpen}
        onOpenChange={setDetailOpen}
        groupId={detailGroupId}
        visibleBackups={data.visibleBackups}
        onChanged={() => router.refresh()}
      />
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-[20px] font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function EmptyBox({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 rounded-md border border-dashed text-[13px] text-muted-foreground">
      {message}
    </div>
  )
}
