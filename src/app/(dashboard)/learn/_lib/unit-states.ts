import type { TrackUnit } from '@/lib/schemas/curriculum';
import type { CheckpointState } from '@/components/learn/CheckpointMap';

/** Units sorted by `orderIndex` (stable). */
export function sortUnits<T extends Pick<TrackUnit, 'orderIndex'>>(units: readonly T[]): T[] {
  return [...units].sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Sequential unlock: Unit i is open when every earlier Unit is in `completedUnitIds`.
 * Completed Units always stay open for practice; the first open, not-completed Unit is `current`.
 */
export function computeUnitStates(
  sortedUnits: ReadonlyArray<Pick<TrackUnit, 'id'>>,
  completedUnitIds: readonly string[],
): CheckpointState[] {
  const completed = new Set(completedUnitIds);
  let allPreviousComplete = true;
  return sortedUnits.map((unit) => {
    const state: CheckpointState = completed.has(unit.id) ? 'completed' : allPreviousComplete ? 'current' : 'locked';
    if (!completed.has(unit.id)) allPreviousComplete = false;
    return state;
  });
}

/** True when every Unit of the TrackVersion is in `completedUnitIds`. */
export function allUnitsComplete(units: ReadonlyArray<Pick<TrackUnit, 'id'>>, completedUnitIds: readonly string[]): boolean {
  const completed = new Set(completedUnitIds);
  return units.every((unit) => completed.has(unit.id));
}

/** Query-string suffix that keeps draft preview mode on internal links. */
export function previewSuffix(isPreview: boolean): string {
  return isPreview ? '?version=draft' : '';
}
