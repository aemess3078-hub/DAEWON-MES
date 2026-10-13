import { NextRequest, NextResponse } from "next/server"
import { NMES_SESSION_COOKIE } from "@/lib/jwt"

function getRedirectPath(req: NextRequest): string {
  const next = req.nextUrl.searchParams.get("next")
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/login"
  return next
}

export async function GET(req: NextRequest) {
  const reason = req.nextUrl.searchParams.get("reason")
  const redirectUrl = new URL(getRedirectPath(req), req.url)
  if (reason) redirectUrl.searchParams.set("reason", reason)

  const res = NextResponse.redirect(redirectUrl)
  res.cookies.set(NMES_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })
  res.cookies.set("nmes-mode", "", { path: "/", maxAge: 0 })
  return res
}
