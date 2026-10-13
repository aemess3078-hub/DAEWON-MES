import { createHmac, timingSafeEqual } from "crypto"
import { cookies } from "next/headers"
import type { UserRole } from "@prisma/client"

export const NMES_POP_WORKER_SESSION_COOKIE = "nmes-pop-worker-session"

const POP_WORKER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 10

export const POP_WORKER_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: POP_WORKER_SESSION_MAX_AGE_SECONDS,
}

export type PopWorkerSessionPayload = {
  tenantId: string
  profileId: string
  tenantUserId: string
  workerName: string
  role: UserRole
  siteId: string | null
  issuedAt: number
  expiresAt: number
}

export type CreatePopWorkerSessionInput = Omit<
  PopWorkerSessionPayload,
  "issuedAt" | "expiresAt"
>

function getPopWorkerSessionSecret(): string {
  const secret = process.env.POP_WORKER_SESSION_SECRET
  if (!secret) {
    throw new Error("POP_WORKER_SESSION_SECRET is required")
  }
  return secret
}

function signPayload(payload: string): string {
  return createHmac("sha256", getPopWorkerSessionSecret())
    .update(payload)
    .digest("base64url")
}

function encodePayload(payload: PopWorkerSessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

function decodePayload(encoded: string): unknown {
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))
}

function isSafeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function isValidPayload(value: unknown): value is PopWorkerSessionPayload {
  if (!value || typeof value !== "object") return false
  const payload = value as Record<string, unknown>
  return (
    typeof payload.tenantId === "string" &&
    payload.tenantId.length > 0 &&
    typeof payload.profileId === "string" &&
    payload.profileId.length > 0 &&
    typeof payload.tenantUserId === "string" &&
    payload.tenantUserId.length > 0 &&
    typeof payload.workerName === "string" &&
    payload.workerName.length > 0 &&
    typeof payload.role === "string" &&
    (typeof payload.siteId === "string" || payload.siteId === null) &&
    typeof payload.issuedAt === "number" &&
    typeof payload.expiresAt === "number"
  )
}

export function signPopWorkerSession(
  input: CreatePopWorkerSessionInput,
): string {
  const now = Date.now()
  const payload: PopWorkerSessionPayload = {
    ...input,
    issuedAt: now,
    expiresAt: now + POP_WORKER_SESSION_MAX_AGE_SECONDS * 1000,
  }
  const encodedPayload = encodePayload(payload)
  return `${encodedPayload}.${signPayload(encodedPayload)}`
}

export function verifyPopWorkerSessionToken(
  token: string,
): PopWorkerSessionPayload | null {
  try {
    const [encodedPayload, signature] = token.split(".")
    if (!encodedPayload || !signature) return null
    const expectedSignature = signPayload(encodedPayload)
    if (!isSafeEqual(signature, expectedSignature)) return null

    const payload = decodePayload(encodedPayload)
    if (!isValidPayload(payload)) return null
    if (payload.expiresAt <= Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export async function setPopWorkerSessionCookie(
  input: CreatePopWorkerSessionInput,
): Promise<void> {
  const store = await cookies()
  store.set(
    NMES_POP_WORKER_SESSION_COOKIE,
    signPopWorkerSession(input),
    POP_WORKER_SESSION_COOKIE_OPTIONS,
  )
}

export async function clearPopWorkerSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(NMES_POP_WORKER_SESSION_COOKIE, "", {
    ...POP_WORKER_SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  })
}

export async function getPopWorkerSession(): Promise<PopWorkerSessionPayload | null> {
  const store = await cookies()
  const token = store.get(NMES_POP_WORKER_SESSION_COOKIE)?.value
  if (!token) return null
  return verifyPopWorkerSessionToken(token)
}

export async function requirePopWorkerSession(): Promise<PopWorkerSessionPayload> {
  const session = await getPopWorkerSession()
  if (!session) throw new Error("POP_WORKER_SESSION_REQUIRED")
  return session
}
