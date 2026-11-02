import { ShieldCheck } from 'lucide-react';
import type { UserRole } from '@/lib/schemas/domain';
import { ROLE_LABELS } from '@/lib/schemas/constants';
import { cn } from '@/lib/utils';

export function RoleBadge({ role, className }: { role: UserRole; className?: string }) {
  return (
    <span className={cn('pulse-pill pulse-pill-indigo', className)}>
      <ShieldCheck aria-hidden className="size-3.5" />
      {ROLE_LABELS[role]}
    </span>
  );
}
