import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { AgentHome } from '@/components/layout/home/AgentHome';
import { SupervisorHome } from '@/components/layout/home/SupervisorHome';
import { TrainerHome } from '@/components/layout/home/TrainerHome';
import { AdminHome } from '@/components/layout/home/AdminHome';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

export default async function DashboardHomePage() {
  const user = await requirePageUser();
  switch (user.role) {
    case 'AGENT':
      return <AgentHome user={user} />;
    case 'PARTNER_SUPERVISOR':
      return <SupervisorHome user={user} />;
    case 'TRAINER':
      return <TrainerHome user={user} />;
    case 'ADMIN':
    case 'SUPER_ADMIN':
      return <AdminHome user={user} />;
  }
}
