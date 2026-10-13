// ⚠️ TODO(DAEWON): 이 파일의 규칙은 CNS Medical(의료기기) 전용 LOT/제조번호 규칙이다.
//   (현재 lot-brand-guard.ts 가 NEXT_PUBLIC_BRAND=newmes 가 아니면 이 규칙으로의 자동 채번을 차단한다.)
//   대원정밀 LOT 채번 규칙은 아직 확정되지 않았다. 확정 전까지:
//   - 이 규칙을 대원정밀 규칙으로 간주하지 말 것 (fallbackRules 의 접두사 "C", 연-월(문자)-일 패턴은 CNS 값).
//   - 품목 LOT 정책(lotNumberingType=MANUAL)로 수동 입력하거나, 확정 후 이 모듈을 교체/일반화한다.
//   - 이 규칙을 호출하는 곳: lot-rule-resolver.ts, lot-number-generator.ts, lot-reservation.ts,
//     receiving.actions.ts, lot.actions.ts, work-order.actions.ts, finished-goods-lot.helpers.ts
//   자세한 내용은 docs/DAEWON-TODO.md 의 "대원정밀 LOT 채번" 항목 참고.
import type { ItemType, ManualLotPolicy } from "@prisma/client"

export type CnsLotEventType =
  | "MATERIAL_RECEIPT"
  | "PRODUCTION_MANUFACTURING_NO"
  | "FINISHED_GOODS_RECEIPT"

export type CnsLotPattern =
  | "YY_MONTH_LETTER_DD_SEQ"
  | "PREFIX_YY_MONTH_LETTER_SEQ3"
  | "MANUAL_SUPPLIER_LOT"

export type CnsLotRule = {
  pattern: CnsLotPattern
  prefix?: string
  manualAllowed?: boolean
  manualLotPolicy?: ManualLotPolicy
}

export type CnsLotRuleSet = Partial<Record<CnsLotEventType, CnsLotRule>>

export const fallbackRules: Record<CnsLotEventType, CnsLotRule> = {
  MATERIAL_RECEIPT: {
    pattern: "YY_MONTH_LETTER_DD_SEQ",
    manualAllowed: true,
  },
  PRODUCTION_MANUFACTURING_NO: {
    pattern: "PREFIX_YY_MONTH_LETTER_SEQ3",
    prefix: "C",
  },
  FINISHED_GOODS_RECEIPT: {
    pattern: "PREFIX_YY_MONTH_LETTER_SEQ3",
    prefix: "C",
  },
}

// TODO(CNS): Replace these placeholders with actual CNS item codes after master data is finalized.
export const itemCodeRules: Record<string, CnsLotRuleSet> = {}

// TODO(CNS): Add CNS item group codes that require CA-series production numbers.
// Example shape:
// BURR: {
//   PRODUCTION_MANUFACTURING_NO: { pattern: "PREFIX_YY_MONTH_LETTER_SEQ3", prefix: "CA" },
//   FINISHED_GOODS_RECEIPT: { pattern: "PREFIX_YY_MONTH_LETTER_SEQ3", prefix: "CA" },
// }
export const itemGroupRules: Record<string, CnsLotRuleSet> = {}

// TODO(CNS): Add CNS item category codes that require CA-series production numbers.
export const itemCategoryRules: Record<string, CnsLotRuleSet> = {}

export const itemTypeRules: Partial<Record<ItemType, CnsLotRuleSet>> = {
  RAW_MATERIAL: {
    MATERIAL_RECEIPT: {
      pattern: "YY_MONTH_LETTER_DD_SEQ",
      manualAllowed: true,
    },
  },
  SEMI_FINISHED: {
    PRODUCTION_MANUFACTURING_NO: {
      pattern: "PREFIX_YY_MONTH_LETTER_SEQ3",
      prefix: "C",
    },
    FINISHED_GOODS_RECEIPT: {
      pattern: "PREFIX_YY_MONTH_LETTER_SEQ3",
      prefix: "C",
    },
  },
  FINISHED: {
    PRODUCTION_MANUFACTURING_NO: {
      pattern: "PREFIX_YY_MONTH_LETTER_SEQ3",
      prefix: "C",
    },
    FINISHED_GOODS_RECEIPT: {
      pattern: "PREFIX_YY_MONTH_LETTER_SEQ3",
      prefix: "C",
    },
  },
}
