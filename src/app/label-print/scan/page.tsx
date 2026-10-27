import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isQrDevPagesEnabled } from "@/lib/dev-pages"
import { QrScanTestClient } from "./scan-test-client"

export const metadata: Metadata = {
  title: "QR 스캐너 테스트 — 대원정밀 MES",
  robots: { index: false, follow: false },
}

// 요청 시점에 환경변수를 읽는다(빌드 시점에 굳지 않도록).
export const dynamic = "force-dynamic"

/**
 * 공통 카메라 QR 스캐너 개발·점검용 화면 (로그인·서버·DB 와 독립).
 * 스캔 결과(QR 종류/식별값/원본)만 화면에 표시하고 어떤 서버/업무 API 도 호출하지 않는다.
 * 개발·점검용이라 운영 빌드에서는 기본 404 (ENABLE_QR_DEV_PAGES=true 로만 허용 — lib/dev-pages.ts).
 */
export default function QrScanTestPage() {
  if (!isQrDevPagesEnabled()) notFound()
  return <QrScanTestClient />
}
