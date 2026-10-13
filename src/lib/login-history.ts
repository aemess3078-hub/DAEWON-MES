import { prisma } from '@/lib/db/prisma'
import type { LoginEventType, LoginFailReason } from '@prisma/client'
import type { NextRequest } from 'next/server'

interface CreateLoginHistoryParams {
  tenantId: string
  loginId: string
  profileId?: string | null
  eventType: LoginEventType
  failReason?: LoginFailReason | null
  ipAddress?: string | null
  userAgent?: string | null
}

export function extractClientIp(req: NextRequest): string | null {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  )
}

export async function createLoginHistoryLog(
  params: CreateLoginHistoryParams,
): Promise<void> {
  // 로그 저장 실패가 로그인 자체를 막으면 안 된다.
  // P2021(테이블 미존재) / P2003(FK 오류) 등은 silent skip.
  try {
    await prisma.loginHistory.create({
      data: {
        tenantId: params.tenantId,
        loginId: params.loginId,
        profileId: params.profileId ?? null,
        eventType: params.eventType,
        failReason: params.failReason ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent ?? null,
      },
    })
  } catch (e) {
    console.warn("[LOGIN_HISTORY] 로그 저장 실패 (로그인 차단하지 않음):", {
      loginId: params.loginId,
      eventType: params.eventType,
      error: e instanceof Error ? `${(e as any).code ?? ""} ${e.message.split("\n")[0]}` : String(e),
    })
  }
}
