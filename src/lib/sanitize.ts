const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'pin',
  'PIN',
  'popPin',
  'popPinHash',
  'popPinFingerprint',
  'popPinSetAt',
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'secret',
  'serviceRole',
  'service_role',
  'service_role_key',
  'JWT_SECRET',
])

const REDACTED = '[REDACTED]'

export function maskSensitiveFields(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (data instanceof Date) return data
  if (Array.isArray(data)) return data.map(maskSensitiveFields)
  if (typeof data !== 'object') return data

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.has(key) ? REDACTED : maskSensitiveFields(value)
  }
  return result
}

export function sanitizeUserForClient(user: Record<string, unknown>): Record<string, unknown> {
  const { passwordHash, password_hash, ...rest } = user as Record<string, unknown> & {
    passwordHash?: unknown
    password_hash?: unknown
  }
  void passwordHash
  void password_hash
  return maskSensitiveFields(rest) as Record<string, unknown>
}
