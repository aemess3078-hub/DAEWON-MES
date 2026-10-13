import { prisma } from "@/lib/db/prisma"
import { Decimal } from "@prisma/client/runtime/library"

const COST_TABLE: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
}

export async function logAIUsage(params: {
  tenantId: string
  feature: string
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  requestSummary?: string
}) {
  const cost = COST_TABLE[params.model]
  const costEstimate = cost
    ? (params.promptTokens * cost.input + params.completionTokens * cost.output) / 1_000_000
    : null

  await prisma.aIUsageLog.create({
    data: {
      tenantId: params.tenantId,
      feature: params.feature,
      model: params.model,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      totalTokens: params.totalTokens,
      costEstimate: costEstimate != null ? new Decimal(costEstimate.toFixed(6)) : null,
      requestSummary: params.requestSummary,
    },
  })
}

export async function getMonthlyUsage(tenantId: string) {
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  return prisma.aIUsageLog.groupBy({
    by: ["feature", "model"],
    where: { tenantId, createdAt: { gte: startOfMonth } },
    _sum: { totalTokens: true, costEstimate: true },
    _count: true,
  })
}
