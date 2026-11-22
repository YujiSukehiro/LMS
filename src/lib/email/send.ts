/**
 * Transactional email sender. Uses the Resend HTTPS API (no SDK dependency).
 * Configuration (all server-side):
 *   RESEND_API_KEY  secret; when unset, email is "not_configured" and callers fall back to copy-link
 *   EMAIL_FROM      e.g. "LogiCall Pulse <pulse@logicall.io>" (domain must be verified in Resend)
 *   EMAIL_REPLY_TO  optional reply-to address
 * Server only.
 */
export type EmailSendResult =
  | { status: 'sent'; id: string | null }
  | { status: 'not_configured' }
  | { status: 'failed'; reason: string };

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const SEND_TIMEOUT_MS = 10_000;

export function emailConfigured(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim());
}

export async function sendEmail(
  message: OutgoingEmail,
  options: { env?: Readonly<Record<string, string | undefined>>; fetchImpl?: typeof fetch } = {},
): Promise<EmailSendResult> {
  const env = options.env ?? process.env;
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  if (!apiKey || !from) return { status: 'not_configured' };
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(env.EMAIL_REPLY_TO?.trim() ? { reply_to: env.EMAIL_REPLY_TO.trim() } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!response.ok) {
      // Never include the key; Resend error bodies only carry a name and message.
      return { status: 'failed', reason: `${response.status} ${body.name ?? ''} ${body.message ?? ''}`.trim().slice(0, 200) };
    }
    return { status: 'sent', id: body.id ?? null };
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.name : 'unknown error' };
  }
}
