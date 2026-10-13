"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Bot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AIChatPanel } from "./ai-chat-panel"
import { checkAIStatus } from "@/lib/actions/ai-chat.actions"

const STORAGE_KEY = "ai-chat-btn-pos"
const DEFAULT_POS = { x: -1, y: -1 } // -1 = use CSS default (bottom-right)

export function AIChatButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [pos, setPos] = useState(DEFAULT_POS)
  const dragging = useRef(false)
  const hasMoved = useRef(false)
  const startOffset = useRef({ x: 0, y: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    checkAIStatus().then(({ enabled }) => setEnabled(enabled))
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setPos(JSON.parse(saved))
    } catch {}
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    hasMoved.current = false
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      startOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return
      hasMoved.current = true

      const btnSize = 48
      const newX = Math.max(0, Math.min(window.innerWidth - btnSize, e.clientX - startOffset.current.x))
      const newY = Math.max(0, Math.min(window.innerHeight - btnSize, e.clientY - startOffset.current.y))

      setPos({ x: newX, y: newY })
    }

    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false
        setPos((cur) => {
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cur)) } catch {}
          return cur
        })
      }
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [])

  const handleClick = () => {
    if (!hasMoved.current) setIsOpen(true)
  }

  if (!enabled) return null

  // pos.x === -1 이면 기본 위치(bottom-right) 사용
  const isPositioned = pos.x !== -1
  const style: React.CSSProperties = isPositioned
    ? { left: pos.x, top: pos.y, bottom: "auto", right: "auto" }
    : { bottom: 24, right: 24 }

  return (
    <>
      <Button
        ref={btnRef}
        size="icon"
        style={style}
        className={`fixed h-12 w-12 rounded-full shadow-lg z-40 transition-opacity duration-300 select-none ${
          isOpen ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"
        }`}
        onMouseDown={onMouseDown}
        onClick={handleClick}
        title="AI 어시스턴트 열기"
      >
        <Bot className="w-5 h-5" />
      </Button>

      <AIChatPanel open={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}
