import type { Metadata } from 'next';
import { LoginForm } from './LoginForm';
import { safeNextPath } from './safe-next-path';

export const metadata: Metadata = { title: 'Sign In' };

const REASON_MESSAGES: Record<string, string> = {
  'session-ended': 'Your session ended. Sign in again to continue.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const reason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  return <LoginForm nextPath={safeNextPath(params.next)} notice={reason ? (REASON_MESSAGES[reason] ?? null) : null} />;
}
