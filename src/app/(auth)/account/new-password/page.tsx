import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/firebase/auth-guard';
import { NewPasswordForm } from './NewPasswordForm';

export const metadata: Metadata = { title: 'Choose a new password' };
export const dynamic = 'force-dynamic';

export default async function NewPasswordPage() {
  const user = await requirePageUser();
  return <NewPasswordForm email={user.email} required={user.mustChangePassword === true} />;
}
