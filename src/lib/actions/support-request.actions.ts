"use server"

import { prisma } from "@/lib/db/prisma"
import { revalidatePath } from "next/cache"
import type { SupportType, SupportStatus, SupportPriority } from "@prisma/client"
import { isMissingDbObjectError } from "@/lib/db/prisma-error"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

// ─── Types ────────────────────────────────────────────────────────────────────

export type SupportRequestItem = {
  id: string
  tenantId: string
  authorId: string
  authorName: string
  authorEmail: string
  type: SupportType
  priority: SupportPriority
  title: string
  content: string
  status: SupportStatus
  imageUrl: string | null
  answer: string | null
  adminNote: string | null
  handledById: string | null
  handledByName: string | null
  handledAt: string | null   // ISO string
  createdAt: string          // ISO string
  updatedAt: string          // ISO string
}

export type CreateSupportRequestInput = {
  tenantId: string
  authorId: string
  type: SupportType
  priority: SupportPriority
  title: string
  content: string
  imageUrl?: string | null
}

export type UpdateSupportRequestInput = {
  id: string
  status?: SupportStatus
  answer?: string | null
  adminNote?: string | null
  handledById?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toItem(row: {
  id: string
  tenantId: string
  authorId: string
  type: SupportType
  priority: SupportPriority
  title: string
  content: string
  status: SupportStatus
  imageUrl: string | null
  answer: string | null
  adminNote: string | null
  handledById: string | null
  handledAt: Date | null
  createdAt: Date
  updatedAt: Date
  author: { name: string; email: string }
  handledBy: { name: string } | null
}): SupportRequestItem {
  return {
    id: row.id,
    tenantId: row.tenantId,
    authorId: row.authorId,
    authorName: row.author.name,
    authorEmail: row.author.email,
    type: row.type,
    priority: row.priority,
    title: row.title,
    content: row.content,
    status: row.status,
    imageUrl: row.imageUrl,
    answer: row.answer,
    adminNote: row.adminNote,
    handledById: row.handledById,
    handledByName: row.handledBy?.name ?? null,
    handledAt: row.handledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

// ─── 조회 ──────────────────────────────────────────────────────────────────────

/**
 * 요청사항 목록 조회
 * - 관리자/개발자(isAdmin=true): 전체 조회
 * - 일반 사용자: 본인 요청만 조회
 */
export async function getSupportRequests(
  tenantId: string,
  currentProfileId: string,
  isAdmin: boolean,
): Promise<SupportRequestItem[]> {
  await assertDaewonFeatureScope()
  try {
    const rows = await prisma.supportRequest.findMany({
      where: {
        tenantId,
        ...(isAdmin ? {} : { authorId: currentProfileId }),
      },
      include: {
        author: { select: { name: true, email: true } },
        handledBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    })
    return rows.map(toItem)
  } catch (error) {
    if (isMissingDbObjectError(error)) return []
    throw error
  }
}

export async function getSupportRequestById(id: string): Promise<SupportRequestItem | null> {
  await assertDaewonFeatureScope()
  try {
    const row = await prisma.supportRequest.findUnique({
      where: { id },
      include: {
        author: { select: { name: true, email: true } },
        handledBy: { select: { name: true } },
      },
    })
    return row ? toItem(row) : null
  } catch (error) {
    if (isMissingDbObjectError(error)) return null
    throw error
  }
}

// ─── 등록 ──────────────────────────────────────────────────────────────────────

export async function createSupportRequest(
  input: CreateSupportRequestInput,
): Promise<SupportRequestItem> {
  await assertDaewonFeatureScope()
  const row = await prisma.supportRequest.create({
    data: {
      tenantId: input.tenantId,
      authorId: input.authorId,
      type: input.type,
      priority: input.priority,
      title: input.title.trim(),
      content: input.content.trim(),
      imageUrl: input.imageUrl ?? null,
      status: "OPEN",
    },
    include: {
      author: { select: { name: true, email: true } },
      handledBy: { select: { name: true } },
    },
  })
  revalidatePath("/app/mes/support-requests")
  return toItem(row)
}

// ─── 상태/답변 수정 (관리자 전용) ────────────────────────────────────────────────

export async function updateSupportRequest(
  input: UpdateSupportRequestInput,
): Promise<SupportRequestItem> {
  await assertDaewonFeatureScope()
  const now = new Date()
  const isResolved =
    input.status === "ANSWERED" ||
    input.status === "COMPLETED"

  const row = await prisma.supportRequest.update({
    where: { id: input.id },
    data: {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.answer !== undefined && { answer: input.answer }),
      ...(input.adminNote !== undefined && { adminNote: input.adminNote }),
      ...(input.handledById !== undefined && { handledById: input.handledById }),
      ...(isResolved && { handledAt: now }),
    },
    include: {
      author: { select: { name: true, email: true } },
      handledBy: { select: { name: true } },
    },
  })
  revalidatePath("/app/mes/support-requests")
  return toItem(row)
}
