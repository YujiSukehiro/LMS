/** Pure Live Call Sim session-limit rules (no I/O) so unit tests can import them. */

/**
 * True when a started session counts toward the daily limit. Sessions where the learner never
 * completed a turn (for example the AI caller was down, or they left during pre-call) do not count,
 * so a model outage cannot lock a learner out for the day. Abandoned sessions with real dialogue
 * still count (they used the AI caller).
 */
export function countsTowardDailySimLimit(doc: { status?: unknown; turnCount?: unknown }): boolean {
  const turns = typeof doc.turnCount === 'number' ? doc.turnCount : 1; // legacy docs without turnCount count
  if (turns > 0) return true;
  return doc.status === 'EVALUATED';
}
