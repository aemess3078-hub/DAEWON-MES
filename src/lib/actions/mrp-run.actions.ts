"use server"

import { prisma } from "@/lib/db/prisma"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  getMrpRunDetail,
  listMrpRuns,
  saveMrpRun,
  type MrpRunDetailResult,
  type MrpRunListResult,
  type SaveMrpRunResult,
} from "@/lib/services/mrp-run.service"

/**
 * MRP 실행이력 / Snapshot (Phase 6)
 *
 * 저장: MRP CREATE — 명시적 "MRP 실행 저장" 동작에서만 Snapshot 을 만든다(조회/SSR 은 아무것도 쓰지 않는다).
 *       서버가 입력 파라미터(기간/DRAFT 수주 포함 여부)로 MRP 를 다시 계산해 저장하며, 클라이언트가 보낸 결과는 사용하지 않는다.
 * 목록/상세: MRP READ — 저장된 값을 보여 주며 재계산하지 않는다. 다른 tenant 의 실행 id 는 존재하지 않는 것과 같다.
 * tenantId 는 인증 컨텍스트에서만 결정하며 입력으로 받지 않는다. 삭제/수정 기능은 제공하지 않는다.
 */
export async function saveOrderMrpRun(input: {
  from?: string | null
  to?: string | null
  includeDraft?: boolean
  requestKey?: string | null
}): Promise<SaveMrpRunResult> {
  return saveMrpRun(
    {
      authorize: async () => {
        const user = await requireResourcePermission("MRP", "CREATE")
        return { id: user.id, name: user.name, tenantId: user.tenantId }
      },
      db: prisma,
    },
    input
  )
}

export async function listOrderMrpRuns(input?: { page?: number; pageSize?: number }): Promise<MrpRunListResult> {
  return listMrpRuns(
    {
      authorize: async () => {
        const user = await requireResourcePermission("MRP", "READ")
        return { tenantId: user.tenantId }
      },
      db: prisma,
    },
    input
  )
}

export async function getOrderMrpRun(runId: string): Promise<MrpRunDetailResult> {
  return getMrpRunDetail(
    {
      authorize: async () => {
        const user = await requireResourcePermission("MRP", "READ")
        return { tenantId: user.tenantId }
      },
      db: prisma,
    },
    runId
  )
}
