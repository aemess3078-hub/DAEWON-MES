"use server"

import { Prisma, UserRole, SignupRequestStatus } from "@prisma/client"
import { revalidatePath } from "next/cache"

import { prisma } from "@/lib/db/prisma"
import { getTenantId, getCurrentUser } from "@/lib/auth"
import { canAccessFullUserManagement } from "@/lib/developer"
import { hashPassword, validatePassword } from "@/lib/password"
import { maskSensitiveFields } from "@/lib/sanitize"
import { getErrorMessage } from "@/lib/utils"
import {
  assertValidPopPin,
  createPopPinFingerprint,
  preparePopPinForStorage,
} from "@/lib/auth/pop-pin"

function normalizeLoginId(loginId: string): string {
  return loginId.trim().toLowerCase()
}

async function requireFullUserManagementAccess() {
  const user = await getCurrentUser()
  if (!user) throw new Error("UNAUTHORIZED")
  if (!canAccessFullUserManagement(user)) throw new Error("FORBIDDEN")
  return user
}

type PopPinLookupClient = {
  userCredential: {
    findFirst: typeof prisma.userCredential.findFirst
  }
  signupRequest: {
    findFirst: typeof prisma.signupRequest.findFirst
  }
}

async function findDuplicatePopPin(
  tx: PopPinLookupClient,
  tenantId: string,
  popPinFingerprint: string,
  options: { excludeSignupRequestId?: string } = {},
): Promise<"credential" | "pending" | null> {
  const [credentialPin, pendingPin] = await Promise.all([
    tx.userCredential.findFirst({
      where: { tenantId, popPinFingerprint },
      select: { id: true },
    }),
    tx.signupRequest.findFirst({
      where: {
        tenantId,
        popPinFingerprint,
        status: "PENDING",
        ...(options.excludeSignupRequestId
          ? { id: { not: options.excludeSignupRequestId } }
          : {}),
      },
      select: { id: true },
    }),
  ])

  if (credentialPin) return "credential"
  if (pendingPin) return "pending"
  return null
}

export type CreateSignupRequestInput = {
  loginId: string
  email: string
  name: string
  department: string
  employeeNo?: string
  phone: string
  jobTitle: string
  password: string
  popPin: string
}

export type SignupRequestRow = {
  id: string
  tenantId: string
  loginId: string | null
  email: string
  name: string
  department: string | null
  employeeNo: string | null
  phone: string | null
  jobTitle: string | null
  status: SignupRequestStatus
  createdAt: Date
  approvedAt: Date | null
  rejectedAt: Date | null
  rejectReason: string | null
  approvedBy: { id: string; name: string; email: string } | null
  rejectedBy: { id: string; name: string; email: string } | null
}

