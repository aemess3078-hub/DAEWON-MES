import jwt from 'jsonwebtoken'
import type { AuthTokenPayload } from '@/types/auth'

export const NMES_SESSION_COOKIE = 'nmes-session'

const TOKEN_EXPIRY_SECONDS = 60 * 60 * 8 // 8 hours

// maxAge를 설정하지 않아 session cookie로 동작한다.
// 브라우저(모든 창) 종료 시 쿠키가 삭제되며, PC 재부팅 후 재로그인이 필요하다.
// JWT 자체의 expiresIn이 8시간 서버사이드 만료를 보장한다.
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set')
  }
  return secret
}

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: TOKEN_EXPIRY_SECONDS })
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret())
    if (typeof decoded === 'string') return null
    return decoded as AuthTokenPayload
  } catch {
    return null
  }
}
