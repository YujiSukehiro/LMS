'use client';

import { RouteError } from '@/components/layout/RouteFeedback';

export default function AnalyticsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} area="Analytics" />;
}
