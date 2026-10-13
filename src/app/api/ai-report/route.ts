import { NextRequest } from "next/server"
import OpenAI from "openai"
import { isAIEnabled } from "@/lib/services/openai.service"
import { checkDaewonFeatureScopeForApi } from "@/lib/auth/daewon-scope.server"

const REPORT_SYSTEM_PROMPT = `당신은 MES(제조실행시스템) 데이터 분석 전문가입니다.
AI 어시스턴트와 사용자 간의 대화 내역을 분석하여 전문적인 MES 운영 리포트를 작성합니다.

리포트 작성 규칙:
1. 대화에서 언급된 데이터와 수치를 정확히 인용
2. 논리적인 구조로 내용 정리 (현황 → 분석 → 시사점 순)
3. 중요 수치와 상태는 **볼드** 처리
4. 한국어로 작성
5. 전문적이고 간결하게

리포트 형식 (마크다운):
# [리포트 제목]

## 1. 개요
- 작성일시, 분석 범위, 데이터 기준

## 2. 주요 현황
(대화에서 언급된 데이터 기반으로 섹션 구성)

## 3. 분석 및 시사점
- 주요 발견사항
- 개선 필요 사항

## 4. 결론
- 요약 및 권고사항`

export async function POST(req: NextRequest) {
  const scopeStatus = await checkDaewonFeatureScopeForApi()
  if (scopeStatus) {
    return new Response(JSON.stringify({ error: scopeStatus === 401 ? "로그인이 필요합니다." : "권한이 없습니다." }), {
      status: scopeStatus,
      headers: { "Content-Type": "application/json" },
    })
  }
  if (!isAIEnabled()) {
    return new Response("AI 기능이 비활성화되어 있습니다.", { status: 503 })
  }

  let messages: Array<{ role: "user" | "assistant"; content: string }>
  let topic: string

  try {
    const body = await req.json()
    messages = body.messages ?? []
    topic = body.topic ?? "all"
  } catch {
    return new Response("잘못된 요청입니다.", { status: 400 })
  }

  if (messages.length < 2) {
    return new Response("대화 내역이 부족합니다.", { status: 400 })
  }

  const conversationText = messages
    .filter((m) => m.content?.trim())
    .map((m) => `[${m.role === "user" ? "사용자" : "AI"}]: ${m.content}`)
    .join("\n\n")

  const topicInstruction =
    topic === "all"
      ? "전체 대화 내용을 종합하여 MES 운영 리포트를 작성하세요."
      : `대화 내용 중 "${topic}" 관련 내용만 추출하여 리포트를 작성하세요. 해당 내용이 없으면 "해당 주제에 대한 대화 내용이 없습니다"라고 안내하세요.`

  const userPrompt = `다음은 MES AI 어시스턴트와의 대화 내역입니다:

---
${conversationText}
---

${topicInstruction}
현재 날짜/시간: ${new Date().toLocaleString("ko-KR")}`

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.OPENAI_MODEL_ADVANCED ?? process.env.OPENAI_MODEL ?? "gpt-4o"

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: REPORT_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 2000,
    temperature: 0.2,
  })

  const content = completion.choices[0]?.message?.content ?? "리포트 생성 실패"
  return Response.json({ content })
}
