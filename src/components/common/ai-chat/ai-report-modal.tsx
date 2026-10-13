"use client"

import { useState, useRef } from "react"
import {
  FileText, Printer, Loader2, CheckCircle2, ChevronDown,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { type Message } from "./ai-message"

const TOPIC_OPTIONS = [
  { value: "all",   label: "전체 대화 내용" },
  { value: "생산지시", label: "생산지시 현황" },
  { value: "작업지시", label: "작업지시 현황" },
  { value: "재고",   label: "재고 현황" },
  { value: "설비",   label: "설비 현황" },
  { value: "불량",   label: "불량 현황" },
  { value: "출하",   label: "출하 현황" },
  { value: "구매",   label: "구매/발주 현황" },
]

// ── 마크다운 렌더러 ──────────────────────────────────────────────
function ReportPreview({ content, reportRef }: { content: string; reportRef: React.RefObject<HTMLDivElement> }) {
  const now = new Date().toLocaleString("ko-KR")
  const lines = content.split("\n")

  const renderLine = (line: string, i: number) => {
    if (line.startsWith("# ")) {
      return (
        <h1 key={i} className="text-[18px] font-extrabold text-primary border-b-2 border-primary pb-2 mb-3 mt-0">
          {line.slice(2)}
        </h1>
      )
    }
    if (line.startsWith("## ")) {
      return (
        <h2 key={i} className="text-[14px] font-bold text-blue-700 border-l-4 border-primary pl-3 mt-5 mb-2">
          {line.slice(3)}
        </h2>
      )
    }
    if (line.startsWith("### ")) {
      return (
        <h3 key={i} className="text-[13px] font-bold text-foreground mt-3 mb-1.5">
          {line.slice(4)}
        </h3>
      )
    }
    if (line.startsWith("- ")) {
      const html = line.slice(2).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      return (
        <div key={i} className="flex gap-2 items-start mb-1">
          <span className="text-primary flex-shrink-0 mt-0.5 text-[13px]">•</span>
          <span
            className="text-[12px] leading-relaxed text-foreground/80"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      )
    }
    if (line.trim() === "") return <div key={i} className="h-1.5" />
    const html = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    return (
      <p
        key={i}
        className="text-[12px] leading-relaxed text-foreground/80 mb-1"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  return (
    <div
      ref={reportRef}
      className="bg-white p-8 font-sans"
      style={{ fontFamily: '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif' }}
    >
      {/* 리포트 헤더 */}
      <div className="bg-gradient-to-r from-primary to-blue-700 text-white rounded-lg px-6 py-4 mb-6 flex justify-between items-center">
        <div>
          <div className="text-[11px] opacity-80 mb-0.5">MES 운영 분석 리포트</div>
          <div className="text-[15px] font-bold">AI Agent 대화 기반 리포트</div>
        </div>
        <div className="text-right text-[11px] opacity-85">
          <div>작성: 대원정밀 MES AI Agent</div>
          <div>{now}</div>
        </div>
      </div>

      {/* 본문 */}
      <div className="leading-relaxed">
        {lines.map((line, i) => renderLine(line, i))}
      </div>

      {/* 푸터 */}
      <div className="mt-8 pt-3 border-t border-border flex justify-between text-[10px] text-muted-foreground">
        <span>본 리포트는 대원정밀 MES AI Agent가 대화 내역을 분석하여 자동 생성되었습니다.</span>
        <span>{now}</span>
      </div>
    </div>
  )
}

// ── Props ────────────────────────────────────────────────────────
type Props = {
  open: boolean
  onClose: () => void
  messages: Message[]
  selectedIds?: Set<string>
}

export function AiReportModal({ open, onClose, messages, selectedIds }: Props) {
  const [topic, setTopic] = useState("all")
  const [generating, setGenerating] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [reportContent, setReportContent] = useState("")
  const [error, setError] = useState("")
  const reportRef = useRef<HTMLDivElement>(null!) as React.RefObject<HTMLDivElement>

  const conversationMessages = messages
    .filter((m) => m.id !== "welcome" && !m.streaming && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }))

  const userCount = conversationMessages.filter((m) => m.role === "user").length
  const aiCount   = conversationMessages.filter((m) => m.role === "assistant").length

  const handleGenerate = async () => {
    if (conversationMessages.length < 2) {
      setError("대화 내역이 부족합니다. AI와 먼저 대화해주세요.")
      return
    }
    setGenerating(true)
    setReportContent("")
    setError("")
    try {
      const res = await fetch("/api/ai-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: conversationMessages, topic }),
      })
      if (!res.ok) {
        const msg = await res.text()
        throw new Error(msg)
      }
      const data = await res.json()
      setReportContent(data.content)
    } catch (e) {
      setError(e instanceof Error ? e.message : "리포트 생성 실패")
    } finally {
      setGenerating(false)
    }
  }

  const handlePrint = () => {
    if (!reportContent) return
    const now = new Date().toLocaleString("ko-KR")
    const win = window.open("", "_blank")
    if (!win) return
    const html = reportContent
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/^- (.+)$/gm, "<li>$1</li>")
      .replace(/\n/g, "<br/>")
    win.document.write(`<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"/>
<title>대원정밀 MES AI 리포트 - ${now}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Malgun Gothic","Apple SD Gothic Neo",Arial,sans-serif;padding:32px;color:#222}
h1{font-size:20px;color:#1677ff;border-bottom:2px solid #1677ff;padding-bottom:8px;margin-bottom:16px}
h2{font-size:15px;color:#0958d9;border-left:3px solid #1677ff;padding-left:10px;margin:18px 0 8px}
h3{font-size:13px;color:#333;margin:12px 0 6px}
p,li{font-size:12px;line-height:1.8;margin-bottom:4px}
ul{padding-left:20px;margin-bottom:8px}
.hdr{background:#1677ff;color:#fff;padding:16px 24px;border-radius:8px;margin-bottom:24px;display:flex;justify-content:space-between}
.ftr{margin-top:32px;padding-top:12px;border-top:1px solid #eee;font-size:10px;color:#aaa;display:flex;justify-content:space-between}
@media print{body{padding:20px}}
</style></head><body>
<div class="hdr">
<div><div style="font-size:11px;opacity:.8;margin-bottom:2px">MES 운영 분석 리포트</div><div style="font-size:16px;font-weight:700">AI Agent 대화 기반 리포트</div></div>
<div style="text-align:right;font-size:11px;opacity:.85"><div>작성: 대원정밀 MES AI Agent</div><div>${now}</div></div>
</div>
${html}
<div class="ftr"><span>본 리포트는 대원정밀 MES AI Agent가 대화 내역을 분석하여 자동 생성되었습니다.</span><span>${now}</span></div>
</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 400)
  }

  const handlePdf = async () => {
    if (!reportRef.current || !reportContent) return
    setPdfLoading(true)
    try {
      const html2canvas = (await import("html2canvas")).default
      const { jsPDF } = await import("jspdf")

      const canvas = await html2canvas(reportRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      })
      const imgData = canvas.toDataURL("image/png")
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgH = (canvas.height * pageW) / canvas.width
      let remaining = imgH
      let pos = 0

      pdf.addImage(imgData, "PNG", 0, pos, pageW, imgH)
      remaining -= pageH
      while (remaining > 0) {
        pos = remaining - imgH
        pdf.addPage()
        pdf.addImage(imgData, "PNG", 0, pos, pageW, imgH)
        remaining -= pageH
      }

      const now = new Date()
      const fname = `MES_리포트_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,"0")}${String(now.getDate()).padStart(2,"0")}_${String(now.getHours()).padStart(2,"0")}${String(now.getMinutes()).padStart(2,"0")}.pdf`
      pdf.save(fname)
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF 생성 실패")
    } finally {
      setPdfLoading(false)
    }
  }

  const handleClose = () => {
    setReportContent("")
    setError("")
    setTopic("all")
    onClose()
  }

  const selectedTopicLabel = TOPIC_OPTIONS.find((o) => o.value === topic)?.label ?? "전체 대화 내용"

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <DialogTitle className="text-[16px] flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            AI 대화 내역 리포트 생성
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 옵션 영역 */}
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 flex-wrap">
            <span className="text-[13px] font-semibold text-foreground whitespace-nowrap">📋 리포트 범위:</span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5 text-[13px] min-w-[160px] justify-between">
                  {selectedTopicLabel}
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {TOPIC_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => setTopic(opt.value)}
                    className={topic === opt.value ? "text-primary font-medium" : ""}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
              className="ml-auto gap-1.5"
            >
              {generating
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> AI 분석 중...</>
                : <><FileText className="w-3.5 h-3.5" /> 리포트 생성</>
              }
            </Button>
          </div>

          {/* 대화 건수 */}
          <div className="flex gap-2 items-center text-[12px] text-muted-foreground">
            <span>분석 대상:</span>
            <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{userCount}개 질문</span>
            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{aiCount}개 답변</span>
            {topic !== "all" && (
              <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-medium">"{selectedTopicLabel}" 추출</span>
            )}
          </div>

          {/* 에러 */}
          {error && (
            <div className="text-[13px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
              {error}
            </div>
          )}

          {/* 생성 중 */}
          {generating && (
            <div className="text-center py-12 bg-muted/30 rounded-xl border border-dashed">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary mb-4" />
              <p className="text-[13px] text-muted-foreground">AI가 대화 내역을 분석하여 리포트를 작성 중입니다...</p>
              <p className="text-[12px] text-muted-foreground/60 mt-1">약 10~20초 소요됩니다</p>
            </div>
          )}

          {/* 리포트 완성 */}
          {reportContent && !generating && (
            <>
              {/* 액션 버튼 */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-1.5 text-[13px] text-green-600 font-semibold">
                  <CheckCircle2 className="w-4 h-4" />
                  리포트 생성 완료
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePrint}>
                    <Printer className="w-3.5 h-3.5" />
                    인쇄
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1.5 bg-red-500 hover:bg-red-600"
                    onClick={handlePdf}
                    disabled={pdfLoading}
                  >
                    {pdfLoading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> 생성 중...</>
                      : <><FileText className="w-3.5 h-3.5" /> PDF 저장</>
                    }
                  </Button>
                </div>
              </div>

              {/* 리포트 미리보기 */}
              <div className="border rounded-xl overflow-hidden shadow-sm">
                <ReportPreview content={reportContent} reportRef={reportRef} />
              </div>
            </>
          )}

          {/* 초기 안내 */}
          {!reportContent && !generating && !error && (
            <div className="text-center py-10 bg-muted/20 rounded-xl border border-dashed space-y-2">
              <FileText className="w-9 h-9 mx-auto text-muted-foreground/40" />
              <p className="text-[13px] text-muted-foreground">AI가 대화 내역을 분석하여 MES 운영 리포트를 자동 작성합니다</p>
              <p className="text-[12px] text-muted-foreground/60">리포트 범위 선택 후 "리포트 생성" 버튼을 클릭하세요</p>
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                {["전체 대화 요약", "작업지시 분석", "재고 현황 정리", "불량 현황 분석"].map((ex) => (
                  <span key={ex} className="text-[12px] bg-primary/10 text-primary px-3 py-1 rounded-full">
                    {ex}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t flex-shrink-0">
          <Button variant="ghost" className="w-full text-[13px] text-muted-foreground" onClick={handleClose}>
            닫기
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
