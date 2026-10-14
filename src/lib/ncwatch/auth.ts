import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { hashAgentKey, isPresentableAgentKey, isStoredAgentKeyHash } from "./agent-key"

export type AgentAuthContext = {
  tenantId:  string
  siteId:    string
  gatewayId: string
}

// X-Agent-Key 헤더 → EdgeGateway.apiKey(해시) 조회 → tenantId/siteId 확정
// 클라이언트 payload의 tenant 정보를 신뢰하지 않는다.
export async function verifyAgentKey(
  request: NextRequest
): Promise<AgentAuthContext | null> {
  const key = request.headers.get("X-Agent-Key")
  if (!isPresentableAgentKey(key)) return null

  try {
    // 1) 해시 저장 행(신규 발급 키)
    const hashed = await prisma.edgeGateway.findUnique({
      where:  { apiKey: hashAgentKey(key) },
      select: { id: true, tenantId: true, siteId: true },
    })
    if (hashed) {
      return { tenantId: hashed.tenantId, siteId: hashed.siteId, gatewayId: hashed.id }
    }

    // 2) 과거 평문 저장 행(읽기 호환). 해시 형식 값은 키로 인정하지 않는다.
    const legacy = await prisma.edgeGateway.findUnique({
      where:  { apiKey: key },
      select: { id: true, tenantId: true, siteId: true, apiKey: true },
    })
    if (!legacy || isStoredAgentKeyHash(legacy.apiKey)) return null

    // 사용 시점에 해시로 전환(best-effort — 실패해도 인증은 유지)
    await prisma.edgeGateway
      .update({ where: { id: legacy.id }, data: { apiKey: hashAgentKey(key) } })
      .catch(() => {})

    return { tenantId: legacy.tenantId, siteId: legacy.siteId, gatewayId: legacy.id }
  } catch {
    return null
  }
}
