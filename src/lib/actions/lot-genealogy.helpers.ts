import { LotGenealogyRelation, Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

// ─── LOT 계보 관리 헬퍼 ──────────────────────────────────────────────────────
//
// Phase 4-B-1: LotGenealogy 모델 활성화 기반
//
// [relationType 사용 기준]
//   INPUT  : parentLot 이 childLot 생산에 투입된 관계
//            원자재 LOT → 반제품 LOT, 반제품 LOT → 완제품 LOT 모두 INPUT 사용
//            upstream 조회의 기본 필터
//   OUTPUT : 예약 — 부산물 등 향후 사용
//   REWORK : parentLot 을 재작업하여 childLot 을 생성한 관계
//
// [schema 제약 — 변경 불가]
//   - LotGenealogy 에 tenantId 없음 → Lot.tenantId 조인으로 tenant 격리
//   - LotGenealogy 에 sourceType/sourceId/note 없음 → 출처 직접 연결 불가
//   - qty 는 Decimal(18,6) 필수이며 0 초과 필수
//   - @@unique([parentLotId, childLotId, relationType]) → 중복 방지 내장
//
// 이 파일은 Server Action 이 아닌 내부 헬퍼 모듈이므로 "use server" 미사용.
// createLotGenealogyLink 는 트랜잭션 클라이언트를 받아 입고 흐름에서 호출 가능.
// 읽기 함수들은 prisma 클라이언트를 직접 사용한다.

// ─── 타입 ─────────────────────────────────────────────────────────────────────

/** createLotGenealogyLink 에 전달하는 트랜잭션 클라이언트 타입 */
export type LotGenealogyTx = Prisma.TransactionClient

/**
 * LOT 계보 트리 노드.
 *
 * relationType/qty 는 이 노드가 자식(child) LOT 생산에 투입된 방식을 나타낸다.
 * 루트 노드(조회 기준 LOT) 는 relationType=null, qty=null.
 */
export type LotGenealogyNode = {
  lot: {
    id: string
    lotNo: string
    tenantId: string
    status: string
    manufactureDate: Date | null
    item: {
      id: string
      code: string
      name: string
      spec: string | null
      uom: string
      /** ItemType enum 값 문자열 (RAW_MATERIAL / SEMI_FINISHED / FINISHED / CONSUMABLE) */
      itemType: string | null
    }
  }
  /** 이 노드와 자식 노드 사이의 관계 유형. 루트 노드는 null. */
  relationType: LotGenealogyRelation | null
  /** 이 LOT 에서 자식 LOT 생산에 투입된 수량. 루트 노드는 null. */
  qty: number | null
  /** 이 LOT 생산에 투입된 상위 LOT 목록 (upstream) */
  parents: LotGenealogyNode[]
}

// ─── relationType 참조 상수 ───────────────────────────────────────────────────

/**
 * LotGenealogyRelation enum 참조용 상수.
 * 직접 LotGenealogyRelation 을 import 해도 동일하다.
 */
export const LOT_RELATION = {
  /** 투입 관계: 원자재 → 반제품, 반제품 → 완제품 모두 INPUT */
  INPUT: LotGenealogyRelation.INPUT,
  /** 예약 — 부산물 등 향후 사용 */
  OUTPUT: LotGenealogyRelation.OUTPUT,
  /** 재작업 관계 */
  REWORK: LotGenealogyRelation.REWORK,
} as const

// ─── createLotGenealogyLink ───────────────────────────────────────────────────

/**
 * 두 LOT 사이의 계보 관계를 생성 또는 수량 갱신한다.
 *
 * schema @@unique([parentLotId, childLotId, relationType]) 에 의해
 * 동일 관계의 중복 생성은 방지되며 upsert 로 멱등하게 처리한다.
 *
 * @param tx    트랜잭션 클라이언트 (완제품/반제품 입고 흐름의 tx 전달)
 * @param params.tenantId     tenant 격리 검증용
 * @param params.parentLotId  투입된 상위 LOT (원자재 또는 반제품)
 * @param params.childLotId   생산된 하위 LOT (반제품 또는 완제품)
 * @param params.relationType INPUT / OUTPUT / REWORK
 * @param params.qty          투입 수량 (0 초과 필수)
 */
export async function createLotGenealogyLink(
  tx: LotGenealogyTx,
  params: {
    tenantId: string
    parentLotId: string
    childLotId: string
    relationType: LotGenealogyRelation
    qty: number
  },
): Promise<void> {
  const { tenantId, parentLotId, childLotId, relationType, qty } = params

  if (parentLotId === childLotId) {
    throw new Error(
      `[LotGenealogy] parentLotId 와 childLotId 가 동일합니다. lotId=${parentLotId}`,
    )
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error(`[LotGenealogy] qty 는 0 보다 커야 합니다. qty=${qty}`)
  }

  const [parent, child] = await Promise.all([
    tx.lot.findUnique({ where: { id: parentLotId }, select: { tenantId: true } }),
    tx.lot.findUnique({ where: { id: childLotId }, select: { tenantId: true } }),
  ])

  if (!parent) {
    throw new Error(`[LotGenealogy] parentLot 을 찾을 수 없습니다. lotId=${parentLotId}`)
  }
  if (!child) {
    throw new Error(`[LotGenealogy] childLot 을 찾을 수 없습니다. lotId=${childLotId}`)
  }
  if (parent.tenantId !== tenantId || child.tenantId !== tenantId) {
    throw new Error(
      `[LotGenealogy] LOT 의 tenantId 가 요청 tenantId 와 일치하지 않습니다.`,
    )
  }

  await tx.lotGenealogy.upsert({
    where: {
      parentLotId_childLotId_relationType: { parentLotId, childLotId, relationType },
    },
    update: { qty },
    create: { parentLotId, childLotId, relationType, qty },
  })
}

// ─── getLotGenealogyTree ──────────────────────────────────────────────────────

/**
 * 특정 LOT 의 직접 상위 LOT (1단계 부모) 를 포함한 노드를 반환한다.
 * 재귀 없이 depth=1 만 조회한다.
 *
 * 전체 upstream 트리가 필요하면 getUpstreamLots 를 사용하라.
 */
export async function getLotGenealogyTree(params: {
  tenantId: string
  lotId: string
}): Promise<LotGenealogyNode | null> {
  const { tenantId, lotId } = params

  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: {
      item: { select: { id: true, code: true, name: true, spec: true, uom: true, itemType: true } },
    },
  })
  if (!lot || lot.tenantId !== tenantId) return null

  const parentLinks = await prisma.lotGenealogy.findMany({
    where: { childLotId: lotId },
    include: {
      parentLot: {
        include: {
          item: { select: { id: true, code: true, name: true, spec: true, uom: true, itemType: true } },
        },
      },
    },
  })

  const parents: LotGenealogyNode[] = parentLinks
    .filter((link) => link.parentLot.tenantId === tenantId)
    .map((link) => ({
      lot: {
        id: link.parentLot.id,
        lotNo: link.parentLot.lotNo,
        tenantId: link.parentLot.tenantId,
        status: link.parentLot.status,
        manufactureDate: link.parentLot.manufactureDate,
        item: {
          id: link.parentLot.item.id,
          code: link.parentLot.item.code,
          name: link.parentLot.item.name,
          spec: link.parentLot.item.spec ?? null,
          uom: link.parentLot.item.uom,
          itemType: link.parentLot.item.itemType ?? null,
        },
      },
      relationType: link.relationType,
      qty: Number(link.qty),
      parents: [],
    }))

  return {
    lot: {
      id: lot.id,
      lotNo: lot.lotNo,
      tenantId: lot.tenantId,
      status: lot.status,
      manufactureDate: lot.manufactureDate,
      item: {
        id: lot.item.id,
        code: lot.item.code,
        name: lot.item.name,
        spec: lot.item.spec ?? null,
        uom: lot.item.uom,
        itemType: lot.item.itemType ?? null,
      },
    },
    relationType: null,
    qty: null,
    parents,
  }
}

