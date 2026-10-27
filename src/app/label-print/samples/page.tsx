import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isQrDevPagesEnabled } from "@/lib/dev-pages"
import { LabelSamplesClient } from "./label-samples-client"

export const metadata: Metadata = {
  title: "라벨 3종 샘플 — 대원정밀 MES",
  robots: { index: false, follow: false },
}

// 요청 시점에 환경변수를 읽는다(빌드 시점에 굳지 않도록).
export const dynamic = "force-dynamic"

/**
 * 라벨 3종(원자재 LOT / 공정·재공 WIP / 완제품 LOT) 디자인·출력 설정 확인 페이지.
 * 시험용 샘플만 다룬다(TEST- 식별값, "시험용" 표시). 서버 조회·DB·출력 이력과 무관하다.
 * 개발·점검용이라 운영 빌드에서는 기본 404 (ENABLE_QR_DEV_PAGES=true 로만 허용 — lib/dev-pages.ts). 실제 라벨 출력(/label-print)과 무관하다.
 */
export default function LabelSamplesPage() {
  if (!isQrDevPagesEnabled()) notFound()
  return <LabelSamplesClient />
}
