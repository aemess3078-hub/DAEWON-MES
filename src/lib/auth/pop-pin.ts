import { createHmac } from "crypto"

import { hashPassword, verifyPassword } from "../password"

const POP_PIN_RE = /^\d{4}$/

export function validatePopPinFormat(pin: string): boolean {
  return POP_PIN_RE.test(pin)
}

export function assertValidPopPin(pin: string): void {
  if (!validatePopPinFormat(pin)) {
    throw new Error("POP PIN must be exactly 4 digits")
  }
}

export function getPopPinSecret(): string {
  const secret = process.env.POP_PIN_SECRET
  if (!secret) {
    throw new Error("POP_PIN_SECRET is required")
  }
  return secret
}

export function createPopPinFingerprint(tenantId: string, pin: string): string {
  assertValidPopPin(pin)
  if (!tenantId.trim()) {
    throw new Error("tenantId is required")
  }

  return createHmac("sha256", getPopPinSecret())
    .update(`${tenantId}:${pin}`)
    .digest("hex")
}

export async function hashPopPin(pin: string): Promise<string> {
  assertValidPopPin(pin)
  return hashPassword(pin)
}

export async function verifyPopPin(pin: string, hash: string): Promise<boolean> {
  assertValidPopPin(pin)
  return verifyPassword(pin, hash)
}

export async function preparePopPinForStorage(
  tenantId: string,
  pin: string,
): Promise<{
  popPinHash: string
  popPinFingerprint: string
  popPinSetAt: Date
}> {
  assertValidPopPin(pin)

  const [popPinHash, popPinFingerprint] = await Promise.all([
    hashPopPin(pin),
    Promise.resolve(createPopPinFingerprint(tenantId, pin)),
  ])

  return {
    popPinHash,
    popPinFingerprint,
    popPinSetAt: new Date(),
  }
}
