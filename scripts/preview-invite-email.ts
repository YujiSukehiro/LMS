/** Writes test-results/invite-email-preview.html so the invite email can be opened in a browser. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderInviteEmail } from '../src/lib/email/invite-email';

const email = renderInviteEmail({
  displayName: 'Pat Partner',
  inviterName: 'Connor',
  roleLabel: 'Partner Supervisor',
  cohortName: 'THS (Nicaragua)',
  setupUrl: 'https://logicall-pulse--telehealthlms.us-central1.hosted.app/invite/EXAMPLE-TOKEN',
  expiresAt: Date.now() + 30 * 86_400_000,
  supportEmail: process.env.EMAIL_REPLY_TO,
});
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/invite-email-preview.html', email.html);
console.log(`Subject: ${email.subject}\nWrote test-results/invite-email-preview.html`);
