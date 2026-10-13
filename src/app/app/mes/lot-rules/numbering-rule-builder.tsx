"use client"

import { useState, useCallback } from "react"
import { ChevronLeft, ChevronRight, X, Plus, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { upsertNumberingRule } from "@/lib/actions/numbering-rule.actions"
import type { Token, DateFormat, ContextKey } from "@/lib/types/numbering-rule"
import { CONTEXT_KEY_LABELS, DATE_FORMAT_LABELS } from "@/lib/types/numbering-rule"

// ─── Types ────────────────────────────────────────────────────────────────────

interface CodeGroupOption {
  groupCode: string
  groupName: string
}

interface NumberingRuleBuilderProps {
  type: "LOT" | "SERIAL"
  label: string
  initialTokens: Token[]
  tenantId: string
  codeGroups: CodeGroupOption[]
}

// ─── 미리보기 생성 ────────────────────────────────────────────────────────────

function buildPreview(tokens: Token[]): string {
  if (tokens.length === 0) return "(규칙 없음)"
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, "0")
  const day = String(today.getDate()).padStart(2, "0")
  const startOfYear = new Date(year, 0, 1)
  const julianDay = Math.floor((today.getTime() - startOfYear.getTime()) / 86400000) + 1
  const weekNum = Math.ceil((julianDay + startOfYear.getDay()) / 7)

  const parts = tokens.map((token) => {
    switch (token.type) {
      case "DATE": {
        switch (token.format) {
          case "YYYY": return String(year)
          case "YY": return String(year).slice(2)
          case "MM": return month
          case "DD": return day
          case "JULIAN": return String(julianDay).padStart(3, "0")
          case "WEEK": return `W${String(weekNum).padStart(2, "0")}`
          default: return ""
        }
      }
      case "FIXED": return token.value || "?"
      case "SEPARATOR": return token.value
      case "CONTEXT":
        return token.fallback ? token.fallback : `{${token.key}}`
      case "SEQ":
        return "1".padStart(token.digits, "0")
    }
  })
  return parts.join("")
}

// ─── 토큰 카드 색상 ───────────────────────────────────────────────────────────

const TOKEN_COLORS: Record<Token["type"], string> = {
  DATE: "bg-blue-50 border-blue-200 text-blue-700",
  FIXED: "bg-slate-50 border-slate-200 text-slate-700",
  SEPARATOR: "bg-gray-50 border-gray-200 text-gray-600",
  CONTEXT: "bg-amber-50 border-amber-200 text-amber-700",
  SEQ: "bg-emerald-50 border-emerald-200 text-emerald-700",
}

// ─── 토큰 라벨 ────────────────────────────────────────────────────────────────

function getTokenLabel(token: Token): string {
  switch (token.type) {
    case "DATE": return DATE_FORMAT_LABELS[token.format]
    case "FIXED": return token.value || "고정값"
    case "SEPARATOR": return token.value === "-" ? "하이픈(-)" : token.value === "_" ? "언더바(_)" : token.value === "." ? "점(.)" : `슬래시(/)`
    case "CONTEXT": return CONTEXT_KEY_LABELS[token.key]
    case "SEQ": return `순번(${token.digits}자리)`
  }
}

// ─── 고유 ID 생성 ─────────────────────────────────────────────────────────────

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

// ─── 토큰 카드 컴포넌트 ───────────────────────────────────────────────────────

interface TokenCardProps {
  token: Token
  index: number
  total: number
  codeGroups: CodeGroupOption[]
  onMove: (index: number, direction: "left" | "right") => void
  onRemove: (index: number) => void
  onUpdateFallback: (index: number, fallback: string) => void
  onUpdateCodeGroup: (index: number, codeGroupCode: string) => void
}

