import type { Prisma } from "@prisma/client"

export async function resolveFinishedGoodsReceiptDestination(
  tx: Prisma.TransactionClient,
  input: {
    warehouseId: string
    tenantId: string
    siteId: string
  },
) {
  const warehouse = await tx.warehouse.findFirst({
    where: {
      id: input.warehouseId,
      tenantId: input.tenantId,
      siteId: input.siteId,
    },
    select: { id: true },
  })
  if (!warehouse) {
    throw new Error("입고 로케이션이 올바르지 않습니다.")
  }

  const locations = await tx.location.findMany({
    where: { warehouseId: warehouse.id },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  })

  const defaultLocation = locations.find((location) => location.code === "DEFAULT")
  if (defaultLocation) return { warehouse, location: defaultLocation }
  if (locations.length === 1) return { warehouse, location: locations[0] }

  // createMany + skipDuplicates는 DB의 ON CONFLICT DO NOTHING을 사용한다.
  // 동시 입고가 DEFAULT를 먼저 생성해도 복합 unique 키를 재조회해 같은 위치를 사용한다.
  await tx.location.createMany({
    data: {
      warehouseId: warehouse.id,
      code: "DEFAULT",
      name: "기본 위치",
      locationType: "DEFAULT",
    },
    skipDuplicates: true,
  })

  const location = await tx.location.findUnique({
    where: {
      warehouseId_code: {
        warehouseId: warehouse.id,
        code: "DEFAULT",
      },
    },
    select: { id: true, code: true },
  })
  if (!location) {
    throw new Error("입고 기본 위치를 결정할 수 없습니다.")
  }
  return { warehouse, location }
}
