/**
 * 자재출고 LOT 재고 "조회" 접근 확인 — getLotStockByItems(수동 선택 목록)와 lookupLotForMaterialIssue(QR 조회)가 같은 기준을 쓴다.
 *
 * 서버 전용 모듈("use server" 파일이 아님 → 클라이언트가 직접 호출할 수 없다).
 *  - 로그인(세션)이 없으면 UNAUTHORIZED
 *  - LOT 재고를 읽을 수 있는 권한(재고·LOT·작업지시·자재출고 메뉴 중 하나의 READ)이 없으면 DENIED
 *  - tenant 는 항상 세션 값이다. 클라이언트가 보낸 tenantId 는 신뢰하지 않는다.
 */
import { getCurrentPermissionSnapshot, hasResourcePermission, requireResourcePermission } from "@/lib/auth/role-permissions"

/** 자재출고 화면(PURCHASE_ORDER 메뉴)과 LOT/재고를 보는 화면의 READ 권한. */
export const LOT_STOCK_READ_RESOURCES = ["INVENTORY", "LOT", "WORK_ORDER", "PURCHASE_ORDER"] as const

/**
 * 자재출고 화면 데이터(작업지시별 자재 목록, 창고별 재고) 조회 접근 확인.
 * 이 화면의 메뉴 권한(자재출고 = PURCHASE_ORDER)의 READ 가 필요하다 — 화면(layout)이 이미 같은 기준으로 접근을 막는다.
 * 실패는 빈 결과로 숨기지 않고 오류로 구분한다(비로그인 UNAUTHORIZED / 권한 없음·다른 tenant 는 같은 권한 오류 문구).
 * 다른 tenant 의 tenantId 를 보낸 경우도 권한 없음과 같은 응답이라 그 tenant 데이터의 존재 여부가 드러나지 않는다.
 */
export const MATERIAL_ISSUE_PERMISSION_DENIED_MESSAGE = "이 기능을 사용할 권한이 없습니다."

export async function requireMaterialIssueReader(clientTenantId: unknown): Promise<{ tenantId: string }> {
  const actor = await requireResourcePermission("PURCHASE_ORDER", "READ") // 비로그인 → Error("UNAUTHORIZED"), 권한 없음 → 권한 오류
  if (typeof clientTenantId !== "string" || clientTenantId !== actor.tenantId) {
    throw new Error(MATERIAL_ISSUE_PERMISSION_DENIED_MESSAGE)
  }
  return { tenantId: actor.tenantId }
}

export async function resolveLotStockReader(): Promise<{ tenantId: string } | { code: "UNAUTHORIZED" | "DENIED" }> {
  // 권한 스냅샷(사용자·권한 조회)을 한 번만 만들고 여러 READ 권한을 그 스냅샷으로 판정한다.
  // requireResourcePermission 을 자원마다 호출할 때와 같은 정책이다: 스냅샷 없음 = 비로그인, 어느 자원도 READ 불가 = 권한 없음.
  const snapshot = await getCurrentPermissionSnapshot()
  if (!snapshot) return { code: "UNAUTHORIZED" }
  if (LOT_STOCK_READ_RESOURCES.some((resource) => hasResourcePermission(snapshot, resource, "READ"))) {
    return { tenantId: snapshot.user.tenantId }
  }
  return { code: "DENIED" }
}
