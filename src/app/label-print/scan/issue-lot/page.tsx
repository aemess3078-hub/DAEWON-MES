import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isQrDevPagesEnabled } from "@/lib/dev-pages"
import { IssueLotScanTestClient } from "./issue-lot-test-client"

export const metadata: Metadata = {
  title: "자재출고 QR 연동 점검 — 대원정밀 MES",
  robots: { index: false, follow: false },
}

// 요청 시점에 환경변수를 읽는다(빌드 시점에 굳지 않도록).
export const dynamic = "force-dynamic"

/**
 * 자재출고 [QR 스캔] 연동(LotQrScanSection) 점검 화면 — 로그인·서버·DB 와 독립.
 * 실제 자재출고 화면과 같은 컴포넌트/규칙(lib/material-issue/lot-scan.ts)을 쓰되 서버 조회만 가짜 데이터로 대체한다.
 * 어떤 서버 액션/DB/재고 처리도 호출하지 않는다.
 * 개발·점검용이라 운영 빌드에서는 기본 404 (ENABLE_QR_DEV_PAGES=true 로만 허용 — lib/dev-pages.ts).
 */
export default function IssueLotScanTestPage() {
  if (!isQrDevPagesEnabled()) notFound()
  return <IssueLotScanTestClient />
}
