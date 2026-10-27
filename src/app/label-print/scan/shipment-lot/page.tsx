import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isQrDevPagesEnabled } from "@/lib/dev-pages"
import { ShipmentLotScanTestClient } from "./shipment-lot-test-client"

export const metadata: Metadata = {
  title: "출하 QR 연동 점검 — 대원정밀 MES",
  robots: { index: false, follow: false },
}

// 요청 시점에 환경변수를 읽는다(빌드 시점에 굳지 않도록).
export const dynamic = "force-dynamic"

/**
 * 출하예정 등록 [QR 스캔] 연동(FgLotQrScan) 점검 화면 — 로그인·서버·DB 와 독립.
 * 실제 출하 화면과 같은 컴포넌트/반영 규칙(lib/shipment/fg-lot-scan.ts)을 쓰되 서버 조회만 가짜 데이터로 대체한다.
 * 기본 모드는 어떤 서버 액션/DB/재고 처리/출하 등록도 호출하지 않는다. (?real=1 은 읽기 전용 조회 액션 1개만 호출 — 출하 등록·확정 액션은 이 화면에 연결되어 있지 않다.)
 * 개발·점검용이라 운영 빌드에서는 기본 404 (ENABLE_QR_DEV_PAGES=true 로만 허용 — lib/dev-pages.ts).
 */
export default function ShipmentLotScanTestPage() {
  if (!isQrDevPagesEnabled()) notFound()
  return <ShipmentLotScanTestClient />
}
