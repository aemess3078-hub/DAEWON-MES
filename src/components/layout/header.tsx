'use client';

import { Menu, Home } from 'lucide-react';
import Link from 'next/link';
import { useAppStore } from '@/stores/app.store';

interface HeaderProps {
  title?: string;
}

export function Header({ title }: HeaderProps) {
  const { toggleSidebar } = useAppStore();

  return (
    <header className="flex items-center gap-3 h-11 px-4 border-b border-border bg-background">
      <button
        onClick={toggleSidebar}
        className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
      >
        <Menu className="h-4 w-4" />
      </button>
      {title && (
        <span className="text-sm text-muted-foreground">{title}</span>
      )}
      <div className="flex-1" />
      <Link href="/app">
        <button className="p-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground" title="대시보드로 이동">
          <Home className="h-4 w-4" />
        </button>
      </Link>
    </header>
  );
}
