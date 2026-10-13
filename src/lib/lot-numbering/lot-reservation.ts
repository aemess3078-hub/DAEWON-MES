import { Prisma, type PrismaClient } from "@prisma/client"
import { generateCnsMaterialReceiptLotNo } from "./lot-number-generator"
import { escapeCnsNumberingRegExp } from "./lot-number-generator"
import type { CnsItemRuleContext } from "./lot-rule-resolver"

// 자동채번 예약 TTL. 라벨 미리보기 후 실제 입고 확정까지 걸리는 현실적인 시간을 고려해 10분으로 설정.
// 운영 정책 변경 시 이 상수만 수정하면 된다.
export const LOT_RESERVATION_TTL_MS = 10 * 60 * 1000

type ReservationLookupClient = {
  lotNumberReservation: Pick<PrismaClient["lotNumberReservation"], "findMany">
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
}

type LotLookupClient = {
  lot: Pick<PrismaClient["lot"], "findMany">
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>
}

/**
 * 기존 generateCnsMaterialReceiptLotNo를 그대로 재사용하되, Lot 테이블뿐 아니라
 * LotNumberReservation 테이블에 "존재하는 모든 행"(상태 무관)까지 함께 조회해
 * 이미 예약되었거나 발행된 번호와 겹치지 않는 다음 번호를 계산한다.
 *
 * 번호 재사용 정책은 이 조회 단계가 아니라 "행을 남기느냐/지우느냐"로 결정된다:
 * 라벨을 출력하지 않고 취소·재채번·만료된 예약은 행 자체를 삭제하므로 여기서 자동으로 제외되어
 * 번호가 재사용 가능해지고, 라벨을 출력한 뒤 취소·만료된 예약은 행을 남겨(RELEASED/EXPIRED)
 * 여기서 계속 카운트되어 번호가 영구히 재사용되지 않는다.
 */
export async function computeNextMaterialReceiptLotNo(
  db: LotLookupClient & ReservationLookupClient,
  tenantId: string,
  context: CnsItemRuleContext,
  date: Date,
  sequenceOffset = 0,
): Promise<string> {
  const combinedLookup = {
    lot: {
      findMaxSequence: async (args: { tenantId: string; stem: string; numericSuffixDigits?: number }) => {
        const suffix = args.numericSuffixDigits ? `\\d{${args.numericSuffixDigits}}` : "\\d+"
        const pattern = `^${escapeCnsNumberingRegExp(args.stem)}${suffix}$`
        const start = args.stem.length + 1
        const rows = await db.$queryRaw<Array<{ maxSeq: number | null }>>(Prisma.sql`
          SELECT COALESCE(MAX(seq), 0)::int AS "maxSeq"
          FROM (
            SELECT CAST(SUBSTRING("lotNo" FROM CAST(${start} AS integer)) AS INTEGER) AS seq
            FROM "Lot"
            WHERE "tenantId" = ${args.tenantId}
              AND "lotNo" LIKE ${`${args.stem}%`}
              AND "lotNo" ~ ${pattern}
            UNION ALL
            SELECT CAST(SUBSTRING("lotNo" FROM CAST(${start} AS integer)) AS INTEGER) AS seq
            FROM "LotNumberReservation"
            WHERE "tenantId" = ${args.tenantId}
              AND "lotNo" LIKE ${`${args.stem}%`}
              AND "lotNo" ~ ${pattern}
          ) numbered
        `)
        return Number(rows[0]?.maxSeq ?? 0)
      },
    },
    $queryRaw: db.$queryRaw.bind(db),
  }
  return generateCnsMaterialReceiptLotNo(combinedLookup, tenantId, context, date, sequenceOffset)
}

type ReservationExpiryClient = {
  lotNumberReservation: Pick<PrismaClient["lotNumberReservation"], "updateMany" | "deleteMany">
}

/**
 * Lazy expiration — 별도 스케줄러 없이, 만료 시각이 지난 RESERVED 예약을 정리한다.
 * 새 예약을 발급하기 직전, 그리고 기존 예약을 사용(RESERVED 모드 검증)하기 직전에 호출된다.
 *
 * - printedAt이 없는(라벨 미출력) 만료 예약: 행을 삭제 — 번호 재사용 가능
 * - printedAt이 있는(라벨 출력됨) 만료 예약: EXPIRED로 전환, 행 유지 — 번호 영구 재사용 금지
 */
export async function expireStaleReservations(
  db: ReservationExpiryClient,
  tenantId: string,
): Promise<void> {
  const now = new Date()
  await db.lotNumberReservation.deleteMany({
    where: { tenantId, status: "RESERVED", printedAt: null, expiresAt: { lt: now } },
  })
  await db.lotNumberReservation.updateMany({
    where: { tenantId, status: "RESERVED", printedAt: { not: null }, expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  })
}

type ReservationReleaseClient = {
  lotNumberReservation: Pick<PrismaClient["lotNumberReservation"], "findFirst" | "update" | "delete">
}

/**
 * 취소/재채번/수동입력전환/수량0변경/다이얼로그종료 등 "이 예약을 더 이상 안 쓴다" 상황에서
 * 공통으로 호출된다. printedAt 여부에 따라 행을 완전히 지우거나(번호 재사용 허용) 상태만
 * RELEASED로 바꾸고 남겨둔다(번호 영구 재사용 금지).
 * 반환값은 해당 예약이 "라벨 출력된 상태였는지" — 재채번 시 사용자 안내 문구에 사용된다.
 */
export async function releaseOrDeleteReservation(
  db: ReservationReleaseClient,
  reservationId: string,
  tenantId: string,
  purchaseOrderItemId?: string,
): Promise<{ found: boolean; wasPrinted: boolean }> {
  const reservation = await db.lotNumberReservation.findFirst({
    where: {
      id: reservationId,
      tenantId,
      status: "RESERVED",
      ...(purchaseOrderItemId ? { purchaseOrderItemId } : {}),
    },
  })
  if (!reservation) return { found: false, wasPrinted: false }

  if (reservation.printedAt) {
    await db.lotNumberReservation.update({
      where: { id: reservation.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    })
    return { found: true, wasPrinted: true }
  }

  await db.lotNumberReservation.delete({ where: { id: reservation.id } })
  return { found: true, wasPrinted: false }
}
