import { Bot, Check } from "lucide-react"

export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  streaming?: boolean
}

type Props = {
  message: Message
  selected: boolean
  onToggleSelect: (id: string) => void
}

// 간단한 마크다운 렌더러
function renderMarkdown(content: string, streaming?: boolean) {
  const lines = content.split("\n")
  return (
    <>
      {lines.map((line, i) => {
        // ### 소제목
        if (line.startsWith("### ")) {
          return (
            <div key={i} className="font-semibold text-[13.5px] mt-3 mb-0.5 text-foreground">
              {line.slice(4)}
            </div>
          )
        }
        // ## 제목
        if (line.startsWith("## ")) {
          return (
            <div key={i} className="font-bold text-[14px] mt-3 mb-1 text-foreground">
              {line.slice(3)}
            </div>
          )
        }
        // # 제목
        if (line.startsWith("# ")) {
          return (
            <div key={i} className="font-bold text-[15px] mt-3 mb-1 text-foreground">
              {line.slice(2)}
            </div>
          )
        }
        // 구분선
        if (line.trim() === "---") {
          return <hr key={i} className="my-2 border-border" />
        }
        // 빈 줄
        if (line.trim() === "") {
          return <div key={i} className="h-1.5" />
        }
        // 불릿 리스트
        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div key={i} className="flex gap-1.5 text-[13px]">
              <span className="mt-0.5 flex-shrink-0 text-muted-foreground">•</span>
              <span>{renderInline(line.slice(2))}</span>
            </div>
          )
        }
        // 숫자 리스트 (1. 2. ...)
        const numberedMatch = line.match(/^(\d+)\.\s(.+)/)
        if (numberedMatch) {
          return (
            <div key={i} className="flex gap-1.5 text-[13px]">
              <span className="flex-shrink-0 text-muted-foreground font-medium">{numberedMatch[1]}.</span>
              <span>{renderInline(numberedMatch[2])}</span>
            </div>
          )
        }
        // 일반 텍스트
        return (
          <div key={i} className="text-[13px] leading-relaxed">
            {renderInline(line)}
            {/* 마지막 줄에 스트리밍 커서 */}
            {streaming && i === lines.length - 1 && (
              <span className="inline-block w-0.5 h-3.5 bg-primary ml-0.5 animate-[blink_1s_ease-in-out_infinite] align-middle" />
            )}
          </div>
        )
      })}
    </>
  )
}

// 인라인 마크다운 (볼드 처리)
function renderInline(text: string): React.ReactNode {
  // **bold** 처리
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  if (parts.length === 1) return text
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
        }
        return part
      })}
    </>
  )
}

export function AIMessage({ message, selected, onToggleSelect }: Props) {
  const isUser = message.role === "user"

  return (
    <div
      className={`flex gap-2 group transition-colors ${isUser ? "flex-row-reverse" : "flex-row"} ${
        selected ? "bg-primary/5 rounded-xl px-2 -mx-2" : ""
      }`}
    >
      {/* 어시스턴트 아이콘 */}
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-1">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}

      <div className={`flex flex-col gap-1 min-w-0 flex-1 ${isUser ? "items-end" : "items-start"}`}>
        <div
          className={`rounded-2xl px-3.5 py-2.5 leading-relaxed break-words ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm max-w-[85%] text-[14px] whitespace-pre-wrap"
              : "bg-muted text-foreground rounded-tl-sm w-full"
          }`}
        >
          {isUser ? (
            message.content
          ) : message.streaming && message.content === "" ? (
            <div className="flex gap-1.5 items-center py-0.5">
              <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          ) : (
            renderMarkdown(message.content, message.streaming)
          )}
        </div>
        <span className="text-[11px] text-muted-foreground/50 px-1">
          {message.timestamp.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* 선택 체크박스 (어시스턴트 메시지만, 스트리밍 중 제외) */}
      {!isUser && !message.streaming && (
        <button
          onClick={() => onToggleSelect(message.id)}
          title="내보내기 선택"
          className={`flex-shrink-0 self-start mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
            ${selected
              ? "opacity-100 bg-primary border-primary"
              : "opacity-0 group-hover:opacity-100 border-muted-foreground/30 bg-background hover:border-primary/50"
            }`}
        >
          {selected && <Check className="w-3 h-3 text-primary-foreground" />}
        </button>
      )}
    </div>
  )
}
