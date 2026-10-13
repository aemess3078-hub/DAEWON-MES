"use server"

import { naturalLanguageQuery, isAIEnabled } from "@/lib/services/mes-ai.service"
import { getTenantId } from "@/lib/auth"
import { assertDaewonFeatureScope } from "@/lib/auth/daewon-scope.server"

export async function sendAIChatMessage(message: string, context?: string) {
  await assertDaewonFeatureScope()
  if (!isAIEnabled()) {
    return { error: "AI 기능이 비활성화되어 있습니다." }
  }
  try {
    const tenantId = await getTenantId()
    const reply = await naturalLanguageQuery(tenantId, message, context)
    return { reply }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "AI 응답 실패"
    return { error: msg }
  }
}

export async function checkAIStatus() {
  await assertDaewonFeatureScope()
  return { enabled: isAIEnabled() }
}
