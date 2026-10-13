import { notFound, redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { isDeveloperUser } from '@/lib/developer';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { MES_NAV } from '@/lib/nav-config';
import { FeatureProvider } from '@/lib/contexts/feature-context'
import { UserRoleProvider } from '@/lib/contexts/user-role-context';
import { getEnabledFeatureCodes, getEnabledMenuCodes } from '@/lib/services/feature.service';
import { cookies, headers } from 'next/headers';
import { IdleLogoutProvider } from './idle-logout-provider';
import { NMES_SESSION_COOKIE } from '@/lib/jwt';
import type { NavItem } from '@/types/menu';
import type { UserRole } from '@prisma/client';
import { canReadMenuCode, canReadPath, getCurrentPermissionSnapshot } from '@/lib/auth/role-permissions';
import { isRouteAllowed } from '@/lib/auth/daewon-scope';

export const dynamic = 'force-dynamic';

const ROLE_HIERARCHY: Record<UserRole, number> = {
  OWNER: 5, ADMIN: 4, MANAGER: 3, OPERATOR: 2, VIEWER: 1,
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  const user = await getCurrentUser();


  if (!user) {
    const store = await cookies();
    if (store.get(NMES_SESSION_COOKIE)?.value) {
      redirect('/api/auth/clear-session?next=/login&reason=session-expired');
    }
    redirect('/login');
  }

  if (user.mustChangePw) {
    redirect('/auth/change-password');
  }

  const [enabledFeatures, enabledMenuCodes] = await Promise.all([
    getEnabledFeatureCodes(user.tenantId),
    getEnabledMenuCodes(user.tenantId),
  ]);


  const userRole = user.role
  const isDev = isDeveloperUser(user)
  const permissionSnapshot = await getCurrentPermissionSnapshot(user)
  const pathname = (await headers()).get('x-nmes-pathname') ?? ''
  // 대원정밀 구축 범위 밖 경로 차단(서명 검증된 세션 기준). middleware 1차 차단의 서버측 확인.
  if (!isRouteAllowed(pathname, user)) {
    notFound()
  }
  if (!canReadPath(permissionSnapshot, pathname)) {
    notFound()
  }

  function filterNav(items: NavItem[], codes: string[]): NavItem[] {
    return items.reduce<NavItem[]>((acc, item) => {
      // 개발자 전용 메뉴: loginId='test' 계정에만 표시
      if (item.developerOnly && !isDev) return acc
      if (item.minRole && ROLE_HIERARCHY[userRole] < ROLE_HIERARCHY[item.minRole]) {
        return acc
      }
      if (item.children.length > 0) {
        const filtered = filterNav(item.children, codes)
        if (filtered.length > 0) acc.push({ ...item, children: filtered })
      } else if (item.comingSoon || !item.href) {
        acc.push(item)
      } else {
        const menuCode = item.href.split('/').pop() ?? ''
        if (!canReadMenuCode(permissionSnapshot, menuCode)) return acc
        if (codes.includes(menuCode)) acc.push(item)
      }
      return acc
    }, [])
  }
  const filteredNav = filterNav(MES_NAV, enabledMenuCodes)

  return (
    <FeatureProvider enabledFeatures={enabledFeatures}>
      <UserRoleProvider role={userRole}>
        <IdleLogoutProvider />
        <div className="flex h-screen overflow-hidden bg-background print:block print:h-auto">
          <div className="print:hidden">
            <Sidebar
              navItems={filteredNav}
              userName={user.name}
              userEmail={user.email}
            />
          </div>
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden print:block">
            <div className="print:hidden">
              <Header />
            </div>
            <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:h-auto print:p-0">
              {children}
            </main>
          </div>
        </div>
      </UserRoleProvider>
    </FeatureProvider>
  );
}
