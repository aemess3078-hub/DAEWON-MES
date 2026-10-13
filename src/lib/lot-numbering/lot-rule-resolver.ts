import type { ItemType, LotNumberingType, ManualLotPolicy } from "@prisma/client"
import {
  fallbackRules,
  itemCategoryRules,
  itemCodeRules,
  itemGroupRules,
  itemTypeRules,
  type CnsLotEventType,
  type CnsLotRule,
} from "./cns-lot-rules"
import { assertCnsLotRuleAllowed } from "./lot-brand-guard"

export type CnsItemRuleContext = {
  itemCode?: string | null
  itemGroupCode?: string | null
  itemCategoryCode?: string | null
  itemType?: ItemType | string | null
  lotNumberingType?: LotNumberingType | string | null
  lotPrefix?: string | null
  manualLotPolicy?: ManualLotPolicy | string | null
}

export type ResolvedCnsLotRule = CnsLotRule & {
  source: "ITEM_SETTING" | "ITEM" | "ITEM_GROUP" | "ITEM_CATEGORY" | "ITEM_TYPE" | "FALLBACK"
}

function normalizeCode(code?: string | null): string | null {
  const trimmed = code?.trim()
  return trimmed ? trimmed.toUpperCase() : null
}

function getRule(
  rules: Record<string, Partial<Record<CnsLotEventType, CnsLotRule>>>,
  code: string | null,
  eventType: CnsLotEventType,
): CnsLotRule | null {
  if (!code) return null
  return rules[code]?.[eventType] ?? null
}

export function resolveCnsLotRule(
  context: CnsItemRuleContext,
  eventType: CnsLotEventType,
): ResolvedCnsLotRule {
  const lotNumberingType = normalizeCode(context.lotNumberingType) as LotNumberingType | null
  const lotPrefix = normalizeCode(context.lotPrefix)
  const manualLotPolicy = normalizeCode(context.manualLotPolicy) as ManualLotPolicy | null
  const itemCode = normalizeCode(context.itemCode)
  const itemGroupCode = normalizeCode(context.itemGroupCode)
  const itemCategoryCode = normalizeCode(context.itemCategoryCode)
  const itemType = normalizeCode(context.itemType)

  // 대원정밀: 수동(MANUAL) 외에는 CNS 규칙으로 자동 채번하지 않는다 (lot-brand-guard.ts)
  if (lotNumberingType !== "MANUAL") assertCnsLotRuleAllowed()

  if (lotNumberingType && lotNumberingType !== "DEFAULT") {
    if (lotNumberingType === "MANUAL") {
      return {
        pattern: "MANUAL_SUPPLIER_LOT",
        manualAllowed: true,
        manualLotPolicy: "REQUIRED",
        source: "ITEM_SETTING",
      }
    }

    if (lotNumberingType === "RAW_DATE_SEQ") {
      return {
        pattern: "YY_MONTH_LETTER_DD_SEQ",
        manualAllowed: manualLotPolicy !== "DISABLED",
        manualLotPolicy: manualLotPolicy ?? "ALLOWED",
        source: "ITEM_SETTING",
      }
    }

    if (lotNumberingType === "PREFIX_MONTH_SEQ") {
      return {
        pattern: "PREFIX_YY_MONTH_LETTER_SEQ3",
        prefix: lotPrefix ?? undefined,
        manualAllowed: manualLotPolicy !== "DISABLED",
        manualLotPolicy: manualLotPolicy ?? "ALLOWED",
        source: "ITEM_SETTING",
      }
    }
  }

  const itemRule = getRule(itemCodeRules, itemCode, eventType)
  if (itemRule) return { ...itemRule, source: "ITEM" }

  const itemGroupRule = getRule(itemGroupRules, itemGroupCode, eventType)
  if (itemGroupRule) return { ...itemGroupRule, source: "ITEM_GROUP" }

  const itemCategoryRule = getRule(itemCategoryRules, itemCategoryCode, eventType)
  if (itemCategoryRule) return { ...itemCategoryRule, source: "ITEM_CATEGORY" }

  const typeRule = itemTypeRules[itemType as ItemType]?.[eventType]
  if (typeRule) return { ...typeRule, source: "ITEM_TYPE" }

  return { ...fallbackRules[eventType], source: "FALLBACK" }
}
