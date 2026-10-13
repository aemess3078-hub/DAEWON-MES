import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { verifyAuthToken, NMES_SESSION_COOKIE } from '@/lib/jwt'

export async function GET(req: NextRequest) {
  const token = req.cookies.get(NMES_SESSION_COOKIE)?.value ?? null

  if (!token) {
    return NextResponse.json({ success: false, message: '인증이 필요합니다.' }, { status: 401 })
  }

  const payload = verifyAuthToken(token)
  if (!payload) {
    return NextResponse.json({ success: false, message: '세션이 만료되었습니다.' }, { status: 401 })
  }

  try {
    // DB에서 계정 상태 재확인
    const [credential, tenantUser] = await Promise.all([
      prisma.userCredential.findUnique({
        where: { profileId: payload.profileId },
        select: { isLocked: true, mustChangePw: true, loginId: true },
      }),
      prisma.tenantUser.findFirst({
        where: { profileId: payload.profileId, tenantId: payload.tenantId, isActive: true },
        select: { role: true, isActive: true },
      }),
    ])

    if (!credential || credential.isLocked) {
      return NextResponse.json({ success: false, message: '접근이 제한된 계정입니다.' }, { status: 403 })
    }

    if (!tenantUser) {
      return NextResponse.json({ success: false, message: '비활성화된 계정입니다.' }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      user: {
        profileId: payload.profileId,
        tenantId: payload.tenantId,
        loginId: credential.loginId,
        email: payload.email ?? null,
        name: payload.name,
        role: tenantUser.role,
        mustChangePw: credential.mustChangePw,
      },
    })
  } catch (err) {
    console.error('[/api/auth/me] DB 조회 중 오류:', err)
    return NextResponse.json(
      { success: false, message: '서버 오류가 발생했습니다.' },
      { status: 500 },
    )
  }
}
