import { prisma } from "@/lib/db/prisma"
import type { Prisma } from "@prisma/client"
import {
  resolveWorkStandardFileUrls,
  WORK_STANDARD_POP_URL_TTL_SECONDS,
} from "@/lib/storage/work-standard-storage"

type PopWorkStandardDb = Prisma.TransactionClient | typeof prisma

export type PopWorkStandard = {
  mappingId: string
  documentId: string
  code: string
  name: string
  fileUrl: string
  displayOrder: number
}

export async function getWorkStandardsForOperationContext(
  db: PopWorkStandardDb,
  params: {
    tenantId: string
    itemId: string
    routingOperationId: string
  }
): Promise<PopWorkStandard[]> {
  const rows = await db.workStandardMapping.findMany({
    where: {
      tenantId: params.tenantId,
      itemId: params.itemId,
      routingOperationId: params.routingOperationId,
      isActive: true,
      document: {
        docType: "SOP",
        fileUrl: { not: null },
      },
    },
    include: {
      document: {
        select: {
          id: true,
          code: true,
          name: true,
          fileUrl: true,
        },
      },
    },
    orderBy: [
      { displayOrder: "asc" },
      { document: { code: "asc" } },
      { document: { name: "asc" } },
    ],
  })

  const withFile = rows.filter((row) => row.document.fileUrl?.trim())
  // 저장소 파일은 private 버킷이므로 열기 시점에 서버가 짧은 만료의 signed URL 로 변환한다.
  const hrefs = await resolveWorkStandardFileUrls(
    withFile.map((row) => row.document.fileUrl),
    WORK_STANDARD_POP_URL_TTL_SECONDS,
  )

  return withFile.flatMap((row, i) => {
    const href = hrefs[i]
    if (!href) return [] // 서명 URL 발급 실패 → 깨진 링크를 보여주지 않는다(서버 로그에 기록됨)
    return [
      {
        mappingId: row.id,
        documentId: row.documentId,
        code: row.document.code,
        name: row.document.name,
        fileUrl: href,
        displayOrder: row.displayOrder,
      },
    ]
  })
}
