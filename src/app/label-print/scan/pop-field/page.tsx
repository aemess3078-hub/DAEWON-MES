import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isQrDevPagesEnabled } from "@/lib/dev-pages"
import { PopFieldScanTestClient } from "./pop-field-test-client"

export const metadata: Metadata = {
  title: "현장 POP WIP QR 연동 점검 — 대원정밀 MES",
  robots: { index: false, follow: false },
}

// 요청 시점에 환경변수를 읽는다(빌드 시점에 굳지 않도록).
export const dynamic = "force-dynamic"

/**
 * 현장 태블릿 POP 작업지시 선택 화면(/pop/work-select)의 [WIP QR 스캔] 연동 점검 화면 — 로그인·DB 와 독립.
 * 실제 화면 컴포넌트(WorkSelectClient)와 공통 QR 스캐너·판정 규칙을 그대로 쓰고, 작업지시 목록과 서버 조회만 가짜로 대체한다.
 * 카드를 누르면 실제 화면과 같이 /pop/production/<공정ID> 로 이동한다(스캔이 이동하지 않는지 확인하기 위해 그대로 남겨 둔다).
 * 개발·점검용이라 운영 빌드에서는 기본 404 (ENABLE_QR_DEV_PAGES=true 로만 허용 — lib/dev-pages.ts).
 */
export default function PopFieldScanTestPage() {
  if (!isQrDevPagesEnabled()) notFound()
  return <PopFieldScanTestClient />
}
