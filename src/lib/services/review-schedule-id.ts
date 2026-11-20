import { createHash } from 'node:crypto';

/** Canonical Firestore doc ID for `reviewSchedules` shared by runtime answers and seed scripts. */
export function reviewScheduleDocId(learnerId: string, curriculumVersion: string, drillId: string): string {
  const hex = createHash('sha256').update(`${learnerId}:${curriculumVersion}:${drillId}`).digest('hex');
  return `review_${hex}`;
}