// ─── getUpstreamLots ──────────────────────────────────────────────────────────

/**
 * 최종 LOT 기준으로 상위 LOT 를 재귀 조회한다.
 *
 * - relationType 미지정 시 모든 관계 유형을 포함한다.
 * - maxDepth 기본값 5 (무한 루프 방지).
 * - visited 집합으로 순환 참조를 방지한다.
 *
 * 반환 트리 구조:
 *   완제품 LOT (root, relationType=null)
 *     └ 반제품 LOT A (relationType=INPUT)
 *         └ 원자재 LOT X (relationType=INPUT)
 *         └ 원자재 LOT Y (relationType=INPUT)
 *     └ 반제품 LOT B (relationType=INPUT)
 *         └ 원자재 LOT Z (relationType=INPUT)
 */
export async function getUpstreamLots(params: {
  tenantId: string
  lotId: string
  relationType?: LotGenealogyRelation
  maxDepth?: number
}): Promise<LotGenealogyNode | null> {
  const { tenantId, lotId, relationType, maxDepth = 5 } = params
  const visited = new Set<string>()

  async function fetchNode(
    currentLotId: string,
    incomingRelationType: LotGenealogyRelation | null,
    incomingQty: number | null,
    depth: number,
  ): Promise<LotGenealogyNode | null> {
    if (depth > maxDepth || visited.has(currentLotId)) return null
    visited.add(currentLotId)

    const lot = await prisma.lot.findUnique({
      where: { id: currentLotId },
      include: {
        item: { select: { id: true, code: true, name: true, spec: true, uom: true, itemType: true } },
      },
    })
    if (!lot || lot.tenantId !== tenantId) return null

    const parentLinks = await prisma.lotGenealogy.findMany({
      where: {
        childLotId: currentLotId,
        ...(relationType !== undefined ? { relationType } : {}),
      },
      include: {
        parentLot: {
          include: {
            item: { select: { id: true, code: true, name: true, spec: true, uom: true, itemType: true } },
          },
        },
      },
    })

    const parents: LotGenealogyNode[] = []
    for (const link of parentLinks) {
      if (link.parentLot.tenantId !== tenantId) continue
      const parentNode = await fetchNode(
        link.parentLotId,
        link.relationType,
        Number(link.qty),
        depth + 1,
      )
      if (parentNode) parents.push(parentNode)
    }

    return {
      lot: {
        id: lot.id,
        lotNo: lot.lotNo,
        tenantId: lot.tenantId,
        status: lot.status,
        manufactureDate: lot.manufactureDate,
        item: {
          id: lot.item.id,
          code: lot.item.code,
          name: lot.item.name,
          spec: lot.item.spec ?? null,
          uom: lot.item.uom,
          itemType: lot.item.itemType ?? null,
        },
      },
      relationType: incomingRelationType,
      qty: incomingQty,
      parents,
    }
  }

  return fetchNode(lotId, null, null, 0)
}

// ─── getLotGenealogyForTraceability ──────────────────────────────────────────

/**
 * 제조번호 추적성 화면에서 사용할 LOT 계보 조회 진입점.
 *
 * 완제품 LOT 기준으로 상위(반제품 → 원자재) LOT 계층을 반환한다.
 * relationType=INPUT 만 조회하여 투입 계보만 추적한다.
 *
 * 향후 manufacturing-traceability.actions.ts 에서 아래와 같이 import 한다:
 *
 *   import { getLotGenealogyForTraceability } from "./lot-genealogy.helpers"
 *
 *   // getManufacturingTraceability 내 완제품 LOT ID 확보 후:
 *   const lotLineage = await getLotGenealogyForTraceability(lotId, tenantId)
 *
 * @param lotId      완제품 또는 반제품 LOT ID (조회 기준)
 * @param tenantId   tenant 격리 필터
 * @returns LotGenealogyNode 트리 (데이터 없으면 parents 빈 배열로 반환)
 */
export async function getLotGenealogyForTraceability(
  lotId: string,
  tenantId: string,
): Promise<LotGenealogyNode | null> {
  return getUpstreamLots({
    tenantId,
    lotId,
    relationType: LotGenealogyRelation.INPUT,
    maxDepth: 5,
  })
}
