'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ChevronRight,
  ChevronDown,
  Database,
  Folder,
  FolderOpen,
  Table,
  Layout,
  GitBranch,
  Wrench,
  LogOut,
  Hash,
  FileText,
  // MES nav icons
  Workflow,
  Factory,
  CalendarDays,
  ClipboardList,
  BarChart2,
  Activity,
  RefreshCw,
  Truck,
  Tablet,
  MonitorSmartphone,
  ShieldCheck,
  ShieldAlert,
  ClipboardCheck,
  AlertTriangle,
  TrendingUp,
  Ruler,
  Package,
  PackagePlus,
  Tag,
  Search,
  Network,
  ArrowLeftRight,
  Monitor,
  LayoutDashboard,
  FileBarChart,
  History,
  Settings,
  Users,
  Link2,
  Building2,
  FileCheck,
  Boxes,
  Puzzle,
  Fingerprint,
  BookOpen,
  Calculator,
  Cog,
  MapPin,
  ShoppingCart,
  FileInput,
  CircleDollarSign,
  GitPullRequest,
  Cpu,
  Wifi,
  Cable,
  UserCheck,
  Handshake,
  LifeBuoy,
  MessageSquare,
  UserCog,
  GanttChart,
  FolderKanban,
  CircleAlert,
  Undo2,
  Banknote,
  Paperclip,
  Archive,
  FileBarChart2,
  Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/stores/app.store';
import type { NavItem } from '@/types';
import { BrandLogo } from '@/components/brand-logo';

const ICON_MAP: Record<string, React.ElementType> = {
  // Legacy builder icons
  Database,
  Folder,
  FolderOpen,
  Table,
  Layout,
  GitBranch,
  Wrench,
  Hash,
  FileText,
  // MES nav icons
  Workflow,
  Factory,
  CalendarDays,
  ClipboardList,
  BarChart2,
  Activity,
  RefreshCw,
  Truck,
  Tablet,
  MonitorSmartphone,
  ShieldCheck,
  ShieldAlert,
  ClipboardCheck,
  AlertTriangle,
  TrendingUp,
  Ruler,
  Package,
  PackagePlus,
  Tag,
  Search,
  Network,
  ArrowLeftRight,
  Monitor,
  LayoutDashboard,
  FileBarChart,
  History,
  Settings,
  Users,
  Link2,
  Building2,
  FileCheck,
  Boxes,
  Puzzle,
  Fingerprint,
  BookOpen,
  Calculator,
  Cog,
  MapPin,
  ShoppingCart,
  FileInput,
  CircleDollarSign,
  GitPullRequest,
  Cpu,
  Wifi,
  Cable,
  UserCheck,
  Handshake,
  LifeBuoy,
  MessageSquare,
  UserCog,
  GanttChart,
  FolderKanban,
  CircleAlert,
  Undo2,
  Banknote,
  Paperclip,
  Archive,
  FileBarChart2,
  Gauge,
};

function DynamicIcon({ name, className }: { name?: string | null; className?: string }) {
  const Icon = (name && ICON_MAP[name]) ? ICON_MAP[name] : Hash;
  return <Icon className={cn('h-3.5 w-3.5', className)} />;
}

