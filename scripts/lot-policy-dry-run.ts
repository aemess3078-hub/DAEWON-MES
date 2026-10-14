/**
 * LOT 추적 정책 Dry-run (Phase 11 / DG-001) — READ ONLY.
 *
 * 현재 Item/BOM/수주/발주/재고 마스터를 읽어 품목별 LOT 추적 "제안"만 계산한다.
 *  - 모든 조회는 `SET TRANSACTION READ ONLY` 트랜잭션 안에서 SELECT 로만 수행한다(DB 가 쓰기를 거부).
 *  - Item.isLotTracked 를 포함해 어떤 값도 수정하지 않는다. 적용은 별도 승인 후 다른 절차로 수행한다.
 *
 * 실행:  npm run lot-policy:dry-run [-- --csv <출력경로>]
 *   (.env 의 DATABASE_URL 또는 DIRECT_URL 사용. 로컬/비운영 DB 권장)
 */
import { writeFileSync } from "node:fs"
import { PrismaClient } from "@prisma/client"
import { classifyLotPolicy, summarizeLotPolicy, type LotPolicyProposal } from "../src/lib/lot-policy/lot-policy"

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

async function main() {
  const prisma = new PrismaClient({ log: [] })
  try {
    const proposals = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
        const [items, boms, bomItems, soItems, shipItems, poItems, balances] = await Promise.all([
          tx.item.findMany({
            select: { id: true, code: true, name: true, itemType: true, status: true, isLotTracked: true },
            orderBy: { code: "asc" },
          }),
          tx.bOM.findMany({ select: { itemId: true } }),
          tx.bOMItem.findMany({ select: { componentItemId: true } }),
          tx.salesOrderItem.findMany({ select: { itemId: true } }),
          tx.shipmentItem.findMany({ select: { itemId: true } }),
          tx.purchaseOrderItem.findMany({ select: { itemId: true } }),
          tx.inventoryBalance.findMany({ select: { itemId: true }, distinct: ["itemId"] }),
        ])
        const parents = new Set(boms.map((b) => b.itemId))
        const components = new Set(bomItems.map((b) => b.componentItemId))
        const sales = new Set([...soItems.map((s) => s.itemId), ...shipItems.map((s) => s.itemId)])
        const purchases = new Set(poItems.map((p) => p.itemId))
        const inventory = new Set(balances.map((b) => b.itemId))
        return items.map((item) =>
          classifyLotPolicy({
            id: item.id,
            code: item.code,
            name: item.name,
            itemType: String(item.itemType),
            status: String(item.status),
            isLotTracked: item.isLotTracked,
            isBomParent: parents.has(item.id),
            isBomComponent: components.has(item.id),
            hasSalesUsage: sales.has(item.id),
            hasPurchaseUsage: purchases.has(item.id),
            hasInventory: inventory.has(item.id),
          }),
        )
      },
      { timeout: 60000 },
    )

    const summary = summarizeLotPolicy(proposals)
    console.log("LOT POLICY PROPOSAL (dry-run · DB 변경 없음)")
    console.log(JSON.stringify(summary, null, 2))

    const csvPath = arg("--csv")
    if (csvPath) {
      const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`
      const header = ["Item Code", "Item Name", "Item Type", "BOM Parent", "BOM Component", "Current LOT", "Recommended Lot Tracking", "Change", "Reason"]
      const rows = proposals.map((p: LotPolicyProposal) =>
        [p.code, p.name, p.itemType, p.isBomParent, p.isBomComponent, p.currentLotTracked, p.level, p.change, p.reason].map(esc).join(","),
      )
      writeFileSync(csvPath, "﻿" + [header.map(esc).join(","), ...rows].join("\n"), "utf8")
      console.log(`CSV 저장: ${csvPath}`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error("lot-policy dry-run 실패:", e instanceof Error ? e.message.split("\n").slice(0, 3).join(" | ") : e)
  process.exit(1)
})
