import { describe, expect, it, vi } from 'vitest';
import { renderInviteEmail } from '@/lib/email/invite-email';
import { emailConfigured, sendEmail } from '@/lib/email/send';

const input = {
  displayName: 'Pat <Partner>',
  inviterName: 'Connor',
  roleLabel: 'Partner Supervisor',
  cohortName: 'THS (Nicaragua)',
  setupUrl: 'https://pulse.example/invite/abc_DEF-123',
  expiresAt: Date.UTC(2026, 11, 22),
};

describe('invite email template', () => {
  it('renders a subject, a button to the setup link, the role, team and expiry, plus a plain-text part', () => {
    const email = renderInviteEmail(input);
    expect(email.subject).toBe('Connor invited you to LogiCall Pulse');
    expect(email.html).toContain('href="https://pulse.example/invite/abc_DEF-123"');
    expect(email.html).toContain('Set up my account');
    expect(email.html).toContain('Partner Supervisor');
    expect(email.html).toContain('THS (Nicaragua)');
    expect(email.html).toContain('December 22, 2026');
    expect(email.text).toContain('Set up your account: https://pulse.example/invite/abc_DEF-123');
  });

  it('escapes names so invite data cannot inject HTML', () => {
    const email = renderInviteEmail(input);
    expect(email.html).toContain('Pat');
    expect(email.html).not.toContain('<Partner>');
    const hostile = renderInviteEmail({ ...input, inviterName: '<img src=x onerror=alert(1)>' });
    expect(hostile.html).not.toContain('<img src=x');
    expect(hostile.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('sendEmail', () => {
  const message = { to: 'pat@example.com', subject: 's', html: '<p>h</p>', text: 't' };

  it('is a no-op that reports not_configured without a key or sender', async () => {
    const fetchImpl = vi.fn();
    expect(emailConfigured({})).toBe(false);
    expect(await sendEmail(message, { env: {}, fetchImpl })).toEqual({ status: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts to Resend with the configured sender and reports the message id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }));
    const env = { RESEND_API_KEY: 're_test', EMAIL_FROM: 'LogiCall Pulse <pulse@logicall.io>', EMAIL_REPLY_TO: 'help@logicall.io' };
    expect(await sendEmail(message, { env, fetchImpl })).toEqual({ status: 'sent', id: 'msg_1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
    expect(JSON.parse(String(init.body))).toMatchObject({ from: env.EMAIL_FROM, to: ['pat@example.com'], reply_to: 'help@logicall.io' });
  });

  it('reports a provider error without leaking the key', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ name: 'validation_error', message: 'domain not verified' }), { status: 403 }));
    const result = await sendEmail(message, { env: { RESEND_API_KEY: 're_secret', EMAIL_FROM: 'a@b.c' }, fetchImpl });
    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('re_secret');
    expect(JSON.stringify(result)).toContain('domain not verified');
  });

  it('prefers Gmail/Workspace SMTP when an App Password is configured, using the alias as From', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '<m1@gmail>' }));
    const smtpFactory = vi.fn(() => ({ sendMail }));
    const fetchImpl = vi.fn();
    const env = {
      SMTP_USER: 'connorleavitt@logicall.io',
      SMTP_PASSWORD: 'abcd efgh ijkl mnop',
      EMAIL_FROM: 'LogiCall Pulse <pulse@logicall.io>',
      RESEND_API_KEY: 're_unused',
    };
    expect(emailConfigured(env)).toBe(true);
    expect(await sendEmail(message, { env, fetchImpl, smtpFactory })).toEqual({ status: 'sent', id: '<m1@gmail>' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(smtpFactory).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'connorleavitt@logicall.io', pass: 'abcdefghijklmnop' },
    }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'LogiCall Pulse <pulse@logicall.io>', to: 'pat@example.com' }));
  });

  it('reports an SMTP failure by code without the password', async () => {
    const smtpFactory = vi.fn(() => ({ sendMail: vi.fn(async () => { throw Object.assign(new Error('Invalid login: secretpass'), { code: 'EAUTH' }); }) }));
    const result = await sendEmail(message, { env: { SMTP_USER: 'a@logicall.io', SMTP_PASSWORD: 'secretpass', EMAIL_FROM: 'a@logicall.io' }, smtpFactory });
    expect(result).toEqual({ status: 'failed', reason: 'smtp EAUTH' });
  });
});