// ----------------------------------------------------------------
// NavItemNode — renders static NavItem entries (MES nav)
// ----------------------------------------------------------------
function NavItemNode({ item, depth }: { item: NavItem; depth: number }) {
  const pathname = usePathname();
  const { expandedMenuIds, toggleMenuExpand } = useAppStore();

  const hasChildren = item.children.length > 0;
  const isFolder = hasChildren && !item.href;
  const isExpanded = expandedMenuIds.includes(item.id);
  const isActive = item.href ? pathname === item.href : false;
  const isComingSoon = item.comingSoon === true;

  const itemInner = (
    <div
      className={cn(
        'flex items-center gap-1.5 rounded px-2 py-1.5 transition-colors',
        isComingSoon
          ? 'cursor-not-allowed opacity-40'
          : 'cursor-pointer',
        isActive
          ? 'bg-accent text-accent-foreground font-semibold'
          : isComingSoon
            ? 'text-muted-foreground font-medium'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground font-medium',
      )}
      style={{ paddingLeft: `${8 + depth * 16}px` }}
      onClick={isFolder ? () => toggleMenuExpand(item.id) : undefined}
    >
      {(isFolder || hasChildren) ? (
        <span className="flex-shrink-0 text-muted-foreground/60">
          {isExpanded
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />}
        </span>
      ) : (
        <span className="w-3 flex-shrink-0" />
      )}
      <DynamicIcon name={item.icon} className="flex-shrink-0 opacity-60" />
      <span className={cn("truncate flex-1", depth >= 2 ? "text-[13px]" : "text-[14px]")}>{item.label}</span>
      {isComingSoon && (
        <span className="flex-shrink-0 text-[10px] font-medium px-1 py-0.5 rounded bg-muted text-muted-foreground leading-none">
          준비중
        </span>
      )}
    </div>
  );

  return (
    <div>
      {!isComingSoon && item.href && !isFolder ? (
        <Link href={item.href} className="block">
          {itemInner}
        </Link>
      ) : (
        itemInner
      )}
      {hasChildren && isExpanded && (
        <div>
          {item.children.map((child) => (
            <NavItemNode key={child.id} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------
// Sidebar
// ----------------------------------------------------------------
interface SidebarProps {
  navItems?: NavItem[];
  userName?: string;
  userEmail?: string;
}

export function Sidebar({ navItems, userName, userEmail }: SidebarProps) {
  const { isSidebarOpen, _hasHydrated } = useAppStore();
  const open = _hasHydrated ? isSidebarOpen : true;
  const router = useRouter();

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 로그아웃 API 실패해도 세션 정리를 위해 로그인 페이지로 이동
    } finally {
      window.location.href = '/login';
    }
  };

  const hasNavItems = navItems && navItems.length > 0;

  return (
    <aside
      className={cn(
        'flex flex-col h-full bg-sidebar transition-all duration-200 select-none',
        open ? 'w-60' : 'w-0 overflow-hidden'
      )}
    >
      {/* 워크스페이스 헤더 */}
      <div
        className="flex items-center gap-2 px-3 py-3 hover:bg-sidebar-accent rounded mx-1 mt-1 cursor-pointer transition-colors"
        onClick={() => router.push('/app')}
      >
        <BrandLogo size="sm" className="text-sidebar-foreground" />
      </div>

      {/* 메뉴 */}
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
        {hasNavItems && navItems.map((item) => (
          <NavItemNode key={item.id} item={item} depth={0} />
        ))}

        {!hasNavItems && (
          <div className="px-3 py-6 text-center">
            <p className="text-xs text-muted-foreground">메뉴가 없습니다</p>
          </div>
        )}
      </div>

      {/* 사용자 */}
      <div className="px-1 py-2 border-t border-sidebar-border">
        <div className="flex items-center gap-2 rounded px-2 py-1.5">
          <div className="w-5 h-5 rounded bg-muted-foreground/20 flex items-center justify-center text-[10px] font-medium flex-shrink-0">
            {userName?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-[13px] font-medium text-sidebar-foreground truncate leading-tight">
              {userName ?? '사용자'}
            </p>
            <p className="text-[13px] text-muted-foreground truncate leading-tight">
              {userEmail ?? ''}
            </p>
          </div>
        </div>
        <Link href="/app/mes/profile" className="w-full flex items-center gap-1.5 rounded px-2 py-1 text-[14px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors mt-0.5">
          <UserCog className="h-3 w-3 opacity-60" />
          내 계정정보
        </Link>
        <button
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="w-full flex items-center gap-1.5 rounded px-2 py-1 text-[14px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors mt-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <LogOut className="h-3 w-3 opacity-60" />
          {isLoggingOut ? '로그아웃 중...' : '로그아웃'}
        </button>
      </div>
    </aside>
  );
}
