"use server"

import { prisma } from "@/lib/db/prisma"
import { requireResourcePermission } from "@/lib/auth/role-permissions"
import {
  executeProductSearchRequest,
  executeSimulationRequest,
  type SimulationPayload,
  type SimulationProductSearchResult,
} from "@/lib/services/mrp-simulation.service"

/**
 * 품목별 What-if 시뮬레이션 (읽기 전용 — DB write 없음).
 *
 * 권한: MRP READ. 이 액션은 어떤 데이터도 생성/수정/예약하지 않고 조회와 메모리 계산만 하므로
 * 기존 수주기준 MRP 조회와 같은 READ 권한으로 충분하다.
 * tenantId 는 인증 컨텍스트에서만 결정하며 입력으로 받지 않는다(요청 본문의 tenantId 는 무시).
 */
export async function runMrpSimulation(input: {
  items: Array<{ itemId: string; qty: number }>
}): Promise<SimulationPayload> {
  return executeSimulationRequest(
    { authorize: () => requireResourcePermission("MRP", "READ"), db: prisma },
    input
  )
}

/** 시뮬레이션 대상 제품 검색(최대 20건, tenant 한정, 코드/이름) */
export async function searchSimulationProducts(query: string): Promise<SimulationProductSearchResult> {
  return executeProductSearchRequest(
    { authorize: () => requireResourcePermission("MRP", "READ"), db: prisma },
    query
  )
}
