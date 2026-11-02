'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChartColumn, LayoutDashboard, Layers, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NavIconName } from './nav-config';

const ICONS: Record<NavIconName, LucideIcon> = {
  home: LayoutDashboard,
  studio: Layers,
  analytics: ChartColumn,
  roster: Users,
};

export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLink({ href, label, icon }: { href: string; label: string; icon: NavIconName }) {
  const pathname = usePathname();
  const active = isNavActive(pathname, href);
  const Icon = ICONS[icon];
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={cn(
        'group relative flex items-center gap-3 rounded-pulse-md px-3 py-2 text-sm font-medium transition-colors',
        'justify-center lg:justify-start',
        active
          ? 'bg-pulse-surface-2 text-pulse-primary'
          : 'text-pulse-muted hover:bg-pulse-surface-2/60 hover:text-pulse-secondary',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1.5 left-0 w-0.5 rounded-full transition-colors',
          active ? 'bg-pulse-indigo' : 'bg-transparent',
        )}
      />
      <Icon aria-hidden className={cn('size-4 shrink-0', active && 'text-pulse-indigo')} />
      <span className="hidden lg:inline">{label}</span>
    </Link>
  );
}
