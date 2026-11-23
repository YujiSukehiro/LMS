/**
 * The daily Verbal Practice limit resets at midnight UTC. Agents in Nicaragua or Nigeria see that as a local clock
 * time ("resets at 6:00 PM"), which "tomorrow (UTC)" did not tell them (QA L17). Pure; `now` and `locale` are
 * injectable for tests.
 */
export function nextUtcMidnight(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

export function dailyLimitMessage(serverMessage: string, now: Date = new Date(), locale?: string, timeZone?: string): string {
  const reset = nextUtcMidnight(now);
  const time = reset.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
  const sameDay = reset.toLocaleDateString(locale, timeZone ? { timeZone } : undefined) === now.toLocaleDateString(locale, timeZone ? { timeZone } : undefined);
  const base = serverMessage.replace(/\s*The limit resets at midnight UTC\.?$/, '').replace(/\s*Try again tomorrow \(UTC\)\.?$/, '');
  return `${base} It resets at ${time}${sameDay ? ' today' : ' tomorrow'} (your time).`;
}
