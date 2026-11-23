import { NextResponse } from 'next/server';
import { assignableRoles, manageDeniedReason, roleCohortFitError, rolesWith } from '@/lib/auth/rbac';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb, firebaseErrorCode } from '@/lib/firebase/admin';
import { requireAuth } from '@/lib/firebase/auth-guard';
import { isSyntheticLcEmail, lcNumberToEmail, normalizeLcNumber } from '@/lib/firebase/lc-id';
import { buildNewUserDoc, claimsForUser, generateTemporaryPassword } from '@/lib/firebase/users';
import {
  RosterImportRequestSchema,
  type RosterImportResponse,
  type RosterImportRow,
} from '@/lib/schemas/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CSV_HEADER = 'displayName,loginIdentifier,temporaryPassword,role,partnerCohortId';

function csvCell(value: string): string {
  // Quote every cell that needs it, and neutralize spreadsheet formula prefixes.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

interface CreatedCredential {
  displayName: string;
  loginIdentifier: string;
  temporaryPassword: string;
  role: string;
  partnerCohortId: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireAuth(req, rolesWith('users.invite'));
  if (!auth.ok) return auth.response;
  const actor = auth.user;

  const body: unknown = await req.json().catch(() => null);
  const parsed = RosterImportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'VALIDATION_FAILED',
        message: 'One or more rows are not valid. Check each row and try again.',
        details: parsed.error.flatten(),
      },
      { status: 400 },
    );
  }

  const cohortSnaps = await adminDb.collection('cohorts').get();
  const cohortIds = new Set(cohortSnaps.docs.map((doc) => doc.id));
  const internalCohortIds = new Set(cohortSnaps.docs.filter((doc) => doc.get('isInternal') === true).map((doc) => doc.id));

  const errors: RosterImportResponse['errors'] = [];
  const credentials: CreatedCredential[] = [];
  const seenLogins = new Set<string>();

  const rows: RosterImportRow[] = parsed.data.rows;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const fail = (message: string) => errors.push({ rowIndex, message });

    if (!assignableRoles(actor.role).includes(row.role)) {
      fail(manageDeniedReason(actor.role, row.role));
      continue;
    }
    if (!cohortIds.has(row.partnerCohortId)) {
      fail(`Cohort "${row.partnerCohortId}" does not exist.`);
      continue;
    }
    const fitError = roleCohortFitError(row.role, internalCohortIds.has(row.partnerCohortId));
    if (fitError) {
      fail(fitError);
      continue;
    }

    const lcNumber = row.lcNumber ? normalizeLcNumber(row.lcNumber) : null;
    const email = lcNumber ? lcNumberToEmail(lcNumber) : (row.email ?? '').trim().toLowerCase();
    if (!lcNumber && isSyntheticLcEmail(email)) {
      fail('Use the LC Number column for LC-ID accounts, not the synthetic email.');
      continue;
    }
    const loginIdentifier = lcNumber ?? email;
    if (seenLogins.has(email)) {
      fail(`${loginIdentifier} appears more than once in this import.`);
      continue;
    }
    seenLogins.add(email);

    if (lcNumber) {
      const lcInUse = await adminDb.collection('users').where('lcNumber', '==', lcNumber).limit(1).get();
      if (!lcInUse.empty) {
        fail(`${lcNumber} is already in use.`);
        continue;
      }
    }

    const password = row.initialPassword ?? generateTemporaryPassword();
    let uid: string;
    try {
      const record = await adminAuth.createUser({
        email,
        password,
        displayName: row.displayName.trim(),
        emailVerified: false,
      });
      uid = record.uid;
    } catch (error) {
      const code = firebaseErrorCode(error);
      if (code === 'auth/email-already-exists') fail(`${loginIdentifier} already has an account.`);
      else if (code === 'auth/invalid-password') fail('The initial password is too weak (use 8 characters or more).');
      else if (code === 'auth/invalid-email') fail(`${loginIdentifier} is not a valid email address.`);
      else fail('The account could not be created.');
      continue;
    }

    try {
      const userDoc = buildNewUserDoc({
        uid,
        email,
        authMethod: lcNumber ? 'LC_ID_PASSWORD' : 'EMAIL_PASSWORD',
        lcNumber,
        displayName: row.displayName,
        role: row.role,
        partnerCohortId: row.partnerCohortId,
        divisionIds: row.divisionIds,
      });
      await adminAuth.setCustomUserClaims(uid, claimsForUser(userDoc, true));
      const batch = adminDb.batch();
      batch.create(adminDb.collection('users').doc(uid), userDoc);
      if (row.role === 'AGENT') {
        batch.update(adminDb.collection('cohorts').doc(row.partnerCohortId), {
          activeAgentCount: FieldValue.increment(1),
          updatedAt: Date.now(),
        });
      }
      await batch.commit();
      credentials.push({
        displayName: userDoc.displayName,
        loginIdentifier,
        temporaryPassword: password,
        role: row.role,
        partnerCohortId: row.partnerCohortId,
      });
    } catch (error) {
      console.error('[roster/import] provisioning failed', { rowIndex, error });
      await adminAuth.deleteUser(uid).catch((cleanupError: unknown) => {
        console.error('[roster/import] cleanup of new Auth account failed', cleanupError);
      });
      fail('The account could not be saved. No account was created for this row.');
    }
  }

  const credentialsCsv = [
    CSV_HEADER,
    ...credentials.map((c) =>
      [c.displayName, c.loginIdentifier, c.temporaryPassword, c.role, c.partnerCohortId].map(csvCell).join(','),
    ),
  ].join('\n');

  const response: RosterImportResponse = { createdCount: credentials.length, errors, credentialsCsv };
  return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
}
