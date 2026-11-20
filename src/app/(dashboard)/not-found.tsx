import Link from 'next/link';
import { SearchX } from 'lucide-react';
import { EmptyState } from '@/components/analytics/KpiStrip';

/**
 * Shown inside the app shell when a page calls notFound(): a missing record, or one this user may not
 * see (for example another agent's evidence). The wording never confirms whether the record exists.
 */
export default function DashboardNotFound() {
  return (
    <div className="mx-auto w-full max-w-xl py-16">
      <EmptyState
        icon={<SearchX aria-hidden className="size-6" />}
        title="This page is not available"
        body="It may have moved, or your account does not have access to it."
        action={
          <Link href="/" className="pulse-btn pulse-btn-primary">
            Back to Home
          </Link>
        }
      />
    </div>
  );
}
