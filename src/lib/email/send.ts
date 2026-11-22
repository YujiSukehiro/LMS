/**
 * Transactional email sender. Two transports, picked by configuration (all server-side):
 *   Gmail / Google Workspace SMTP (preferred when set; free with Workspace):
 *     SMTP_USER        the Workspace account that owns the App Password (e.g. connorleavitt@logicall.io)
 *     SMTP_PASSWORD    secret: that account's 16-character App Password
 *     SMTP_HOST/PORT   optional, default smtp.gmail.com:465 (TLS)
 *   Resend HTTPS API:
 *     RESEND_API_KEY   secret
 *   Both:
 *     EMAIL_FROM       e.g. "LogiCall Pulse <pulse@logicall.io>" (for Gmail: the account or a "Send mail as" alias)
 *     EMAIL_REPLY_TO   optional reply-to address
 * With neither transport configured, sending reports "not_configured" and callers fall back to copy-link.
 * Server only.
 */
import nodemailer from 'nodemailer';
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

type Env = Readonly<Record<string, string | undefined>>;

function smtpConfigured(env: Env): boolean {
  return Boolean(env.SMTP_USER?.trim() && env.SMTP_PASSWORD?.trim());
}

export function emailConfigured(env: Env = process.env): boolean {
  return Boolean(env.EMAIL_FROM?.trim() && (smtpConfigured(env) || env.RESEND_API_KEY?.trim()));
}

/** Test seam: replace how the SMTP transport is created. */
export type SmtpTransportFactory = (options: {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
}) => { sendMail: (mail: Record<string, unknown>) => Promise<{ messageId?: string }> };

const defaultSmtpFactory: SmtpTransportFactory = (options) =>
  nodemailer.createTransport({ ...options, connectionTimeout: SEND_TIMEOUT_MS, greetingTimeout: SEND_TIMEOUT_MS, socketTimeout: SEND_TIMEOUT_MS });

async function sendViaSmtp(message: OutgoingEmail, env: Env, factory: SmtpTransportFactory): Promise<EmailSendResult> {
  const port = Number(env.SMTP_PORT?.trim() || 465);
  try {
    const transport = factory({
      host: env.SMTP_HOST?.trim() || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER!.trim(), pass: env.SMTP_PASSWORD!.replace(/\s+/g, '') },
    });
    const info = await transport.sendMail({
      from: env.EMAIL_FROM!.trim(),
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(env.EMAIL_REPLY_TO?.trim() ? { replyTo: env.EMAIL_REPLY_TO.trim() } : {}),
    });
    return { status: 'sent', id: info.messageId ?? null };
  } catch (error) {
    // SMTP errors carry a code and response text, never the password.
    const code = (error as { code?: string; responseCode?: number }).code ?? (error as { responseCode?: number }).responseCode;
    return { status: 'failed', reason: `smtp ${code ?? (error instanceof Error ? error.name : 'error')}`.slice(0, 200) };
  }
}

export async function sendEmail(
  message: OutgoingEmail,
  options: { env?: Env; fetchImpl?: typeof fetch; smtpFactory?: SmtpTransportFactory } = {},
): Promise<EmailSendResult> {
  const env = options.env ?? process.env;
  const from = env.EMAIL_FROM?.trim();
  if (from && smtpConfigured(env)) return sendViaSmtp(message, env, options.smtpFactory ?? defaultSmtpFactory);
  const apiKey = env.RESEND_API_KEY?.trim();
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
