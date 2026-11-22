/**
 * Branded invite email. Table-based layout with inline styles so it renders the same in Gmail,
 * Outlook and Apple Mail; no images or remote assets (nothing for a client to block).
 * Pure: safe to unit-test and to preview with `npm run email:preview`.
 */

export interface InviteEmailInput {
  displayName: string;
  inviterName: string;
  roleLabel: string;
  cohortName: string;
  setupUrl: string;
  /** Epoch ms, or null for no expiry. */
  expiresAt: number | null;
  supportEmail?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatExpiry(expiresAt: number | null): string | null {
  if (expiresAt === null) return null;
  return new Date(expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const INDIGO = '#4f46e5';
const TEXT = '#0f172a';
const MUTED = '#64748b';
const BORDER = '#e2e8f0';

export function renderInviteEmail(input: InviteEmailInput): RenderedEmail {
  const firstName = input.displayName.trim().split(/\s+/)[0] || input.displayName;
  const expiry = formatExpiry(input.expiresAt);
  const subject = `${input.inviterName} invited you to LogiCall Pulse`;
  const e = {
    first: escapeHtml(firstName),
    inviter: escapeHtml(input.inviterName),
    role: escapeHtml(input.roleLabel),
    cohort: escapeHtml(input.cohortName),
    url: escapeHtml(input.setupUrl),
    expiry: expiry ? escapeHtml(expiry) : null,
    support: input.supportEmail ? escapeHtml(input.supportEmail) : null,
  };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5fb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Set up your LogiCall Pulse account in about a minute.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5fb;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
      <tr><td style="padding:0 4px 20px 4px;font-family:Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:${TEXT};">
        <span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:8px;background:${INDIGO};color:#ffffff;text-align:center;font-size:15px;vertical-align:middle;">&#x2713;</span>
        <span style="vertical-align:middle;padding-left:8px;">LogiCall <span style="color:${INDIGO};">Pulse</span></span>
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid ${BORDER};border-radius:14px;padding:32px;font-family:Helvetica,Arial,sans-serif;color:${TEXT};">
        <h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;">You&rsquo;re invited, ${e.first}</h1>
        <p style="margin:0 0 20px 0;font-size:15px;line-height:1.6;color:#334155;">
          ${e.inviter} added you to <strong>LogiCall Pulse</strong>, LogiCall&rsquo;s training and campaign-readiness platform.
          Set up your account to get started.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;background:#f8fafc;border:1px solid ${BORDER};border-radius:10px;">
          <tr>
            <td style="padding:12px 16px;font-size:13px;color:${MUTED};width:90px;">Role</td>
            <td style="padding:12px 16px;font-size:14px;font-weight:600;color:${TEXT};">${e.role}</td>
          </tr>
          <tr>
            <td style="padding:0 16px 12px 16px;font-size:13px;color:${MUTED};">Team</td>
            <td style="padding:0 16px 12px 16px;font-size:14px;font-weight:600;color:${TEXT};">${e.cohort}</td>
          </tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
          <tr><td align="center" bgcolor="${INDIGO}" style="border-radius:10px;">
            <a href="${e.url}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Set up my account</a>
          </td></tr>
        </table>
        <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:${MUTED};">
          You&rsquo;ll choose a password, or use the Google account for this email address.${e.expiry ? ` This link works once and expires on <strong>${e.expiry}</strong>.` : ' This link works once.'}
        </p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};word-break:break-all;">
          Button not working? Paste this into your browser:<br><a href="${e.url}" style="color:${INDIGO};">${e.url}</a>
        </p>
      </td></tr>
      <tr><td style="padding:20px 8px 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};text-align:center;">
        You received this because a LogiCall administrator invited this address.
        If you weren&rsquo;t expecting it, you can ignore this email${e.support ? ` or contact <a href="mailto:${e.support}" style="color:${MUTED};">${e.support}</a>` : ''}.<br>
        LogiCall Services Inc.
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    `You're invited, ${firstName}`,
    '',
    `${input.inviterName} added you to LogiCall Pulse, LogiCall's training and campaign-readiness platform.`,
    '',
    `Role: ${input.roleLabel}`,
    `Team: ${input.cohortName}`,
    '',
    `Set up your account: ${input.setupUrl}`,
    '',
    `You'll choose a password, or use the Google account for this email address.${expiry ? ` This link works once and expires on ${expiry}.` : ' This link works once.'}`,
    '',
    "If you weren't expecting this, you can ignore this email.",
    'LogiCall Services Inc.',
  ].join('\n');

  return { subject, html, text };
}
