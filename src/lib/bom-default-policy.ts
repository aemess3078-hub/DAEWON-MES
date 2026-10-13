/**
 * BOM Excel 업로드 시 기본(Default) BOM 지정 정책 (순수 모듈)
 *
 * 배경(M4): 업로드가 항상 isDefault=false 로 BOM 을 만들면, MRP(ACTIVE + isDefault=true 만 사용)가
 * 업로드된 BOM 을 전혀 사용할 수 없다.
 *
 * 정책
 *  - 업로드 BOM 이 ACTIVE 이고,
 *  - 같은 tenant·품목에 이미 ACTIVE Default BOM 이 없고,
 *  - 같은 업로드 파일 안에서 같은 품목의 앞선 ACTIVE BOM 이 Default 로 지정되지 않았을 때만 Default.
 *  - 그 외에는 isDefault=false (기존 Default 를 바꾸거나 Default 를 중복 생성하지 않는다).
 *  - 기존 BOM 은 수정하지 않는다. Default 교체는 BOM 화면/ECN 에서 명시적으로 수행한다.
 */

export type ImportBomGroupForDefault = {
  key: string
  parentItemId: string
  status: string
}

/** key(BOM 그룹) → isDefault */
export function decideImportDefaultFlags(
  groups: readonly ImportBomGroupForDefault[],
  existingActiveDefaultItemIds: ReadonlySet<string>
): Map<string, boolean> {
  const assignedInBatch = new Set<string>()
  const result = new Map<string, boolean>()
  for (const group of groups) {
    const eligible =
      group.status === "ACTIVE" &&
      !existingActiveDefaultItemIds.has(group.parentItemId) &&
      !assignedInBatch.has(group.parentItemId)
    if (eligible) assignedInBatch.add(group.parentItemId)
    result.set(group.key, eligible)
  }
  return result
}
