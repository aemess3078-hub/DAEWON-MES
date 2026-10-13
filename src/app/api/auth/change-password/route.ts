import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { verifyPassword, hashPassword } from '@/lib/password'
import { verifyAuthToken, NMES_SESSION_COOKIE } from '@/lib/jwt'

const PASSWORD_MIN_LENGTH = 8
const PASSWORD_STRENGTH_RE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/

export async function POST(req: NextRequest) {
  const token = req.cookies.get(NMES_SESSION_COOKIE)?.value ?? null

  if (!token) {
    return NextResponse.json({ success: false, message: '인증이 필요합니다.' }, { status: 401 })
  }

  const payload = verifyAuthToken(token)
  if (!payload) {
    return NextResponse.json({ success: false, message: '세션이 만료되었습니다.' }, { status: 401 })
  }

  let body: { currentPassword?: string; newPassword?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, message: '잘못된 요청 형식입니다.' }, { status: 400 })
  }

  const { currentPassword, newPassword } = body
  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { success: false, message: 'currentPassword와 newPassword는 필수 입력값입니다.' },
      { status: 400 },
    )
  }

  if (newPassword === currentPassword) {
    return NextResponse.json(
      { success: false, message: '새 비밀번호는 현재(임시) 비밀번호와 달라야 합니다. 다른 비밀번호를 입력해 주세요.' },
      { status: 400 },
    )
  }

  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json(
      { success: false, message: `새 비밀번호는 최소 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.` },
      { status: 400 },
    )
  }

  if (!PASSWORD_STRENGTH_RE.test(newPassword)) {
    return NextResponse.json(
      { success: false, message: '새 비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.' },
      { status: 400 },
    )
  }

  const credential = await prisma.userCredential.findUnique({
    where: { profileId: payload.profileId },
    select: { id: true, passwordHash: true, isLocked: true },
  })

  if (!credential) {
    return NextResponse.json({ success: false, message: '계정 정보를 찾을 수 없습니다.' }, { status: 404 })
  }

  if (credential.isLocked) {
    return NextResponse.json({ success: false, message: '잠긴 계정입니다. 관리자에게 문의해 주세요.' }, { status: 403 })
  }

  const isCurrentPasswordValid = await verifyPassword(currentPassword, credential.passwordHash)
  if (!isCurrentPasswordValid) {
    return NextResponse.json({ success: false, message: '현재 비밀번호가 올바르지 않습니다.' }, { status: 401 })
  }

  const newHash = await hashPassword(newPassword)

  await prisma.userCredential.update({
    where: { id: credential.id },
    data: {
      passwordHash: newHash,
      mustChangePw: false,
      failCount: 0,
      isLocked: false,
      lockedAt: null,
    },
  })

  await prisma.auditLog.create({
    data: {
      tenantId: payload.tenantId,
      actorId: payload.profileId,
      entityType: 'UserCredential',
      entityId: credential.id,
      action: 'UPDATE',
      afterData: { passwordChanged: true, mustChangePw: false },
    },
  }).catch(() => {})

  return NextResponse.json({ success: true, message: '비밀번호가 변경되었습니다.' })
}
