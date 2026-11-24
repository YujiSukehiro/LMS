import { redirect } from 'next/navigation';

/** The Guide page became How To. Old links keep working; the browser keeps any #section on the redirect. */
export default async function GuideRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const role = Array.isArray(sp.role) ? sp.role[0] : sp.role;
  redirect(role ? `/how-to?role=${encodeURIComponent(role)}` : '/how-to');
}
