"use client"

import { useState } from "react"
import { CodeGroupWithCodes } from "@/lib/actions/common-code.actions"
import { CodeGroupList } from "./code-group-list"
import { CodeDetailPanel } from "./code-detail-panel"

type Props = {
  groups: CodeGroupWithCodes[]
  tenantId: string
}

export function CommonCodeManager({ groups, tenantId }: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    groups[0]?.id ?? null
  )

  const selectedGroup = groups.find((g) => g.id === selectedGroupId) ?? null

  return (
    <div className="flex gap-6 h-[calc(100vh-200px)]">
      {/* 좌측: 그룹 목록 (고정 너비) */}
      <div className="w-72 shrink-0">
        <CodeGroupList
          groups={groups}
          selectedGroupId={selectedGroupId}
          onSelect={setSelectedGroupId}
          tenantId={tenantId}
        />
      </div>
      {/* 우측: 코드 상세 */}
      <div className="flex-1 overflow-hidden">
        {selectedGroup ? (
          <CodeDetailPanel group={selectedGroup} />
        ) : (
          <div className="flex items-center justify-center h-full text-[14px] text-muted-foreground border rounded-lg">
            좌측에서 코드 그룹을 선택하세요
          </div>
        )}
      </div>
    </div>
  )
}
