import type { SessionUser } from '@/lib/schemas/domain';
import { AiRuntimePill, type AiRuntimeInfo } from './AiRuntimePill';
import { CohortBadge } from './CohortBadge';
import { RoleBadge } from './RoleBadge';
import { UserMenu } from './UserMenu';

export function TopBar({ user, runtime }: { user: SessionUser; runtime: AiRuntimeInfo }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-pulse-border-subtle bg-pulse-bg/85 px-4 backdrop-blur md:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <CohortBadge cohortId={user.partnerCohortId} />
        <RoleBadge role={user.role} className="hidden sm:inline-flex" />
      </div>
      <AiRuntimePill runtime={runtime} className="hidden md:inline-flex" />
      <UserMenu displayName={user.displayName} email={user.email} />
    </header>
  );
}
