import type { LoginFailReason } from '@prisma/client'

export interface AuthTokenPayload {
  profileId: string
  tenantId: string
  loginId: string
  email?: string | null
  name: string
  role: string
  mustChangePw?: boolean
}

export type { LoginFailReason }
