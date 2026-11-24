import Link from 'next/link';
import { Activity } from 'lucide-react';
import type { UserRole } from '@/lib/schemas/domain';
import { GUIDE_NAV_ITEM, NAV_BY_ROLE } from './nav-config';
import { NavLink } from './NavLink';

export function RoleSidebar({ role }: { role: UserRole }) {
  const items = NAV_BY_ROLE[role];
  return (
    <aside className="sticky top-0 flex h-screen w-16 shrink-0 flex-col border-r border-pulse-border-subtle bg-pulse-surface-1 lg:w-60">
      <Link
        href="/"
        className="flex h-14 items-center justify-center gap-2.5 border-b border-pulse-border-subtle px-3 lg:justify-start lg:px-4"
      >
        <span className="flex size-8 items-center justify-center rounded-pulse-md bg-pulse-indigo/15 text-pulse-indigo">
          <Activity aria-hidden className="size-4.5" />
        </span>
        <span className="hidden leading-tight lg:block">
          <span className="block text-sm font-bold tracking-tight">LogiCall Pulse</span>
          <span className="block text-[0.68rem] text-pulse-muted">Campaign Readiness</span>
        </span>
      </Link>
      <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1 p-2 lg:p-3">
        <p className="pulse-label hidden px-3 pb-1 pt-2 lg:block">Navigation</p>
        {items.map((item) => (
          <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
        ))}
        <div className="mt-auto border-t border-pulse-border-subtle pt-2">
          <NavLink href={GUIDE_NAV_ITEM.href} label={GUIDE_NAV_ITEM.label} icon={GUIDE_NAV_ITEM.icon} />
        </div>
      </nav>
      <p className="hidden px-4 pb-4 text-[0.68rem] text-pulse-muted lg:block">LogiCall Services Inc.</p>
    </aside>
  );
}
