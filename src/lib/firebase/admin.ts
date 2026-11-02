/**
 * Server-only firebase-admin singletons. Never import this file from a client component.
 *
 * Initialization is lazy: nothing touches credentials until the first property access, so
 * `next build` does not fail when no emulator host or service account is available.
 */
import { applicationDefault, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const ADMIN_APP_NAME = 'logicall-pulse-admin';

export type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

function resolveProjectId(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    undefined
  );
}

function usesEmulators(): boolean {
  return Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST);
}

export function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  if (existing) return existing;

  const projectId = resolveProjectId();
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined;

  if (usesEmulators()) {
    // The emulators accept unsigned requests; firebase-admin reads the *_EMULATOR_HOST variables itself.
    return initializeApp({ projectId, storageBucket }, ADMIN_APP_NAME);
  }

  try {
    return initializeApp({ credential: applicationDefault(), projectId, storageBucket }, ADMIN_APP_NAME);
  } catch (error) {
    // A parallel request can initialize the app first; reuse it.
    if (getApps().some((app) => app.name === ADMIN_APP_NAME)) return getApp(ADMIN_APP_NAME);
    throw error;
  }
}

let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

function resolveAuth(): Auth {
  if (!authInstance) authInstance = getAuth(getAdminApp());
  return authInstance;
}

function resolveDb(): Firestore {
  if (!dbInstance) {
    const db = getFirestore(getAdminApp());
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // settings() throws when the instance was already used (for example after a dev hot reload); keep it.
    }
    dbInstance = db;
  }
  return dbInstance;
}

/** Forward every property access to the real instance, created on first use. */
function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const real = resolve();
      const value: unknown = Reflect.get(real, prop, real);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    },
    has(_target, prop) {
      return Reflect.has(resolve(), prop);
    },
  });
}

export const adminAuth: Auth = lazyProxy(resolveAuth);
export const adminDb: Firestore = lazyProxy(resolveDb);

/** Cloud Storage default bucket (NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET). */
export function getAdminBucket(): Bucket {
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const storage = getStorage(getAdminApp());
  return bucketName ? storage.bucket(bucketName) : storage.bucket();
}

/** Read the `code` of a firebase-admin / Firestore error without `any`. */
export function firebaseErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
    if (typeof code === 'number') return String(code);
  }
  return undefined;
}
