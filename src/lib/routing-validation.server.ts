import { prisma } from "@/lib/db/prisma"
import type { Prisma } from "@prisma/client"

type RoutingValidationDb = Prisma.TransactionClient | typeof prisma

export async function validateRoutingForItemContext(
  db: RoutingValidationDb,
  params: {
    tenantId: string
    itemId: string
    routingId: string
  }
): Promise<void> {
  const routing = await db.routing.findFirst({
    where: { id: params.routingId, tenantId: params.tenantId },
    select: { status: true, scope: true },
  })
  if (!routing) {
    throw new Error("선택한 라우팅을 찾을 수 없습니다.")
  }
  if (routing.status !== "ACTIVE") {
    throw new Error("비활성 상태의 라우팅은 선택할 수 없습니다.")
  }
  if (routing.scope === "ITEM_SPECIFIC") {
    const link = await db.itemRouting.findFirst({
      where: { itemId: params.itemId, routingId: params.routingId },
      select: { id: true },
    })
    if (!link) {
      throw new Error("선택한 라우팅은 이 품목에 연결되어 있지 않습니다.")
    }
  }
}
