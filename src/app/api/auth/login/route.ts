import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { verifyPassword } from '@/lib/password'
import { signAuthToken, NMES_SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from '@/lib/jwt'
import { createLoginHistoryLog, extractClientIp } from '@/lib/login-history'
import { LOGIN_FAIL_LOCK_THRESHOLD, isAutoLockExpired, isLoginIpThrottled } from '@/lib/login-lock'
// NMES 데모 테넌트 fallback 은 개발 환경에서만 허용한다. 운영에서 환경변수가 없으면 로그인 요청 시 오류 응답.
function resolveLoginTenantId(): string {
  return process.env.DEFAULT_TENANT_ID || (process.env.NODE_ENV === 'production' ? '' : 'tenant-demo-001')
}

const GENERIC_FAIL_MESSAGE = '아이디 또는 비밀번호가 올바르지 않습니다.'

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req)
  const ua = req.headers.get('user-agent') ?? null

  let body: { loginId?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, message: '잘못된 요청 형식입니다.' }, { status: 400 })
  }

  const { loginId, password } = body
  const normalizedLoginId = loginId?.trim().toLowerCase()
  if (!normalizedLoginId || !password) {
    return NextResponse.json(
      { success: false, message: 'loginId와 password는 필수 입력값입니다.' },
      { status: 400 },
    )
  }

  const tenantId = resolveLoginTenantId()
  if (!tenantId) {
    console.error('[auth/login] DEFAULT_TENANT_ID 환경변수가 설정되지 않았습니다.')
    return NextResponse.json(
      { success: false, message: '서버 설정 오류가 발생했습니다. 관리자에게 문의해 주세요.' },
      { status: 500 },
    )
  }

  // 같은 IP 에서 최근 실패가 한도를 넘으면 계정/잠금 상태를 드러내지 않고 일반 실패 응답만 반환한다(이력·카운트도 남기지 않음).
  if (await isLoginIpThrottled(tenantId, ip)) {
    return NextResponse.json({ success: false, message: GENERIC_FAIL_MESSAGE }, { status: 401 })
  }

  try {
    // UserCredential 조회 (Profile, TenantUser 포함)
    let credential = await prisma.userCredential.findUnique({
      where: { tenantId_loginId: { tenantId, loginId: normalizedLoginId } },
      include: {
        profile: true,
      },
    })

    if (!credential) {
      await createLoginHistoryLog({ tenantId, loginId: normalizedLoginId, eventType: 'LOGIN_FAIL', failReason: 'USER_NOT_FOUND', ipAddress: ip, userAgent: ua })
      return NextResponse.json({ success: false, message: GENERIC_FAIL_MESSAGE }, { status: 401 })
    }

    // 잠금 여부 확인
    //  - 로그인 실패 자동 잠금(서명: isLocked + lockedAt + failCount>=임계치)은 cooldown 이후 다시 시도할 수 있다.
    //  - 그 외 잠금(관리자 수동 등)은 시간이 지나도 풀리지 않는다.
    //  - 어느 쪽이든 응답으로 잠금 여부/남은 시간을 드러내지 않고 일반 실패 메시지를 반환한다.
    if (credential.isLocked) {
      if (isAutoLockExpired(credential)) {
        await prisma.userCredential.update({
          where: { id: credential.id },
          data: { isLocked: false, failCount: 0, lockedAt: null },
        })
        credential = { ...credential, isLocked: false, failCount: 0, lockedAt: null }
      } else {
        await createLoginHistoryLog({ tenantId, loginId: normalizedLoginId, profileId: credential.profileId, eventType: 'LOGIN_FAIL', failReason: 'LOCKED', ipAddress: ip, userAgent: ua })
        return NextResponse.json({ success: false, message: GENERIC_FAIL_MESSAGE }, { status: 401 })
      }
    }

    // TenantUser 조회 및 활성 확인
    const tenantUser = await prisma.tenantUser.findFirst({
      where: { profileId: credential.profileId, tenantId, isActive: true },
    })

    if (!tenantUser) {
      await createLoginHistoryLog({ tenantId, loginId: normalizedLoginId, profileId: credential.profileId, eventType: 'LOGIN_FAIL', failReason: 'INACTIVE', ipAddress: ip, userAgent: ua })
      return NextResponse.json({ success: false, message: '비활성화된 계정입니다. 관리자에게 문의해 주세요.' }, { status: 403 })
    }

    // 비밀번호 검증
    const isPasswordValid = await verifyPassword(password, credential.passwordHash)

    if (!isPasswordValid) {
      const newFailCount = credential.failCount + 1
      const shouldLock = newFailCount >= LOGIN_FAIL_LOCK_THRESHOLD

      await prisma.userCredential.update({
        where: { id: credential.id },
        data: {
          failCount: newFailCount,
          isLocked: shouldLock,
          lockedAt: shouldLock ? new Date() : undefined,
        },
      })

      await createLoginHistoryLog({ tenantId, loginId: normalizedLoginId, profileId: credential.profileId, eventType: 'LOGIN_FAIL', failReason: 'INVALID_PASSWORD', ipAddress: ip, userAgent: ua })

      return NextResponse.json({ success: false, message: GENERIC_FAIL_MESSAGE }, { status: 401 })
    }

    // 로그인 성공 — failCount 초기화
    await prisma.userCredential.update({
      where: { id: credential.id },
      data: { failCount: 0, isLocked: false, lockedAt: null },
    })

    const payload = {
      profileId: credential.profileId,
      tenantId,
      loginId: normalizedLoginId,
      email: credential.profile.email ?? null,
      name: credential.profile.name,
      role: tenantUser.role,
      mustChangePw: credential.mustChangePw,
    }

    let token: string
    try {
      token = signAuthToken(payload)
    } catch (jwtErr) {
      console.error('[/api/auth/login] JWT 서명 실패 — JWT_SECRET이 설정되지 않았을 수 있습니다:', jwtErr)
      return NextResponse.json(
        { success: false, message: '서버 설정 오류가 발생했습니다. 관리자에게 문의해 주세요.' },
        { status: 500 },
      )
    }

    await createLoginHistoryLog({ tenantId, loginId: normalizedLoginId, profileId: credential.profileId, eventType: 'LOGIN_SUCCESS', ipAddress: ip, userAgent: ua })

    const res = NextResponse.json({
      success: true,
      user: {
        profileId: payload.profileId,
        tenantId: payload.tenantId,
        loginId: payload.loginId,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        mustChangePw: payload.mustChangePw,
      },
    })

    res.cookies.set(NMES_SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS)

    return res
  } catch (err) {
    console.error('[/api/auth/login] 처리 중 예상치 못한 오류:', err)
    return NextResponse.json(
      { success: false, message: '로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 },
    )
  }
}
