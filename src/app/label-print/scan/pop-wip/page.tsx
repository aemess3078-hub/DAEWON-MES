import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isQrDevPagesEnabled } from "@/lib/dev-pages"
import { PopWipScanTestClient } from "./pop-wip-test-client"

export const metadata: Metadata = {
  title: "POP WIP QR 연동 점검 — 대원정밀 MES",
  robots: { index: false, follow: false },
}

// 요청 시점에 환경변수를 읽는다(빌드 시점에 굳지 않도록).
export const dynamic = "force-dynamic"

/**
 * POP 작업대기 화면의 [WIP QR 스캔] 연동 점검 화면 — 로그인·DB 와 독립.
 * 실제 작업대기 화면 컴포넌트(WorkQueueClient)와 공통 QR 스캐너·판정 규칙(lib/pop/wip-scan.ts)을 그대로 쓰고,
 * 목록 데이터와 서버 조회(lookupWipForPop)만 가짜로 대체한다. 작업시작/실적등록 버튼은 실제 서버 액션을 그대로 호출한다
 * (스캔이 이 액션을 부르지 않는지 확인하기 위해 일부러 남겨 둔다 — 로그인이 없으므로 처리는 실패한다).
 * 개발·점검용이라 운영 빌드에서는 기본 404 (ENABLE_QR_DEV_PAGES=true 로만 허용 — lib/dev-pages.ts).
 */
export default function PopWipScanTestPage() {
  if (!isQrDevPagesEnabled()) notFound()
  return <PopWipScanTestClient />
}
