import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { getActiveAiRuntime } from '@/lib/ai/gateway';
import { AppShell } from '@/components/layout/AppShell';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requirePageUser();
  // A temporary password from a supervisor or admin must be replaced before anything else.
  if (user.mustChangePassword) redirect('/account/new-password');
  const runtime = getActiveAiRuntime();
  return (
    <AppShell user={user} runtime={runtime}>
      {children}
    </AppShell>
  );
}
