import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { decodeJwtPayloadUnverified, isRouteAllowed } from '@/lib/auth/daewon-scope';

const SESSION_COOKIE = 'nmes-session';

export async function middleware(req: NextRequest) {
  const sessionToken = req.cookies.get(SESSION_COOKIE)?.value;
  const hasSession = !!sessionToken;

  const isAuthPage = req.nextUrl.pathname.startsWith('/login');
  const isAppPage = req.nextUrl.pathname.startsWith('/app');

  if (!hasSession && isAppPage) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // 대원정밀 구축 범위 밖 경로 1차 차단(404). 페이지 이동(RSC)과 서버 액션 POST 모두 이 경로를 거친다.
  // 개발자 예외 판단에 서명 미검증 payload 를 쓰므로, 실제 인가는 app/layout.tsx 와 서버 액션 가드가 서명 검증 후 다시 수행한다.
  if (hasSession && isAppPage && !isRouteAllowed(req.nextUrl.pathname, decodeJwtPayloadUnverified(sessionToken))) {
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
