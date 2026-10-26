import type { Metadata } from "next"
import { LabelPrintClient } from "./label-print-client"

export const metadata: Metadata = {
  title: "라벨 인쇄 — 대원정밀 MES",
  robots: { index: false, follow: false },
}

/**
 * 라벨 전용 인쇄 페이지.
 * MES 레이아웃(사이드바/헤더/팝업)을 전혀 쓰지 않는다 — 이 페이지를 인쇄하면 라벨만 나온다.
 * 라벨 데이터는 서버를 거치지 않고 같은 브라우저의 localStorage(job)로 전달된다. 서버 데이터 조회가 없다.
 */
export default function LabelPrintPage() {
  return <LabelPrintClient />
}
