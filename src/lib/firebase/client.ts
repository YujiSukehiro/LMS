/**
 * Browser Firebase SDK accessors. No work happens at import time; every instance is created on first use.
 * Never import `./admin` (or anything that imports it) from this file.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signOut, type Auth, type User } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectStorageEmulator, getStorage, type FirebaseStorage } from 'firebase/storage';
import { CreateSessionResponseSchema, type CreateSessionResponse } from '@/lib/schemas/api';

export { identifierToEmail } from './lc-id';

const USE_EMULATOR = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
const EMULATOR_HOST = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOSTNAME || '127.0.0.1';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
};

let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let storageInstance: FirebaseStorage | null = null;

export function getClientApp(): FirebaseApp {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export function getClientAuth(): Auth {
  if (authInstance) return authInstance;
  const auth = getAuth(getClientApp());
  if (USE_EMULATOR && !auth.emulatorConfig) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
  }
  authInstance = auth;
  return auth;
}

export function getClientDb(): Firestore {
  if (dbInstance) return dbInstance;
  const db = getFirestore(getClientApp());
  if (USE_EMULATOR) connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
  dbInstance = db;
  return db;
}

export function getClientStorage(): FirebaseStorage {
  if (storageInstance) return storageInstance;
  const storage = getStorage(getClientApp());
  if (USE_EMULATOR) connectStorageEmulator(storage, EMULATOR_HOST, 9199);
  storageInstance = storage;
  return storage;
}

/** Error raised when `/api/auth/session` refuses to open a session. */
export class SessionRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SessionRequestError';
    this.code = code;
    this.status = status;
  }
}

async function postIdToken(idToken: string): Promise<CreateSessionResponse> {
  const response = await fetch('/api/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ idToken }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const code = typeof record.error === 'string' ? record.error : 'SESSION_FAILED';
    const message = typeof record.message === 'string' ? record.message : 'The server did not accept the sign-in.';
    throw new SessionRequestError(code, message, response.status);
  }
  return CreateSessionResponseSchema.parse(body);
}

/**
 * Exchange the Firebase ID token for the `__session` cookie.
 * When the server says the claims were just changed, force-refresh the token and send it again once.
 */
export async function establishServerSession(user: User): Promise<CreateSessionResponse> {
  let result = await postIdToken(await user.getIdToken());
  if (!result.refreshClaimsRequired) return result;
  result = await postIdToken(await user.getIdToken(true));
  if (result.refreshClaimsRequired) {
    throw new SessionRequestError(
      'CLAIMS_NOT_REFRESHED',
      'Your access settings are still updating. Wait a few seconds and sign in again.',
      409,
    );
  }
  return result;
}

/** DELETE /api/auth/session + client signOut. The caller then navigates to /login. */
export async function signOutEverywhere(): Promise<void> {
  try {
    await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' });
  } finally {
    await signOut(getClientAuth());
  }
}
