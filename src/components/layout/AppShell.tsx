import type { ReactNode } from 'react';
import type { SessionUser } from '@/lib/schemas/domain';
import type { AiRuntimeInfo } from './AiRuntimePill';
import { RoleSidebar } from './RoleSidebar';
import { TopBar } from './TopBar';

export function AppShell({
  user,
  runtime,
  children,
}: {
  user: SessionUser;
  runtime: AiRuntimeInfo;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-pulse-bg">
      <RoleSidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} runtime={runtime} />
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 md:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
