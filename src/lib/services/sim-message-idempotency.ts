import type { SimMessage } from '@/lib/schemas/analytics';

export interface StoredTurn {
  agentMessage: SimMessage;
  /** The caller reply saved with that learner turn; null when the call ended without one. */
  reply: SimMessage | null;
  /** Agent turns up to and including this one, which is the turnCount the original request returned. */
  turnCount: number;
}

/** The saved learner turn that was sent with this idempotency key, or null when the key is new. */
export function findStoredTurn(messages: readonly SimMessage[], idempotencyKey: string | undefined): StoredTurn | null {
  if (!idempotencyKey) return null;
  const index = messages.findIndex((message) => message.role === 'agent' && message.idempotencyKey === idempotencyKey);
  if (index === -1) return null;
  const next = messages[index + 1];
  return {
    agentMessage: messages[index]!,
    reply: next && next.role === 'counterparty' ? next : null,
    turnCount: messages.slice(0, index + 1).filter((message) => message.role === 'agent').length,
  };
}
