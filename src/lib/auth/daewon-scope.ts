/**
 * 대원정밀 구축 범위 라우트 정책 (순수 모듈 — middleware(Edge)/서버/클라이언트 어디서든 import 가능)
 *
 * 원칙
 *  - 허용 목록(allow-list) 방식: 아래 목록에 없는 /app/** 경로는 일반 사용자에게 모두 차단(404)한다.
 *  - 코드/DB 모델/migration 은 삭제하지 않는다. 개발자 계정(loginId='test')은 전 경로를 사용할 수 있다.
 *  - 개발자 전용 경로(DEV_ONLY)는 개발자 계정만 허용한다(기존 페이지 가드 isDeveloperUser 와 동일 기준).
 *  - NEXT_PUBLIC_BRAND=newmes (NMES 개발 서버) 에서는 정책을 적용하지 않는다. 그 외(daewon, 미설정)는 적용(fail-closed).
 *  - POP(/pop, /kiosk)는 /app 하위가 아니므로 이 정책의 대상이 아니다. /app/pop/** 는 허용한다.
 *
 * 허용 목록 변경 시 nav-config.ts 의 MES_NAV / DAEWON_HIDDEN_NAV 와 함께 갱신할 것.
 */

export const DEVELOPER_LOGIN_ID = "test"

/** 대원정밀 일반 사용자에게 허용되는 /app 하위 경로(접두사, 세그먼트 경계 기준) */
export const DAEWON_ALLOWED_ROUTES: readonly string[] = [
  // 공통
  "/app/mes/profile",
  // 기준정보관리
  "/app/mes/customers",
  "/app/mes/vendors",
  "/app/mes/master/equipment",
  "/app/mes/work-centers",
  "/app/mes/routing",
  "/app/mes/users",
  "/app/mes/sites",
  "/app/mes/locations",
  "/app/mes/items",
  "/app/mes/master/item-categories",
  "/app/mes/master/item-groups",
  "/app/mes/bom",
  "/app/mes/master/inspection-standards",
  "/app/mes/measurement",
  "/app/mes/defects",
  "/app/mes/attachments",
  "/app/mes/audit-log",
  // 수주납품관리
  "/app/mes/sales-orders",
  "/app/mes/sales/order-status",
  "/app/mes/shipments",
  "/app/mes/sales/delivery-status",
  // 자재관리
  "/app/mes/purchase-orders",
  "/app/mes/material-receipt",
  "/app/mes/material-issue",
  "/app/mes/material/stock",
  "/app/mes/mrp",
  // 재고관리
  "/app/mes/inventory",
  "/app/mes/inventory-transactions",
  "/app/mes/production/wip-inventory",
  // 생산관리
  "/app/mes/production-plan",
  "/app/mes/work-orders",
  "/app/mes/production-results",
  "/app/mes/finished-goods-receipt",
  "/app/mes/production/outsourcing",
  "/app/mes/production/outsource-orders",
  "/app/mes/production/outsource-receiving",
  "/app/mes/outsourcing",
  "/app/mes/process-progress",
  "/app/mes/rework", // 재작업 종결·보류관리 (Phase 10 / DG-015: 개발자 전용 → 권한 기반)
  // 품질관리
  "/app/mes/quality/defect-stats",
  // Phase 10 / DG-016: 불량 원인분석·조치·재발방지·품질현황 (개발자 전용 해제, 권한 기반)
  "/app/mes/quality/cause-analysis",
  "/app/mes/quality/corrective-action",
  "/app/mes/quality/recurrence-prevention",
  "/app/mes/quality/dashboard",
  "/app/mes/inspection-stages",
  "/app/mes/final-inspection",
  "/app/mes/quality/work-standards",
  "/app/mes/ecn",
  "/app/mes/quality/change-points",
  // 이력관리
  "/app/mes/lot",
  "/app/mes/traceability",
  "/app/mes/trace-reverse",
  "/app/mes/lot-history",
  // 모니터링
  "/app/lms/monitoring/status",
  "/app/mes/equipment-monitor",
  // POP (관리자 웹 내 작업대기)
  "/app/pop",
]

/** 개발자 계정 전용 경로(기존 페이지 가드와 동일 기준) */
export const DAEWON_DEV_ONLY_ROUTES: readonly string[] = [
  "/app/mes/gateways",
  "/app/mes/equipment-connections",
  "/app/mes/tags",
  "/app/mes/lot-rules",
  "/app/mes/features",
  "/app/mes/common-codes",
]

export type RouteActor = { loginId?: string | null; role?: string | null } | null | undefined

/** NEXT_PUBLIC_BRAND=newmes 가 아니면(대원정밀 포함) 구축 범위 정책을 적용한다. */
export function isScopeEnforced(): boolean {
  return process.env.NEXT_PUBLIC_BRAND !== "newmes"
}

export function isDeveloperLogin(loginId: string | null | undefined): boolean {
  // 운영 Go-Live 시 개발자 예외를 끄는 스위치(Phase 10 / DG-017). developer.ts 와 동일 기준.
  if (process.env.DAEWON_DISABLE_DEVELOPER_ACCESS === "1") return false
  return loginId === DEVELOPER_LOGIN_ID
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/")
}

function normalize(pathname: string): string {
  const [path] = pathname.split("?")
  return path.length > 1 ? path.replace(/\/+$/, "") : path
}

/** pathname 이 actor 에게 허용되는지. /app 이외 경로는 항상 true(정책 대상 아님). */
export function isRouteAllowed(pathname: string, actor: RouteActor): boolean {
  if (!isScopeEnforced()) return true
  const path = normalize(pathname)
  if (path !== "/app" && !path.startsWith("/app/")) return true
  if (isDeveloperLogin(actor?.loginId)) return true
  if (path === "/app" || path === "/app/mes") return true // /app/mes 는 /app 으로 redirect 하는 진입 경로
  if (DAEWON_DEV_ONLY_ROUTES.some((p) => matchesPrefix(path, p))) return false
  return DAEWON_ALLOWED_ROUTES.some((p) => matchesPrefix(path, p))
}

/**
 * UI 링크 노출 여부(클라이언트 포함). 대원정밀 구축 범위 밖 route 로 가는 링크/버튼을 일반 화면에서 숨길 때 사용한다.
 * 사용자 정보를 알 수 없으므로 개발자 예외 없이 판단한다(개발자는 URL 직접 입력으로 접근).
 * NEXT_PUBLIC_BRAND 는 빌드 시 클라이언트 번들에 인라인된다.
 */
export function isLinkVisible(href: string): boolean {
  return isRouteAllowed(href, null)
}

/**
 * JWT payload 를 서명 검증 없이 디코드한다 (Edge middleware 의 1차 차단 전용).
 * 반환값은 "개발자 예외"를 판단하는 힌트로만 쓰이며, 실제 인증/인가는 서버(layout, 서버 액션)가 서명 검증 후 다시 수행한다.
 */
export function decodeJwtPayloadUnverified(token: string | undefined): RouteActor {
  if (!token) return null
  const part = token.split(".")[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/")
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    )
    const payload = JSON.parse(json) as { loginId?: string; role?: string }
    return { loginId: payload.loginId, role: payload.role }
  } catch {
    return null
  }
}
