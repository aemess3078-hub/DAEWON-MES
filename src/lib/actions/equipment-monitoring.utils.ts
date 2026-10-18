import { Prisma } from "@prisma/client"

// 현황/분석/통계/키오스크 모니터링 화면에 노출할 설비 조건.
// 설비관리에는 등록돼 있지만 실제 연동이 없는 수동/미연동/설치예정 설비는 제외한다.
//  - status: ACTIVE/MAINTENANCE는 표시(점검중 배지는 equipment-monitor-grid.tsx가
//    담당), INACTIVE는 미표시
//  - 연동 완료 판별: 현재 실제 수집 API/워커가 있는 프로토콜은 NCWatch뿐이므로
//    활성(isActive) NcwatchEquipmentMapping 존재로만 판단한다.
//    (OPC_UA/MODBUS_TCP 등은 "설비연결설정" 화면에 입력 폼만 있고 수집 구현이
//    없어 활성 EquipmentConnection만으로는 실제 연동을 보장할 수 없다 — 해당
//    프로토콜의 수집기가 실제로 구현되면 이 조건에 추가한다.)
export function monitoringEligibleEquipmentWhere(tenantId: string): Prisma.EquipmentWhereInput {
  return {
    tenantId,
    status: { in: ["ACTIVE", "MAINTENANCE"] },
    equipmentType: { notIn: ["TOOL", "JIG", "FIXTURE"] },
    ncwatchMappings: { some: { isActive: true } },
  }
}

// ─── 태그별 "최신 스냅샷 1건"만 조회 ───────────────────────────────────────────
// TagSnapshot 은 태그당 하루 수천 건씩 쌓이는 이력 테이블이다. 최신값만 필요할 때 아래 방식은 쓰지 않는다.
//  ✗ Prisma 중첩 조회 `snapshots: { orderBy: { timestamp: "desc" }, take: 1 }`
//    → SQL 에 LIMIT 가 없어(`WHERE tagId IN (…) ORDER BY timestamp DESC OFFSET $n`) 해당 태그들의 "전체 이력"이
//      DB 에서 앱으로 전송된 뒤 Prisma 가 메모리에서 1건만 남긴다 (스냅샷이 쌓일수록 egress/지연 폭증).
//  ✗ `SELECT DISTINCT ON ("tagId") … WHERE tagId IN (…) ORDER BY "tagId","timestamp" DESC`
//    → 앱으로는 1행씩이지만 DB 가 태그의 전체 이력을 읽어 중복 제거한다.
//  ✓ 태그마다 인덱스("tagId","timestamp") 를 거꾸로 1번만 타는 LATERAL + LIMIT 1 → 이력 크기와 무관(O(태그 수 × log N)).
export type LatestSnapshotRow = { tagId: string; value: string | null; timestamp: Date }

type RawQueryClient = {
  $queryRaw: <T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<T>
}

export async function fetchLatestSnapshotsByTag(
  db: RawQueryClient,
  tagIds: string[],
): Promise<Map<string, LatestSnapshotRow>> {
  const result = new Map<string, LatestSnapshotRow>()
  if (tagIds.length === 0) return result

  const rows = await db.$queryRaw<LatestSnapshotRow[]>(
    Prisma.sql`
      SELECT t."tagId" AS "tagId", s."value" AS "value", s."timestamp" AS "timestamp"
      FROM unnest(ARRAY[${Prisma.join(tagIds)}]::text[]) AS t("tagId")
      CROSS JOIN LATERAL (
        SELECT "value", "timestamp"
        FROM "TagSnapshot"
        WHERE "tagId" = t."tagId"
        ORDER BY "timestamp" DESC
        LIMIT 1
      ) s
    `,
  )
  for (const row of rows) result.set(row.tagId, row)
  return result
}
