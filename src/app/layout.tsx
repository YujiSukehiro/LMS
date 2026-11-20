import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { THEME_COOKIE, resolveTheme } from '@/lib/theme/themes';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'LogiCall Pulse',
    template: '%s · LogiCall Pulse',
  },
  description: 'LogiCall Pulse — Campaign Readiness & Simulation Platform for LogiCall Services Inc.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f6f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1120' },
  ],
  colorScheme: 'light dark',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Server-rendered theme: no client script and no flash. Light is the default.
  const theme = resolveTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme} className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-pulse-bg text-pulse-primary antialiased">{children}</body>
    </html>
  );
}
