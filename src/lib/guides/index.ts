import type { GuideRoleId, RoleGuide } from './types';
import { AGENT_GUIDE } from './agent';
import { SUPERVISOR_GUIDE } from './supervisor';
import { TRAINER_GUIDE } from './trainer';
import { ADMIN_GUIDE } from './admin';

/** Every role's guide. The Guide page, the Markdown export and the tests all read this. */
export const GUIDES: Record<GuideRoleId, RoleGuide> = {
  AGENT: AGENT_GUIDE,
  SUPERVISOR: SUPERVISOR_GUIDE,
  TRAINER: TRAINER_GUIDE,
  ADMIN: ADMIN_GUIDE,
};
