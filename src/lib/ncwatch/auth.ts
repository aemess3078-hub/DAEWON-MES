import { NextRequest } from "next/server"
import { prisma } from "@/lib/db/prisma"

export type AgentAuthContext = {
  tenantId:  string
  siteId:    string
  gatewayId: string
}

// X-Agent-Key 헤더 → EdgeGateway.apiKey 조회 → tenantId/siteId 확정
// 클라이언트 payload의 tenant 정보를 신뢰하지 않는다.
export async function verifyAgentKey(
  request: NextRequest
): Promise<AgentAuthContext | null> {
  const key = request.headers.get("X-Agent-Key")
  if (!key) return null

  try {
    const gateway = await prisma.edgeGateway.findUnique({
      where:  { apiKey: key },
      select: { id: true, tenantId: true, siteId: true },
    })
    if (!gateway) return null

    return {
      tenantId:  gateway.tenantId,
      siteId:    gateway.siteId,
      gatewayId: gateway.id,
    }
  } catch {
    return null
  }
}
