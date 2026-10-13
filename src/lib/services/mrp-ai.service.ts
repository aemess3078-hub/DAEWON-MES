import type { MRPResult } from "./mrp.service"

export type AIOrderSuggestion = {
  suggestions: Array<{
    itemCode: string
    suggestedQty: number
    suggestedSupplier: string | null
    reason: string
    urgency: "HIGH" | "MEDIUM" | "LOW"
    orderBy: string | null
    estimatedCost: number | null
  }>
  summary: string
  risks: string[]
}

export async function suggestOptimalOrder(
  mrpResult: MRPResult,
  tenantId: string
): Promise<AIOrderSuggestion | null> {
  try {
    const { jsonCompletion, isAIEnabled } = await import("./openai.service")
    if (!isAIEnabled()) return null

    const shortageItems = mrpResult.items.filter((i) => i.status !== "SUFFICIENT")
    if (shortageItems.length === 0) return null

    // 공급사 이력 조회 (조건부)
    let supplierInfo: unknown[] = []
    try {
      const { prisma } = await import("@/lib/db/prisma")
      const recentPOs = await prisma.purchaseOrder.findMany({
        where: { tenantId },
        include: {
          supplier: true,
          items: { select: { itemId: true, qty: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      })
      supplierInfo = recentPOs.map((po) => ({
        supplier: po.supplier?.name,
        items: po.items.map((i) => ({ itemId: i.itemId, qty: Number(i.qty) })),
        status: po.status,
      }))
    } catch {
      // PurchaseOrder 없으면 무시
    }

    const payload = {
      shortageItems: shortageItems.map((i) => ({
        itemCode: i.itemCode,
        itemName: i.itemName,
        netRequirement: Math.round(i.netRequirement * 100) / 100,
        currentStock: Math.round(i.currentStock * 100) / 100,
        status: i.status,
        uom: i.uom,
      })),
      supplierHistory: supplierInfo,
      currentDate: new Date().toISOString().split("T")[0],
    }

    const systemPrompt = `당신은 제조업 자재 구매 전문가입니다.
MRP 소요량 계산 결과를 분석하고 최적의 발주 전략을 제안합니다.
반드시 다음 JSON 형식으로만 답변하세요:
{
  "suggestions": [
    {
      "itemCode": "품목코드",
      "suggestedQty": 발주수량(숫자),
      "suggestedSupplier": "공급사명 또는 null",
      "reason": "발주 근거 설명",
      "urgency": "HIGH|MEDIUM|LOW",
      "orderBy": "YYYY-MM-DD 또는 null",
      "estimatedCost": 예상비용(숫자) 또는 null
    }
  ],
  "summary": "전체 발주 전략 요약",
  "risks": ["리스크1", "리스크2"]
}`

    const { data } = await jsonCompletion<AIOrderSuggestion>({
      systemPrompt,
      userMessage: JSON.stringify(payload),
    })

    return data
  } catch (e) {
    console.error("MRP AI 분석 실패:", e)
    return null
  }
}
