import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isRouteAllowed } from '@/lib/auth/daewon-scope';
import { verifyHs256Jwt } from '@/lib/auth/edge-jwt';

const SESSION_COOKIE = 'nmes-session';

export async function middleware(req: NextRequest) {
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  // 쿠키 '존재'가 아니라 서명·만료가 유효한 세션만 인정한다(Phase 10 / DG-013).
  // 임의 쿠키 값으로 /app 경로와 서버 액션 POST 를 통과하던 우회를 Edge 에서 차단한다.
  // (실제 인가 — 사용자 활성/권한/tenant — 는 레이아웃과 서버 액션 가드가 DB 기준으로 다시 수행한다.)
  const verified = await verifyHs256Jwt(sessionToken, process.env.JWT_SECRET);
  const hasSession = !!verified;

  const isAuthPage = req.nextUrl.pathname.startsWith('/login');
  const isAppPage = req.nextUrl.pathname.startsWith('/app');

  if (!hasSession && isAppPage) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // 대원정밀 구축 범위 밖 경로 1차 차단(404). 페이지 이동(RSC)과 서버 액션 POST 모두 이 경로를 거친다.
  if (
    hasSession &&
    isAppPage &&
    !isRouteAllowed(req.nextUrl.pathname, { loginId: verified?.loginId, role: verified?.role })
  ) {
    return NextResponse.rewrite(new URL('/__daewon-out-of-scope__', req.url), { status: 404 });
  }

  if (hasSession && isAuthPage) {
    return NextResponse.redirect(new URL('/app', req.url));
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nmes-pathname', req.nextUrl.pathname);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ['/app/:path*', '/login'],
};