export async function createSignupRequest(
  input: CreateSignupRequestInput,
): Promise<{ success: boolean; message: string }> {
  const tenantId = await getTenantId()
  const {
    loginId,
    email,
    name,
    department,
    employeeNo,
    phone,
    jobTitle,
    password,
    popPin,
  } = input

  if (!loginId || loginId.trim().length < 3) {
    return { success: false, message: "로그인 아이디는 3자 이상이어야 합니다." }
  }
  if (!name?.trim()) return { success: false, message: "이름을 입력해 주세요." }
  if (!department?.trim()) return { success: false, message: "부서를 입력해 주세요." }
  if (!phone?.trim()) return { success: false, message: "연락처를 입력해 주세요." }
  if (!jobTitle?.trim()) return { success: false, message: "직급을 입력해 주세요." }
  if (!email?.trim()) return { success: false, message: "이메일을 입력해 주세요." }

  const pwError = validatePassword(password)
  if (pwError) return { success: false, message: pwError }

  try {
    assertValidPopPin(popPin)
  } catch {
    return { success: false, message: "작업자 POP PIN은 4자리 숫자로 입력해 주세요." }
  }

  const cleanLoginId = normalizeLoginId(loginId)
  let popPinForStorage: Awaited<ReturnType<typeof preparePopPinForStorage>>
  try {
    popPinForStorage = await preparePopPinForStorage(tenantId, popPin)
  } catch (e) {
    if (e instanceof Error && e.message === "POP_PIN_SECRET is required") {
      return {
        success: false,
        message: "작업자 POP PIN 설정이 준비되지 않았습니다. 관리자에게 문의해 주세요.",
      }
    }
    return { success: false, message: "작업자 POP PIN을 확인해 주세요." }
  }

  const existingCredential = await prisma.userCredential.findFirst({
    where: {
      tenantId,
      loginId: { equals: cleanLoginId, mode: "insensitive" },
    },
    select: { id: true },
  })
  if (existingCredential) {
    return { success: false, message: "이미 사용 중인 아이디입니다." }
  }

  const duplicatePending = await prisma.signupRequest.findFirst({
    where: {
      tenantId,
      loginId: { equals: cleanLoginId, mode: "insensitive" },
      status: "PENDING",
    },
    select: { id: true },
  })
  if (duplicatePending) {
    return { success: false, message: "동일한 아이디로 이미 대기 중인 신청이 있습니다." }
  }

  const duplicateEmail = await prisma.signupRequest.findFirst({
    where: { tenantId, email, status: "PENDING" },
    select: { id: true },
  })
  if (duplicateEmail) {
    return { success: false, message: "이미 동일한 이메일로 대기 중인 신청이 있습니다." }
  }

  const activeProfile = await prisma.profile.findFirst({
    where: { email },
    select: { id: true },
  })
  if (activeProfile) {
    const tenantUser = await prisma.tenantUser.findFirst({
      where: { tenantId, profileId: activeProfile.id, isActive: true },
      select: { id: true },
    })
    if (tenantUser) {
      return { success: false, message: "이미 등록된 사용자입니다." }
    }
  }

  // PIN 중복 여부는 응답으로 노출하지 않는다(승인 단계에서 관리자가 확인).

  const passwordHash = await hashPassword(password)

  try {
    await prisma.$transaction(
      async (tx) => {
        await tx.signupRequest.create({
          data: {
            tenantId,
            loginId: cleanLoginId,
            email,
            name,
            department: department ?? null,
            employeeNo: employeeNo ?? null,
            phone: phone ?? null,
            jobTitle: jobTitle ?? null,
            passwordHash,
            popPinHash: popPinForStorage.popPinHash,
            popPinFingerprint: popPinForStorage.popPinFingerprint,
            popPinSetAt: popPinForStorage.popPinSetAt,
            status: "PENDING",
          },
        })
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
  } catch (e) {
    if (e instanceof Error && e.message === "DUPLICATE_POP_PIN") {
      return {
        success: false,
        message: "이미 사용 중인 작업자 POP PIN입니다. 다른 PIN을 입력해 주세요.",
      }
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return {
        success: false,
        message: "동시에 같은 PIN 신청이 처리되었습니다. 다른 PIN으로 다시 신청해 주세요.",
      }
    }
    throw e
  }

  return {
    success: true,
    message: "가입 신청이 완료되었습니다. 관리자 승인 후 신청한 아이디와 비밀번호로 로그인하세요.",
  }
}

export async function getSignupRequests(
  status?: SignupRequestStatus,
): Promise<SignupRequestRow[]> {
  const tenantId = await getTenantId()
  await requireFullUserManagementAccess()

  return prisma.signupRequest.findMany({
    where: { tenantId, ...(status ? { status } : {}) },
    include: {
      approvedBy: { select: { id: true, name: true, email: true } },
      rejectedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  })
}

export async function approveSignupRequest(
  requestId: string,
  grantedRole: UserRole,
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const actor = await requireFullUserManagementAccess()

    const request = await prisma.signupRequest.findFirst({
      where: { id: requestId, tenantId, status: "PENDING" },
    })
    if (!request) {
      return { success: false, error: "신청을 찾을 수 없거나 이미 처리되었습니다." }
    }
    if (
      !request.loginId ||
      !request.passwordHash ||
      !request.popPinHash ||
      !request.popPinFingerprint ||
      !request.popPinSetAt
    ) {
      return {
        success: false,
        error: "이 신청 건에 로그인 정보 또는 작업자 POP PIN 정보가 없습니다. 재신청을 요청해 주세요.",
      }
    }

    const normalizedLoginId = normalizeLoginId(request.loginId)
    try {
      await prisma.$transaction(
        async (tx) => {
          const duplicateCredential = await tx.userCredential.findFirst({
            where: {
              tenantId,
              loginId: { equals: normalizedLoginId, mode: "insensitive" },
            },
            select: { id: true },
          })
          if (duplicateCredential) throw new Error("DUPLICATE_LOGIN_ID")

          const duplicatePopPin = await findDuplicatePopPin(
            tx,
            tenantId,
            request.popPinFingerprint!,
            { excludeSignupRequestId: request.id },
          )
          if (duplicatePopPin) throw new Error("DUPLICATE_POP_PIN")

          let profileId: string
          const existingProfileByEmail = await tx.profile.findUnique({
            where: { email: request.email },
          })
          if (existingProfileByEmail) {
            await tx.profile.update({
              where: { id: existingProfileByEmail.id },
              data: {
                name: request.name,
                department: request.department ?? existingProfileByEmail.department,
                phone: request.phone ?? existingProfileByEmail.phone,
                employeeNo: request.employeeNo ?? existingProfileByEmail.employeeNo,
                jobTitle: request.jobTitle ?? existingProfileByEmail.jobTitle,
              },
            })
            profileId = existingProfileByEmail.id
          } else {
            const newProfile = await tx.profile.create({
              data: {
                email: request.email,
                name: request.name,
                department: request.department ?? null,
                phone: request.phone ?? null,
                employeeNo: request.employeeNo ?? null,
                jobTitle: request.jobTitle ?? null,
              },
            })
            profileId = newProfile.id
          }

          const existingTU = await tx.tenantUser.findFirst({
            where: { tenantId, profileId },
          })
          if (existingTU) {
            await tx.tenantUser.update({
              where: { id: existingTU.id },
              data: { role: grantedRole, isActive: true },
            })
          } else {
            await tx.tenantUser.create({
              data: { tenantId, profileId, role: grantedRole, isActive: true },
            })
          }

          const existingCredential = await tx.userCredential.findUnique({
            where: { profileId },
            select: { id: true },
          })
          if (existingCredential) throw new Error("EXISTING_CREDENTIAL")

          await tx.userCredential.create({
            data: {
              tenantId,
              loginId: normalizedLoginId,
              profileId,
              passwordHash: request.passwordHash!,
              popPinHash: request.popPinHash!,
              popPinFingerprint: request.popPinFingerprint!,
              popPinSetAt: request.popPinSetAt!,
              mustChangePw: false,
              isLocked: false,
              failCount: 0,
            },
          })

          await tx.signupRequest.update({
            where: { id: requestId },
            data: {
              status: "APPROVED",
              approvedAt: new Date(),
              approvedById: actor.id,
            },
          })

          const afterData = maskSensitiveFields({
            email: request.email,
            name: request.name,
            loginId: normalizedLoginId,
            grantedRole,
            profileId,
            mustChangePw: false,
            popPinConfigured: true,
          })
          await tx.auditLog.create({
            data: {
              tenantId,
              actorId: actor.id,
              actorType: "USER",
              actorLabel: actor.name,
              entityType: "SignupRequest",
              entityId: requestId,
              action: "APPROVE",
              afterData: afterData as object,
              menuName: "가입신청관리",
            },
          })

        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (e) {
      if (e instanceof Error && e.message === "DUPLICATE_LOGIN_ID") {
        return { success: false, error: `이미 사용 중인 로그인 아이디입니다: ${normalizedLoginId}` }
      }
      if (e instanceof Error && e.message === "DUPLICATE_POP_PIN") {
        return { success: false, error: "이미 사용 중인 작업자 POP PIN입니다. 다른 PIN으로 재신청해 주세요." }
      }
      if (e instanceof Error && e.message === "EXISTING_CREDENTIAL") {
        return { success: false, error: "이미 로그인 계정이 존재하는 사용자입니다." }
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
        return { success: false, error: "동시에 같은 PIN 승인이 처리되었습니다. 다시 시도해 주세요." }
      }
      throw e
    }

    revalidatePath("/app/mes/users")
    return { success: true }
  } catch (e) {
    console.error("[approveSignupRequest] catch:", e)
    return { success: false, error: getErrorMessage(e) }
  }
}

export async function rejectSignupRequest(
  requestId: string,
  rejectReason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    const actor = await requireFullUserManagementAccess()

    const request = await prisma.signupRequest.findFirst({
      where: { id: requestId, tenantId, status: "PENDING" },
    })
    if (!request) return { success: false, error: "신청을 찾을 수 없거나 이미 처리되었습니다." }

    await prisma.signupRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: actor.id, rejectReason },
    })

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorId: actor.id,
        actorType: "USER",
        actorLabel: actor.name,
        entityType: "SignupRequest",
        entityId: requestId,
        action: "REJECT",
        afterData: maskSensitiveFields({ email: request.email, rejectReason }) as object,
        menuName: "가입신청관리",
      },
    })

    revalidatePath("/app/mes/users")
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}

