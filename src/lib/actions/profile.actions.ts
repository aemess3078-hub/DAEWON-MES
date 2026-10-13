'use server'

import { prisma } from '@/lib/db/prisma'
import { getCurrentUser } from '@/lib/auth'
import { getErrorMessage } from '@/lib/utils'
import { revalidatePath } from 'next/cache'
import type { UserRole } from '@prisma/client'
import { verifyPassword } from '@/lib/password'
import {
  assertValidPopPin,
  preparePopPinForStorage,
} from '@/lib/auth/pop-pin'

// ─── Types ───────────────────────────────────────────────────────────────────

export type MyProfileData = {
  profileId: string
  loginId: string
  email: string
  name: string
  phone: string | null
  jobTitle: string | null
  department: string | null
  role: UserRole
}

export type UpdateMyProfileInput = {
  name: string
  phone: string
  jobTitle: string
}

// ─── 조회 ─────────────────────────────────────────────────────────────────────

export async function getMyProfile(): Promise<MyProfileData | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const profile = await prisma.profile.findUnique({
    where: { id: user.profileId },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      jobTitle: true,
      department: true,
    },
  })
  if (!profile) return null

  return {
    profileId: profile.id,
    loginId: user.loginId,
    email: profile.email,
    name: profile.name,
    phone: profile.phone,
    jobTitle: profile.jobTitle,
    department: profile.department,
    role: user.role,
  }
}

// ─── 수정 (허용 필드: name, phone, jobTitle 만) ────────────────────────────────

export async function updateMyProfile(
  input: UpdateMyProfileInput,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: '인증이 필요합니다.' }

    const name = input.name.trim()
    if (!name) return { success: false, error: '이름은 필수 입력값입니다.' }

    const phone = input.phone.trim() || null
    const jobTitle = input.jobTitle.trim() || null

    const before = await prisma.profile.findUnique({
      where: { id: user.profileId },
      select: { name: true, phone: true, jobTitle: true },
    })

    // 서버에서 세션 profileId 기준으로만 update — 클라이언트 전달값 신뢰 안 함
    await prisma.profile.update({
      where: { id: user.profileId },
      data: { name, phone, jobTitle },
    })

    await prisma.auditLog.create({
      data: {
        tenantId: user.tenantId,
        actorId: user.profileId,
        actorLabel: user.name,
        entityType: 'Profile',
        entityId: user.profileId,
        action: 'UPDATE',
        beforeData: {
          name: before?.name ?? null,
          phone: before?.phone ?? null,
          jobTitle: before?.jobTitle ?? null,
        },
        afterData: { name, phone, jobTitle },
        menuName: "내 프로필",
      },
    }).catch(() => {})

    revalidatePath('/app/mes/profile')
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}

// ─── POP PIN 변경 ──────────────────────────────────────────────────────────────

export async function changeMyPopPin(
  currentPassword: string,
  newPin: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser()
    if (!user) return { success: false, error: '인증이 필요합니다.' }

    const credential = await prisma.userCredential.findUnique({
      where: { profileId: user.profileId },
      select: { id: true, tenantId: true, passwordHash: true, isLocked: true, popPinFingerprint: true },
    })
    if (!credential) return { success: false, error: '계정 정보를 찾을 수 없습니다.' }
    if (credential.isLocked) return { success: false, error: '잠긴 계정입니다. 관리자에게 문의해 주세요.' }

    const isPasswordValid = await verifyPassword(currentPassword, credential.passwordHash)
    if (!isPasswordValid) return { success: false, error: '현재 비밀번호가 올바르지 않습니다.' }

    try {
      assertValidPopPin(newPin)
    } catch {
      return { success: false, error: 'POP PIN은 4자리 숫자여야 합니다.' }
    }

    let popPinForStorage: Awaited<ReturnType<typeof preparePopPinForStorage>>
    try {
      popPinForStorage = await preparePopPinForStorage(user.tenantId, newPin)
    } catch (e) {
      if (e instanceof Error && e.message === 'POP_PIN_SECRET is required') {
        return { success: false, error: 'POP PIN 설정이 준비되지 않았습니다. 관리자에게 문의해 주세요.' }
      }
      return { success: false, error: 'PIN 처리 중 오류가 발생했습니다.' }
    }

    if (credential.popPinFingerprint === popPinForStorage.popPinFingerprint) {
      return { success: false, error: '기존 PIN과 동일한 PIN은 사용할 수 없습니다.' }
    }

    const [dupCredential, dupPending] = await Promise.all([
      prisma.userCredential.findFirst({
        where: {
          tenantId: user.tenantId,
          popPinFingerprint: popPinForStorage.popPinFingerprint,
          id: { not: credential.id },
        },
        select: { id: true },
      }),
      prisma.signupRequest.findFirst({
        where: {
          tenantId: user.tenantId,
          popPinFingerprint: popPinForStorage.popPinFingerprint,
          status: 'PENDING',
        },
        select: { id: true },
      }),
    ])

    if (dupCredential || dupPending) {
      return { success: false, error: '이미 사용 중인 POP PIN입니다. 다른 PIN을 입력해 주세요.' }
    }

    await prisma.$transaction(async (tx) => {
      await tx.userCredential.update({
        where: { id: credential.id },
        data: {
          popPinHash: popPinForStorage.popPinHash,
          popPinFingerprint: popPinForStorage.popPinFingerprint,
          popPinSetAt: popPinForStorage.popPinSetAt,
        },
      })

      await tx.auditLog.create({
        data: {
          tenantId: user.tenantId,
          actorId: user.profileId,
          actorLabel: user.name,
          entityType: 'UserCredential',
          entityId: credential.id,
          action: 'UPDATE',
          afterData: { popPinChanged: true },
          menuName: "내 프로필",
        },
      })
    })

    revalidatePath('/app/mes/profile')
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}
