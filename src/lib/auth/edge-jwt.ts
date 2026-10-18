/**
 * Edge middleware 용 JWT(HS256) 서명 검증 (Phase 10 / DG-013).
 *
 * 기존 middleware 는 쿠키 '존재'만 확인하고 payload 를 서명 검증 없이 디코드했다. 그래서 임의 쿠키 값으로
 * /app 경로(서버 액션 POST 포함)를 통과할 수 있었다. 이 모듈은 Web Crypto 로 HS256 서명과 exp 를 검증한다
 * (jsonwebtoken 은 Edge 런타임에서 쓸 수 없음). 실제 인가는 서버 액션 가드가 DB 상태까지 확인해 다시 수행한다.
 */

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/")
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

export type VerifiedJwt = { loginId?: string; role?: string; exp?: number; [k: string]: unknown }

/** 서명·알고리즘·만료를 모두 통과하면 payload, 아니면 null. secret 이 없으면 항상 null(fail-closed). */
export async function verifyHs256Jwt(
  token: string | undefined | null,
  secret: string | undefined | null,
  nowMs: number = Date.now(),
): Promise<VerifiedJwt | null> {
  if (!token || !secret) return null
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const [h, p, s] = parts
  try {
    const header = JSON.parse(bytesToUtf8(base64UrlToBytes(h))) as { alg?: string; typ?: string }
    if (header.alg !== "HS256") return null

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    )
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(s) as BufferSource,
      new TextEncoder().encode(`${h}.${p}`),
    )
    if (!ok) return null

    const payload = JSON.parse(bytesToUtf8(base64UrlToBytes(p))) as VerifiedJwt
    if (typeof payload.exp === "number" && payload.exp * 1000 <= nowMs) return null
    return payload
  } catch {
    return null
  }
}
