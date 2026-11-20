import { Activity } from 'lucide-react';
import { ThemeSwitcher } from '@/components/layout/ThemeSwitcher';

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-10">
      <ThemeSwitcher variant="compact" className="absolute right-4 top-4 z-10" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            'radial-gradient(600px circle at 50% 0%, color-mix(in srgb, var(--pulse-indigo) 18%, transparent), transparent 70%)',
        }}
      />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-pulse-md bg-pulse-indigo text-pulse-on-accent">
            <Activity className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            LogiCall <span className="text-pulse-indigo">Pulse</span>
          </span>
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-pulse-muted">
          Authorized LogiCall staff and partner Cohorts only. Activity is logged.
        </p>
      </div>
    </main>
  );
}
