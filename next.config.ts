import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();

/** Origins the browser Firebase SDK talks to (Auth, Firestore, Storage, Google sign-in popup). */
const firebaseConnect = [
  'https://*.googleapis.com',
  'https://*.firebaseio.com',
  'wss://*.firebaseio.com',
  'https://*.firebaseapp.com',
  'https://*.firebasestorage.app',
  'https://apis.google.com',
];
const emulatorConnect = useEmulator || isDev ? ['http://127.0.0.1:*', 'ws://127.0.0.1:*', 'http://localhost:*', 'ws://localhost:*'] : [];
const authFrames = ['https://*.firebaseapp.com', 'https://accounts.google.com', 'https://apis.google.com'];
if (authDomain && !authDomain.endsWith('.firebaseapp.com')) authFrames.push(`https://${authDomain}`);
if (useEmulator || isDev) authFrames.push('http://127.0.0.1:*', 'http://localhost:*');

/**
 * Content Security Policy. Next.js App Router emits inline bootstrap scripts, so script-src needs
 * 'unsafe-inline' unless nonces are added; dev mode also needs 'unsafe-eval' for React Refresh.
 * frame-ancestors 'none' blocks clickjacking of the Roster and other admin pages.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://apis.google.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self' ${[...firebaseConnect, ...emulatorConnect].join(' ')}`,
  `frame-src ${authFrames.join(' ')}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Microphone stays on for dictation in Verbal Practice; everything else is off.
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)' },
  // signInWithPopup needs the opener link to the Google popup, so not plain same-origin.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ['firebase-admin', 'unpdf'],
  experimental: {
    serverActions: { bodySizeLimit: '21mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