export async function checkSignupPopPinAvailability(
  pin: string,
): Promise<{ available: boolean; message: string }> {
  const tenantId = await getTenantId()
  try {
    assertValidPopPin(pin)
  } catch {
    return { available: false, message: "작업자 POP PIN은 4자리 숫자로 입력해 주세요." }
  }

  // 보안: 비로그인 사용자에게 PIN 사용 여부를 알려주지 않는다(PIN 만으로 POP 로그인이 가능하므로 사용 중인 PIN 목록이 노출되면 계정 탈취로 이어진다).
  // 중복 여부는 관리자 승인 단계에서 확인하며, 중복이면 재신청을 안내한다.
  return { available: true, message: "PIN 형식이 올바릅니다. 중복 여부는 관리자 승인 시 확인됩니다." }
}

export async function getPendingSignupCount(): Promise<number> {
  const tenantId = await getTenantId()
  await requireFullUserManagementAccess()
  return prisma.signupRequest.count({ where: { tenantId, status: "PENDING" } })
}

export async function deleteSignupRequest(
  requestId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const tenantId = await getTenantId()
    await requireFullUserManagementAccess()

    const request = await prisma.signupRequest.findFirst({
      where: { id: requestId, tenantId },
    })
    if (!request) return { success: false, error: "신청 이력을 찾을 수 없습니다." }
    if (request.status === "PENDING") {
      return { success: false, error: "대기 중인 신청은 삭제할 수 없습니다. 먼저 승인 또는 거절 처리해 주세요." }
    }

    await prisma.signupRequest.delete({ where: { id: requestId } })

    revalidatePath("/app/mes/users")
    return { success: true }
  } catch (e) {
    return { success: false, error: getErrorMessage(e) }
  }
}
