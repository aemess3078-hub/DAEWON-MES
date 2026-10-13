import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { verifyAgentKey } from "@/lib/ncwatch/auth"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  // ── 1. 인증 ──────────────────────────────────────────────────────────────
  const auth = await verifyAgentKey(request)
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const { gatewayId } = auth

  // ── 2. payload 파싱 (선택 필드, 실패해도 계속) ────────────────────────────
  let agentVersion: string | undefined
  let machineCount: number | undefined
  let uptime:       number | undefined

  try {
    const body = await request.json()
    agentVersion = typeof body.agentVersion === "string" ? body.agentVersion : undefined
    machineCount = typeof body.machineCount === "number" ? body.machineCount : undefined
    uptime       = typeof body.uptime       === "number" ? body.uptime       : undefined
  } catch {
    // heartbeat는 body 오류를 허용 (생존 신호만 확인)
  }

  // ── 3. EdgeGateway 생존 신호 갱신 ────────────────────────────────────────
  await prisma.edgeGateway.update({
    where: { id: gatewayId },
    data:  { status: "ONLINE", lastHeartbeat: new Date() },
  })

  return NextResponse.json({
    ok:          true,
    serverTime:  new Date().toISOString(),
    agentVersion,
    machineCount,
    uptime,
  })
}
