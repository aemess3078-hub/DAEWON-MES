"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { usePathname } from "next/navigation"
import {
  X, Send, Bot, FileDown, RotateCcw, ChevronDown,
  CheckSquare, Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { AIMessage, type Message } from "./ai-message"
import { AiReportModal } from "./ai-report-modal"

const SUGGESTED_QUESTIONS = [
  "오늘 진행 중인 작업지시 알려줘",
  "현재 재고 부족 품목 있어?",
  "이번 주 불량 현황은?",
  "납기 임박한 수주 있어?",
  "대화 내용 리포트 작성해줘",
]

const REPORT_KEYWORDS = ["리포트", "보고서", "정리해", "요약해줘", "리포트 작성", "보고서 작성", "출력해줘"]

function isReportRequest(text: string) {
  return REPORT_KEYWORDS.some((k) => text.includes(k))
}

type Props = {
  open: boolean
  onClose: () => void
}

export function AIChatPanel({ open, onClose }: Props) {
  const pathname = usePathname()
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "안녕하세요! 대원정밀 MES AI 어시스턴트입니다.\n생산, 품질, 설비, 수주 관련 궁금한 점을 질문해 주세요.\n\n💡 AI 답변에 마우스를 올리면 선택 체크박스가 나타납니다.",
      timestamp: new Date(),
    },
  ])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [open])

  const handleSend = async (text?: string) => {
    const trimmed = (text ?? input).trim()
    if (!trimmed || isLoading) return

    // 리포트 요청 감지
    if (isReportRequest(trimmed)) {
      setInput("")
      const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: trimmed, timestamp: new Date() }
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: "📋 리포트 생성 창을 열었습니다! 원하는 형식을 선택해 주세요.",
          timestamp: new Date(),
        },
      ])
      setReportModalOpen(true)
      return
    }

    setInput("")
    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content: trimmed, timestamp: new Date() }
    const aiMsgId = `a-${Date.now()}`

    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: aiMsgId, role: "assistant", content: "", timestamp: new Date(), streaming: true },
    ])
    setIsLoading(true)

    try {
      const history = messages
        .filter((m) => m.id !== "welcome" && !m.streaming)
        .map((m) => ({ role: m.role, content: m.content }))

      const res = await fetch("/api/ai-chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, context: pathname, history }),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "응답 오류")
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, content: `오류: ${errText}`, streaming: false } : m
          )
        )
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullContent = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split("\n").filter((l) => l.startsWith("data: "))
        for (const line of lines) {
          const data = line.slice(6)
          if (data === "[DONE]") break
          try {
            const json = JSON.parse(data)
            const delta = json.delta ?? ""
            fullContent += delta
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId ? { ...m, content: fullContent } : m
              )
            )
          } catch { /* ignore parse errors */ }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId ? { ...m, content: fullContent, streaming: false } : m
        )
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류"
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId ? { ...m, content: `오류: ${msg}`, streaming: false } : m
        )
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "대화가 초기화되었습니다. 대원정밀 MES 관련 질문을 해주세요.",
        timestamp: new Date(),
      },
    ])
    setSelectedIds(new Set())
  }

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const assistantMessages = messages.filter((m) => m.role === "assistant" && m.id !== "welcome")
  const handleSelectAll = () => {
    if (selectedIds.size === assistantMessages.length && assistantMessages.length > 0) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(assistantMessages.map((m) => m.id)))
    }
  }

  const showSuggestions = messages.length <= 1

  return (
    <>
      {/* 백드롭 */}
      <div
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* 슬라이드 패널 */}
      <div
        className={`fixed top-0 right-0 h-full bg-background border-l shadow-2xl z-50 flex flex-col transition-transform duration-300 ease-in-out
          w-[30vw] min-w-[360px] max-w-[600px]
          ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* ── 헤더 ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-muted/20 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div>
              <p className="text-[15px] font-semibold leading-tight">대원정밀 MES AI 어시스턴트</p>
              <p className="text-[11px] text-muted-foreground">
                실시간 DB 연동 · 대화 {Math.max(0, messages.length - 1)}건
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {/* 리포트 드롭다운 */}
            {messages.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[13px] px-2.5">
                    <FileDown className="w-4 h-4" />
                    내보내기
                    {selectedIds.size > 0 && (
                      <span className="bg-primary text-primary-foreground text-[11px] rounded-full px-1.5 leading-5 min-w-[20px] text-center">
                        {selectedIds.size}
                      </span>
                    )}
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => setReportModalOpen(true)}>
                    <FileDown className="mr-2 h-4 w-4" />
                    리포트 생성
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* 초기화 */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              onClick={handleClear}
              title="대화 초기화"
            >
              <RotateCcw className="w-4 h-4" />
            </Button>

            {/* 닫기 */}
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* ── 선택 도구모음 ── */}
        {assistantMessages.length > 0 && (
          <div className="px-5 py-2 border-b bg-muted/10 flex items-center gap-3 flex-shrink-0">
            <button
              onClick={handleSelectAll}
              className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {selectedIds.size === assistantMessages.length && assistantMessages.length > 0
                ? <CheckSquare className="w-3.5 h-3.5 text-primary" />
                : <Square className="w-3.5 h-3.5" />
              }
              {selectedIds.size > 0 ? `${selectedIds.size}개 선택됨` : "AI 답변 전체 선택"}
            </button>
            {selectedIds.size > 0 && (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="text-[12px] text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                선택 해제
              </button>
            )}
          </div>
        )}

        {/* ── 메시지 목록 ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {messages.map((msg) => (
            <AIMessage
              key={msg.id}
              message={msg}
              selected={selectedIds.has(msg.id)}
              onToggleSelect={msg.id === "welcome" ? () => {} : toggleSelect}
            />
          ))}

<div ref={bottomRef} />
        </div>

        {/* ── 추천 질문 ── */}
        {showSuggestions && (
          <div className="px-5 py-3 border-t bg-muted/10 flex-shrink-0">
            <p className="text-[11px] text-muted-foreground mb-2">💡 추천 질문</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-[12px] px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── 입력창 ── */}
        <div className="px-4 py-4 border-t bg-muted/10 flex-shrink-0">
          <div className="flex gap-2 items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="질문을 입력하세요... (Enter 전송)"
              className="flex-1 text-[14px] bg-background border rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground/50"
              disabled={isLoading}
            />
            <Button
              size="icon"
              className="h-10 w-10 rounded-xl flex-shrink-0"
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground/40 mt-2 text-center">
            실시간 DB 연동 · AI 답변 선택 후 내보내기 가능
          </p>
        </div>
      </div>

      {/* 리포트 모달 */}
      <AiReportModal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        messages={messages}
        selectedIds={selectedIds}
      />
    </>
  )
}
