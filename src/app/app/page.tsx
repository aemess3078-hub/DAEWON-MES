import Link from 'next/link';
import {
  Factory,
  ClipboardList,
  Package,
  Workflow,
  BarChart2,
  ArrowRight,
} from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';

export default async function AppHomePage() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      {/* 페이지 제목 */}
      <div className="mb-10">
        <BrandLogo size="lg" className="text-foreground mb-3" />
        <p className="text-[15px] text-muted-foreground">
          스마트공장 제조실행시스템에 오신 것을 환영합니다.
        </p>
      </div>

      {/* 주요 메뉴 바로가기 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        {[
          {
            href: '/app/mes/work-orders',
            icon: ClipboardList,
            label: '생산 지시',
            desc: '작업 지시 현황 및 관리',
          },
          {
            href: '/app/mes/bom',
            icon: Package,
            label: 'BOM',
            desc: '자재 명세서 조회 및 편집',
          },
          {
            href: '/app/mes/routing',
            icon: Workflow,
            label: '공정 라우팅',
            desc: '생산 공정 순서 관리',
          },
          {
            href: '/app/mes/work-centers',
            icon: Factory,
            label: '작업장 관리',
            desc: '공장 및 작업 센터 현황',
          },
          {
            href: '/app/mes/production-results',
            icon: BarChart2,
            label: '생산 실적',
            desc: '실적 집계 및 분석',
          },
        ].map(({ href, icon: Icon, label, desc }) => (
          <Link key={href} href={href}>
            <div className="flex items-center gap-4 p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors group cursor-pointer">
              <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-foreground">{label}</p>
                <p className="text-[13px] text-muted-foreground mt-0.5">{desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
