import type { ReactNode } from 'react';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { getActiveAiRuntime } from '@/lib/ai/gateway';
import { AppShell } from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  const runtime = getActiveAiRuntime();
  return (
    <AppShell user={user} runtime={runtime}>
      {children}
    </AppShell>
  );
}
