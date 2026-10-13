import { NextRequest, NextResponse } from 'next/server'
import { verifyAuthToken, NMES_SESSION_COOKIE } from '@/lib/jwt'
import { createLoginHistoryLog, extractClientIp } from '@/lib/login-history'

export async function POST(req: NextRequest) {
  const token = req.cookies.get(NMES_SESSION_COOKIE)?.value ?? null
  const ip = extractClientIp(req)
  const ua = req.headers.get('user-agent') ?? null

  if (token) {
    const payload = verifyAuthToken(token)
    if (payload) {
      await createLoginHistoryLog({
        tenantId: payload.tenantId,
        loginId: payload.loginId,
        profileId: payload.profileId,
        eventType: 'LOGOUT',
        ipAddress: ip,
        userAgent: ua,
      }).catch(() => {
        // 로그아웃 기록 저장 실패는 무시 — 세션 정리가 우선
      })
    }
  }

  const res = NextResponse.json({ success: true })
  res.cookies.set(NMES_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  res.cookies.set('nmes-mode', '', {
    path: '/',
    maxAge: 0,
  })

  return res
}
