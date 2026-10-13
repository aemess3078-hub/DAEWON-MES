import { chatCompletion, jsonCompletion, isAIEnabled } from "./openai.service"
import { logAIUsage } from "./ai-usage.service"
import {
  getProductionSummary,
  getInventorySummary,
  getSalesOrderSummary,
  getEquipmentSummary,
  getQualitySummary,
} from "./mes-data-query.service"

const MES_SYSTEM_PROMPT = `당신은 대원정밀 MES(클라우드 제조실행시스템)의 AI 어시스턴트입니다.
제조업 현장의 생산관리자, 품질관리자, 설비관리자를 돕습니다.

원칙:
1. 정확한 데이터에 기반하여 분석합니다.
2. 불확실한 내용은 반드시 "추가 확인 필요"로 표시합니다.
3. 제안은 근거(데이터)와 함께 제시합니다.
4. 위험한 결정(대량 발주, 설비 정지 등)은 반드시 사람의 확인을 권고합니다.
5. 한국어로 답변합니다.
6. 제조업 용어를 정확히 사용합니다.
7. 응답은 간결하되 핵심 근거를 포함합니다.`

export { isAIEnabled }

export async function analyzeMRPResult(tenantId: string, mrpData: unknown) {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  const { data, usage } = await jsonCompletion<unknown>({
    systemPrompt: MES_SYSTEM_PROMPT + "\n\nMRP 소요량 계산 결과를 분석하고 최적의 발주 전략을 제안하세요. 반드시 JSON 형식으로 답변하세요.",
    userMessage: JSON.stringify(mrpData),
    model,
  })
  await logAIUsage({ tenantId, feature: "MRP_SUGGESTION", model, ...usage })
  return data
}

export async function analyzeEquipmentData(tenantId: string, equipmentData: unknown) {
  const model = process.env.OPENAI_MODEL_ADVANCED ?? "gpt-4o"
  const { data, usage } = await jsonCompletion<unknown>({
    systemPrompt: MES_SYSTEM_PROMPT + "\n\n설비 센서 데이터를 분석하고 이상 여부를 판단하세요. 원인 확률 순위와 권장 조치를 제시하세요. JSON으로 답변하세요.",
    userMessage: JSON.stringify(equipmentData),
    model,
  })
  await logAIUsage({ tenantId, feature: "ANOMALY_ANALYSIS", model, ...usage })
  return data
}

export async function predictMaintenance(tenantId: string, historyData: unknown) {
  const model = process.env.OPENAI_MODEL_ADVANCED ?? "gpt-4o"
  const { data, usage } = await jsonCompletion<unknown>({
    systemPrompt: MES_SYSTEM_PROMPT + "\n\n설비 이력 데이터를 분석하여 고장 확률을 예측하고 보전 일정을 추천하세요. JSON으로 답변하세요.",
    userMessage: JSON.stringify(historyData),
    model,
  })
  await logAIUsage({ tenantId, feature: "PREDICTIVE_MAINTENANCE", model, ...usage })
  return data
}

export async function analyzeClaim(tenantId: string, claimData: unknown) {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  const { data, usage } = await jsonCompletion<unknown>({
    systemPrompt: MES_SYSTEM_PROMPT + "\n\n고객 클레임 내용과 관련 LOT 이력을 분석하여 원인 후보를 제시하세요. JSON으로 답변하세요.",
    userMessage: JSON.stringify(claimData),
    model,
  })
  await logAIUsage({ tenantId, feature: "CLAIM_ANALYSIS", model, ...usage })
  return data
}

export async function predictQuality(tenantId: string, processParams: unknown) {
  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  const { data, usage } = await jsonCompletion<unknown>({
    systemPrompt: MES_SYSTEM_PROMPT + "\n\n공정 파라미터를 분석하여 품질 예측을 수행하세요. 불량 가능성과 주의 항목을 제시하세요. JSON으로 답변하세요.",
    userMessage: JSON.stringify(processParams),
    model,
  })
  await logAIUsage({ tenantId, feature: "QUALITY_PREDICTION", model, ...usage })
  return data
}

