"use client"

import { useEffect, useRef } from "react"

const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const ACTIVITY_SYNC_INTERVAL_MS = 15 * 1000
const IDLE_CHECK_INTERVAL_MS = 30 * 1000
const LAST_ACTIVITY_KEY = "nmes:last-activity"
const LOGOUT_EVENT_KEY = "nmes:logout-event"

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "click",
  "scroll",
  "touchstart",
] as const

function getStoredLastActivity(): number {
  const value = window.localStorage.getItem(LAST_ACTIVITY_KEY)
  const parsed = value ? Number(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

export function IdleLogoutProvider() {
  const lastActivityRef = useRef(Date.now())
  const lastSyncRef = useRef(0)
  const loggingOutRef = useRef(false)

  useEffect(() => {
    function syncActivity(now: number) {
      if (now - lastSyncRef.current < ACTIVITY_SYNC_INTERVAL_MS) return
      lastSyncRef.current = now
      window.localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
    }

    function markActivity() {
      if (loggingOutRef.current) return
      const now = Date.now()
      lastActivityRef.current = now
      syncActivity(now)
    }

    async function logoutForIdle() {
      if (loggingOutRef.current) return
      loggingOutRef.current = true
      window.localStorage.setItem(LOGOUT_EVENT_KEY, String(Date.now()))

      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          cache: "no-store",
          keepalive: true,
        })
      } catch {
        // 네트워크 실패 시에도 클라이언트는 로그인 화면으로 보낸다.
      } finally {
        document.cookie = "nmes-mode=; path=/; max-age=0"
        window.location.assign("/login?reason=idle")
      }
    }

    function checkIdle() {
      const storedLastActivity = getStoredLastActivity()
      const lastActivity = Math.max(lastActivityRef.current, storedLastActivity)
      if (Date.now() - lastActivity >= IDLE_TIMEOUT_MS) {
        void logoutForIdle()
      }
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === LAST_ACTIVITY_KEY && event.newValue) {
        const timestamp = Number(event.newValue)
        if (Number.isFinite(timestamp)) {
          lastActivityRef.current = Math.max(lastActivityRef.current, timestamp)
        }
      }

      if (event.key === LOGOUT_EVENT_KEY && event.newValue && !loggingOutRef.current) {
        loggingOutRef.current = true
        document.cookie = "nmes-mode=; path=/; max-age=0"
        window.location.assign("/login?reason=idle")
      }
    }

    markActivity()
    const intervalId = window.setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS)
    window.addEventListener("storage", handleStorage)
    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true })
    })

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener("storage", handleStorage)
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity)
      })
    }
  }, [])

  return null
}
