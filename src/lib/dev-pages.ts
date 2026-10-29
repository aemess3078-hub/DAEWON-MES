/**
 * 개발·현장 점검용 QR 테스트 페이지 접근 허용 여부 (서버 전용 판단).
 *
 * 대상: /label-print/samples · /label-print/scan · /label-print/scan/issue-lot
 *  - 로그인·서버·DB 와 무관한 점검 화면이라 미들웨어(/app 만 보호)로는 막히지 않는다.
 *  - 실제 라벨 출력 경로(/label-print)와 자재출고 화면(/app/mes/material-issue)과는 별개이며 이 판단의 영향을 받지 않는다.
 *
 * 규칙
 *  - 개발 서버(next dev, NODE_ENV !== "production")에서는 항상 허용.
 *  - 운영 빌드(next start / Vercel 등 NODE_ENV === "production")에서는 기본 차단(404).
 *  - production build 로 브라우저 자동화 테스트를 돌릴 때만 서버 프로세스에 ENABLE_QR_DEV_PAGES=true 를 명시해 허용한다.
 *    (NEXT_PUBLIC_ 접두사를 쓰지 않는다: 빌드 시점에 클라이언트 번들에 박히지 않고, 서버가 요청 시점에 읽는다.)
 */
export function isQrDevPagesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV !== "production") return true
  return env.ENABLE_QR_DEV_PAGES === "true"
}
