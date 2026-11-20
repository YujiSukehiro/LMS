import { INTERNAL_OPS_ROLES } from '@/lib/schemas/constants';
import type { UserRole } from '@/lib/schemas/domain';

type RuntimeProvider = 'ollama' | 'gemini' | 'openai_compatible' | 'manual_chat' | 'replay';

/**
 * The health route is internal-ops only (403 for everyone else), so only those roles poll it.
 * Agents and supervisors see the static runtime label without a failing request on every page.
 */
export function shouldCheckAiHealth(provider: RuntimeProvider, role: UserRole | undefined): boolean {
  if (provider === 'manual_chat' || provider === 'replay') return false;
  return role !== undefined && INTERNAL_OPS_ROLES.includes(role);
}