function TokenCard({ token, index, total, codeGroups, onMove, onRemove, onUpdateFallback, onUpdateCodeGroup }: TokenCardProps) {
  const colorClass = TOKEN_COLORS[token.type]
  const label = getTokenLabel(token)

  return (
    <div className={`inline-flex flex-col border rounded-md min-w-[80px] ${colorClass}`}>
      <div className="flex items-center gap-0.5 px-2 pt-1.5 pb-1">
        <button
          type="button"
          onClick={() => onMove(index, "left")}
          disabled={index === 0}
          className="p-0.5 rounded hover:bg-black/10 disabled:opacity-30 disabled:cursor-not-allowed"
          title="왼쪽으로"
        >
          <ChevronLeft className="h-3 w-3" />
        </button>
        <span className="flex-1 text-center text-[12px] font-medium leading-tight px-1 whitespace-nowrap">
          {label}
        </span>
        <button
          type="button"
          onClick={() => onMove(index, "right")}
          disabled={index === total - 1}
          className="p-0.5 rounded hover:bg-black/10 disabled:opacity-30 disabled:cursor-not-allowed"
          title="오른쪽으로"
        >
          <ChevronRight className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(index)}
          className="p-0.5 rounded hover:bg-black/10 ml-0.5"
          title="삭제"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {token.type === "CONTEXT" && (
        <div className="px-2 pb-1.5 space-y-1">
          {/* 공통코드 그룹 연결 */}
          <select
            value={token.codeGroupCode ?? ""}
            onChange={(e) => onUpdateCodeGroup(index, e.target.value)}
            className="w-full text-[11px] px-1.5 py-0.5 border border-amber-200 rounded bg-white/60 focus:outline-none focus:ring-1 focus:ring-amber-300"
          >
            <option value="">직접 입력</option>
            {codeGroups.map((g) => (
              <option key={g.groupCode} value={g.groupCode}>
                {g.groupName}
              </option>
            ))}
          </select>
          {/* fallback — 공통코드 연결 없을 때만 표시 */}
          {!token.codeGroupCode && (
            <input
              type="text"
              value={token.fallback ?? ""}
              onChange={(e) => {
                const val = e.target.value.replace(/[^A-Za-z0-9-]/g, "")
                onUpdateFallback(index, val)
              }}
              placeholder="기본값(없으면 빈값)"
              className="w-full text-[11px] px-1.5 py-0.5 border border-amber-200 rounded bg-white/60 placeholder:text-amber-300 focus:outline-none focus:ring-1 focus:ring-amber-300"
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

export function NumberingRuleBuilder({
  type,
  label,
  initialTokens,
  tenantId,
  codeGroups,
}: NumberingRuleBuilderProps) {
  const [tokens, setTokens] = useState<Token[]>(initialTokens)
  const [fixedInput, setFixedInput] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)

  const addToken = useCallback((token: Token) => {
    setTokens((prev) => [...prev, token])
    setSavedOk(false)
  }, [])

  const moveToken = useCallback((index: number, direction: "left" | "right") => {
    setTokens((prev) => {
      const arr = [...prev]
      const targetIndex = direction === "left" ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= arr.length) return prev
      ;[arr[index], arr[targetIndex]] = [arr[targetIndex], arr[index]]
      return arr
    })
    setSavedOk(false)
  }, [])

  const removeToken = useCallback((index: number) => {
    setTokens((prev) => prev.filter((_, i) => i !== index))
    setSavedOk(false)
  }, [])

  const updateFallback = useCallback((index: number, fallback: string) => {
    setTokens((prev) =>
      prev.map((t, i) => {
        if (i !== index || t.type !== "CONTEXT") return t
        return { ...t, fallback: fallback || undefined }
      })
    )
    setSavedOk(false)
  }, [])

  const updateCodeGroup = useCallback((index: number, codeGroupCode: string) => {
    setTokens((prev) =>
      prev.map((t, i) => {
        if (i !== index || t.type !== "CONTEXT") return t
        return { ...t, codeGroupCode: codeGroupCode || undefined, fallback: undefined }
      })
    )
    setSavedOk(false)
  }, [])

  const handleSave = async () => {
    setIsSaving(true)
    setSavedOk(false)
    try {
      await upsertNumberingRule(tenantId, type, tokens)
      setSavedOk(true)
    } catch {
      alert("저장에 실패했습니다.")
    } finally {
      setIsSaving(false)
    }
  }

  const preview = buildPreview(tokens)

  return (
    <div className="space-y-4">
      {/* 섹션 제목 */}
      <h2 className="text-[18px] font-semibold text-foreground">{label}</h2>

      {/* 토큰 팔레트 */}
      <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
        <p className="text-[13px] font-medium text-muted-foreground">토큰 팔레트</p>

        {/* 날짜 */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[13px] text-muted-foreground w-16 shrink-0">날짜</span>
          <div className="flex flex-wrap gap-1.5">
            {(["YYYY", "YY", "MM", "DD", "JULIAN", "WEEK"] as DateFormat[]).map((fmt) => (
              <Button
                key={fmt}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[12px] border-blue-200 text-blue-700 hover:bg-blue-50"
                onClick={() => addToken({ id: genId(), type: "DATE", format: fmt })}
              >
                {fmt}
              </Button>
            ))}
          </div>
        </div>

        {/* 구분자 */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[13px] text-muted-foreground w-16 shrink-0">구분자</span>
          <div className="flex flex-wrap gap-1.5">
            {(["-", "_", ".", "/"] as const).map((sep) => (
              <Button
                key={sep}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[12px] border-gray-200 text-gray-600 hover:bg-gray-50"
                onClick={() => addToken({ id: genId(), type: "SEPARATOR", value: sep })}
              >
                {sep}
              </Button>
            ))}
          </div>
        </div>

        {/* 고정값 */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[13px] text-muted-foreground w-16 shrink-0">고정값</span>
          <div className="flex gap-1.5 items-center">
            <Input
              value={fixedInput}
              onChange={(e) => setFixedInput(e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
              placeholder="영문/숫자 입력"
              className="h-7 text-[12px] w-32 border-slate-200"
              onKeyDown={(e) => {
                if (e.key === "Enter" && fixedInput.trim()) {
                  addToken({ id: genId(), type: "FIXED", value: fixedInput.trim() })
                  setFixedInput("")
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[12px] border-slate-200 text-slate-700 hover:bg-slate-50"
              disabled={!fixedInput.trim()}
              onClick={() => {
                if (fixedInput.trim()) {
                  addToken({ id: genId(), type: "FIXED", value: fixedInput.trim() })
                  setFixedInput("")
                }
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              추가
            </Button>
          </div>
        </div>

        {/* 변수(컨텍스트) */}
        <div className="flex flex-wrap gap-2 items-start">
          <span className="text-[13px] text-muted-foreground w-16 shrink-0 mt-1">변수</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(CONTEXT_KEY_LABELS) as ContextKey[]).map((key) => (
              <Button
                key={key}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[12px] border-amber-200 text-amber-700 hover:bg-amber-50"
                onClick={() => addToken({ id: genId(), type: "CONTEXT", key })}
              >
                {CONTEXT_KEY_LABELS[key]}
              </Button>
            ))}
          </div>
        </div>

        {/* 순번 */}
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[13px] text-muted-foreground w-16 shrink-0">순번</span>
          <div className="flex flex-wrap gap-1.5">
            {[3, 4, 5, 6].map((digits) => (
              <Button
                key={digits}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[12px] border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                onClick={() => addToken({ id: genId(), type: "SEQ", digits })}
              >
                SEQ {digits}자리
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* 규칙 구성 */}
      <div className="border rounded-lg p-4 space-y-3">
        <p className="text-[13px] font-medium text-muted-foreground">규칙 구성</p>

        {tokens.length === 0 ? (
          <p className="text-[13px] text-muted-foreground py-4 text-center">
            위 팔레트에서 토큰을 추가하세요.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tokens.map((token, index) => (
              <TokenCard
                key={token.id}
                token={token}
                index={index}
                total={tokens.length}
                codeGroups={codeGroups}
                onMove={moveToken}
                onRemove={removeToken}
                onUpdateFallback={updateFallback}
                onUpdateCodeGroup={updateCodeGroup}
              />
            ))}
          </div>
        )}
      </div>

      {/* 미리보기 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 rounded-lg border">
        <span className="text-[13px] text-muted-foreground shrink-0">미리보기</span>
        <span className="text-[15px] font-mono font-medium text-foreground">{preview}</span>
      </div>

      {/* 저장 버튼 */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="h-9 px-5 text-[14px]"
        >
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? "저장 중..." : "저장"}
        </Button>
        {savedOk && (
          <span className="text-[13px] text-emerald-600 font-medium">저장되었습니다.</span>
        )}
      </div>
    </div>
  )
}
