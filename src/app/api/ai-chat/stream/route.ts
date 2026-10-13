import { NextRequest } from "next/server"
import OpenAI from "openai"
import { isAIEnabled } from "@/lib/services/openai.service"
import { getTenantId } from "@/lib/auth"
import { checkDaewonFeatureScopeForApi } from "@/lib/auth/daewon-scope.server"
import {
  getProductionSummary,
  getInventorySummary,
  getSalesOrderSummary,
  getEquipmentSummary,
  getQualitySummary,
} from "@/lib/services/mes-data-query.service"

const MES_SYSTEM_PROMPT = `당신은 대원정밀 MES(클라우드 제조실행시스템)의 AI 어시스턴트입니다.
제조업 현장의 생산관리자, 품질관리자, 설비관리자를 돕습니다.

=== 절대 규칙 (반드시 준수) ===
★ 아래 [DB 데이터]에 없는 수치, 품목명, 번호, 상태는 절대 만들거나 추측하지 마십시오.
★ DB 데이터에 해당 정보가 없으면 반드시 "DB에 해당 데이터가 없습니다"라고 명확히 안내하십시오.
★ 예시, 가정, 임의 수치를 답변에 포함하지 마십시오.
★ "예를 들어", "일반적으로", "보통" 같은 표현으로 없는 데이터를 우회하지 마십시오.

=== 답변 원칙 ===
1. 아래 제공된 [DB 데이터]만을 근거로 답변합니다.
2. DB에 있는 실제 품목코드, 품목명, 수치를 그대로 인용합니다.
3. 위험한 결정(대량 발주, 설비 정지 등)은 사람의 확인을 권고합니다.
4. 한국어로 답변합니다.
5. 응답은 간결하되 실제 데이터의 수치와 근거를 포함합니다.
6. MES/제조/생산/재고/설비/품질/구매 관련 질문에 답변합니다.
7. 날씨, 스포츠, 연예, 정치 등 제조업과 무관한 주제는 거절합니다.
   거절 시: "저는 대원정밀 MES 전용 AI입니다. 제조/생산 관련 질문을 해주세요."
8. DB 데이터가 비어 있거나 조회 실패 시: "현재 해당 데이터를 조회할 수 없습니다. 시스템 관리자에게 문의하거나 직접 화면에서 확인해 주세요."라고 안내합니다.`

async function buildMesContext(tenantId: string, question: string): Promise<string> {
  const q = question.toLowerCase()
  let dataContext = ""
  const fetches: Promise<void>[] = []

  if (q.includes("생산") || q.includes("작업") || q.includes("실적") || q.includes("양품") || q.includes("진행")) {
    fetches.push(
      getProductionSummary(tenantId).then(
        (data) => { dataContext += `\n[생산현황 데이터]\n${JSON.stringify(data, null, 2)}\n` }
      )
    )
  }
  if (q.includes("재고") || q.includes("자재") || q.includes("부족") || q.includes("창고") || q.includes("입고")) {
    fetches.push(
      getInventorySummary(tenantId).then(
        (data) => { dataContext += `\n[재고현황 데이터]\n${JSON.stringify(data, null, 2)}\n` }
      )
    )
  }
  if (q.includes("수주") || q.includes("납기") || q.includes("고객") || q.includes("출하") || q.includes("견적")) {
    fetches.push(
      getSalesOrderSummary(tenantId).then(
        (data) => { dataContext += `\n[수주현황 데이터]\n${JSON.stringify(data, null, 2)}\n` }
      )
    )
  }
  if (q.includes("설비") || q.includes("가동") || q.includes("비가동") || q.includes("알람") || q.includes("고장")) {
    fetches.push(
      getEquipmentSummary(tenantId).then(
        (data) => { dataContext += `\n[설비현황 데이터]\n${JSON.stringify(data, null, 2)}\n` }
      )
    )
  }
  if (q.includes("품질") || q.includes("검사") || q.includes("불량") || q.includes("합격")) {
    fetches.push(
      getQualitySummary(tenantId).then(
        (data) => { dataContext += `\n[품질현황 데이터]\n${JSON.stringify(data, null, 2)}\n` }
      )
    )
  }

  // 키워드 미매칭 시 생산현황 기본 조회
  if (fetches.length === 0) {
    const data = await getProductionSummary(tenantId)
    dataContext = `\n[생산현황 데이터]\n${JSON.stringify(data, null, 2)}\n`
  } else {
    await Promise.all(fetches)
  }

  return dataContext
}

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

  const tenantId = await getTenantId()

  let message: string
  let context: string | undefined
  let history: Array<{ role: "user" | "assistant"; content: string }> = []

  try {
    const body = await req.json()
    message = body.message
    context = body.context
    history = body.history ?? []
  } catch {
    return new Response("잘못된 요청입니다.", { status: 400 })
  }

  if (!message?.trim()) {
    return new Response("메시지가 비어 있습니다.", { status: 400 })
  }

  let dataContext = ""
  try {
    dataContext = await buildMesContext(tenantId, message)
  } catch {
    dataContext = "\n[데이터 조회 실패 — 일반적인 안내로 응답해주세요]\n"
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const model = process.env.OPENAI_MODEL_ADVANCED ?? process.env.OPENAI_MODEL ?? "gpt-4o"
  const systemPrompt =
    MES_SYSTEM_PROMPT +
    `\n\n현재 페이지 컨텍스트: ${context ?? "일반"}\n조회 시각: ${new Date().toLocaleString("ko-KR")}\n${dataContext}`

  const stream = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...history.slice(-10), // 최근 10개 대화만 컨텍스트에 포함
      { role: "user", content: message },
    ],
    stream: true,
    temperature: 0.3,
    max_tokens: 1500,
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? ""
          if (delta) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`))
          }
        }
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"))
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}
