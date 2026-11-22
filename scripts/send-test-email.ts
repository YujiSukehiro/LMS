/**
 * Send a sample invite email to check the email setup. Reads the Gmail App Password from a file and never prints it.
 *   npx tsx scripts/send-test-email.ts <to> <smtpUser> [passwordFile]
 */
import { readFileSync } from 'node:fs';
import { renderInviteEmail } from '../src/lib/email/invite-email';
import { sendEmail } from '../src/lib/email/send';

const [to, smtpUser, passwordFile = '.secrets/gmail_app_password.txt'] = process.argv.slice(2);
if (!to || !smtpUser) {
  console.error('Usage: tsx scripts/send-test-email.ts <to> <smtpUser> [passwordFile]');
  process.exit(1);
}
const password = readFileSync(passwordFile, 'utf8').trim();
const email = renderInviteEmail({
  displayName: 'Connor',
  inviterName: 'LogiCall Pulse (test)',
  roleLabel: 'Super Admin',
  cohortName: 'LogiCall Internal',
  setupUrl: 'https://logicall-pulse--telehealthlms.us-central1.hosted.app/login',
  expiresAt: Date.now() + 30 * 86_400_000,
});
const result = await sendEmail(
  { to, subject: `[Test] ${email.subject}`, html: email.html, text: email.text },
  { env: { SMTP_USER: smtpUser, SMTP_PASSWORD: password, EMAIL_FROM: 'LogiCall Pulse <pulse@logicall.io>' } },
);
console.log(JSON.stringify(result));
process.exitCode = result.status === 'sent' ? 0 : 1;