const MES_KEYWORDS = [
  "생산", "작업", "재고", "품목", "설비", "품질", "불량", "BOM", "라우팅", "공정",
  "수주", "발주", "출하", "견적", "원가", "MRP", "소요", "작업지시", "계획",
  "LOT", "추적", "검사", "납기", "진행", "현황", "실적", "양품", "보전",
  "자재", "입고", "출고", "창고", "재공", "완제품", "반제품", "원자재",
  "금형", "클레임", "변경", "ECN", "태그", "게이트웨이", "알람",
  "대시보드", "보고서", "일보", "월보", "이력",
]

function isMESRelated(question: string): boolean {
  const q = question.toLowerCase()
  return MES_KEYWORDS.some((keyword) => q.includes(keyword.toLowerCase()))
}

export async function naturalLanguageQuery(
  tenantId: string,
  question: string,
  context?: string
): Promise<string> {
  if (!isMESRelated(question)) {
    return (
      "안녕하세요! 저는 대원정밀 MES 제조실행시스템 전용 AI 어시스턴트입니다.\n\n" +
      "생산현황, 재고, 품질, 설비, 수주/발주 등 MES 관련 질문에 답변드릴 수 있습니다.\n\n" +
      "예시:\n" +
      "• 현재 생산 진행현황 알려줘\n" +
      "• 재고 부족한 품목이 있어?\n" +
      "• 오늘 양품률은?\n" +
      "• 납기 임박한 수주 건 보여줘\n" +
      "• 설비 가동 상태 알려줘"
    )
  }

  let dataContext = ""
  try {
    const q = question.toLowerCase()
    const fetches: Promise<void>[] = []

    if (
      q.includes("생산") || q.includes("작업") || q.includes("실적") ||
      q.includes("양품") || q.includes("진행")
    ) {
      fetches.push(
        getProductionSummary(tenantId).then(
          (data) => { dataContext += `\n[생산현황 데이터]\n${JSON.stringify(data, null, 2)}\n` }
        )
      )
    }
    if (q.includes("재고") || q.includes("자재") || q.includes("부족") || q.includes("창고")) {
      fetches.push(
        getInventorySummary(tenantId).then(
          (data) => { dataContext += `\n[재고현황 데이터]\n${JSON.stringify(data, null, 2)}\n` }
        )
      )
    }
    if (q.includes("수주") || q.includes("납기") || q.includes("고객") || q.includes("출하")) {
      fetches.push(
        getSalesOrderSummary(tenantId).then(
          (data) => { dataContext += `\n[수주현황 데이터]\n${JSON.stringify(data, null, 2)}\n` }
        )
      )
    }
    if (q.includes("설비") || q.includes("가동") || q.includes("비가동") || q.includes("알람")) {
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

    await Promise.all(fetches)

    if (!dataContext) {
      const data = await getProductionSummary(tenantId)
      dataContext = `\n[생산현황 데이터]\n${JSON.stringify(data, null, 2)}\n`
    }
  } catch {
    dataContext = "\n[데이터 조회 실패 — 일반적인 안내로 응답해주세요]\n"
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  const systemPrompt =
    MES_SYSTEM_PROMPT +
    `\n\n당신은 MES 시스템의 실제 데이터를 기반으로 답변합니다.\n아래에 현재 시스템의 실시간 데이터가 제공됩니다. 이 데이터를 기반으로 정확하게 답변하세요.\n\n중요 규칙:\n- MES(제조실행시스템) 관련 질문에만 답변합니다.\n- 제공된 실제 데이터를 인용하여 답변하세요.\n- 숫자와 현황을 구체적으로 알려주세요.\n- 문제가 있으면 개선 제안도 해주세요.\n- 현재 페이지 컨텍스트: ${context ?? "일반"}\n${dataContext}`

  const { content, usage } = await chatCompletion({
    systemPrompt,
    userMessage: question,
    model,
  })
  await logAIUsage({
    tenantId,
    feature: "NL_QUERY",
    model,
    ...usage,
    requestSummary: question.slice(0, 100),
  })
  return content
}
