import { NextResponse } from "next/server"

import { clearPopWorkerSessionCookie } from "@/lib/auth/pop-worker-session"

export async function POST() {
  await clearPopWorkerSessionCookie()

  const res = NextResponse.json({ success: true })
  const clearClientCookie = {
    path: "/",
    maxAge: 0,
  }
  res.cookies.set("nmes-mode", "", clearClientCookie)
  res.cookies.set("nmes-worker-name", "", clearClientCookie)
  return res
}
