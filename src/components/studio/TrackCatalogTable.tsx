import Link from "next/link";
import { TRAINING_POLICY } from "@/lib/policy/training-policy";
import type { TrackDoc } from "@/lib/schemas/curriculum";
import { DivisionPill } from "@/components/layout/DivisionPill";
import { relativeTime } from "@/components/layout/labels";
import { TrackStatusPill } from "./TrackStatusPill";
import { trackBuildFailed, trackDisplayStatus } from "./track-display-status";

/** "Every Cohort", "2 Cohorts · 3 people", or "Not assigned" for a published Track. */
function assignmentSummary(track: TrackDoc): string {
  if (track.assignedCohortIds.includes("ALL")) {
    const people = track.assignedUserIds?.length ?? 0;
    return people > 0 ? `Every Cohort · ${people} named` : "Every Cohort";
  }
  const cohorts = track.assignedCohortIds.length;
  const people = track.assignedUserIds?.length ?? 0;
  const parts = [
    cohorts > 0 ? `${cohorts} Cohort${cohorts === 1 ? "" : "s"}` : "",
    people > 0 ? `${people} ${people === 1 ? "person" : "people"}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Not assigned";
}

function assignHref(track: TrackDoc): string {
  return `/studio/${encodeURIComponent(track.id)}?assign=1`;
}

function versionLabel(track: TrackDoc): string {
  if (track.publishedVersionId) return track.publishedVersionId;
  return "Draft";
}

export function TrackCatalogTable({ tracks }: { tracks: TrackDoc[] }) {
  const now = Date.now();
  return (
    <>
      {/* QA L14: on a phone the table hid the Status column off-screen, so each Track is a card there. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {tracks.map((track) => (
          <li key={track.id}>
            <Link
              href={`/studio/${encodeURIComponent(track.id)}`}
              className="pulse-card flex flex-col gap-2 p-3.5 hover:border-pulse-border"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 font-medium">{track.title}</span>
                <TrackStatusPill status={trackDisplayStatus(track)} />
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-pulse-muted">
                <DivisionPill divisionId={track.divisionId} short />
                {track.campaignCode ? (
                  <span className="pulse-metric">{track.campaignCode}</span>
                ) : null}
                <span>
                  {track.unitCount} Checkpoint{track.unitCount === 1 ? '' : 's'} · {track.simScenarioCount}{" "}
                  {TRAINING_POLICY.simulationInteractionMode === "verbal_only"
                    ? "Practice"
                    : "Sims"}
                </span>
                <span className="pulse-metric">{versionLabel(track)}</span>
                <span>{relativeTime(track.updatedAt, now)}</span>
              </span>
              {trackBuildFailed(track) ? (
                <span className="text-[0.7rem] font-semibold text-pulse-crimson">
                  {track.status === "GENERATING"
                    ? "Build failed · open to retry"
                    : "Revision build failed · open to retry"}
                </span>
              ) : track.status === "GENERATING" ? (
                <span className="pulse-metric text-[0.7rem] text-pulse-muted">
                  Building · {Math.round(track.generationProgress.percent)}%
                </span>
              ) : null}
            </Link>
            {track.publishedVersionId ? (
              <div className="mt-1 flex items-center justify-between gap-2 px-1 text-xs">
                <span className="text-pulse-muted">Assigned: {assignmentSummary(track)}</span>
                <Link href={assignHref(track)} className="font-semibold text-pulse-indigo-text hover:underline">
                  Edit assignment
                </Link>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="pulse-card relative hidden overflow-x-auto md:block">
        <table className="w-full min-w-[940px] text-sm">
          <thead>
            <tr className="border-b border-pulse-border-subtle text-left">
              <th scope="col" className="pulse-label px-4 py-3">
                Track
              </th>
              <th scope="col" className="pulse-label px-3 py-3">
                Division
              </th>
              <th scope="col" className="pulse-label px-3 py-3">
                Status
              </th>
              <th scope="col" className="pulse-label px-3 py-3">
                Published version
              </th>
              <th scope="col" className="pulse-label px-3 py-3">
                Assigned to
              </th>
              <th scope="col" className="pulse-label px-3 py-3 text-right">
                Checkpoints
              </th>
              <th scope="col" className="pulse-label px-3 py-3 text-right">
                {TRAINING_POLICY.simulationInteractionMode === "verbal_only"
                  ? "Verbal Practice"
                  : "Live Call Sims"}
              </th>
              <th scope="col" className="pulse-label px-4 py-3 text-right">
                Updated
              </th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => (
              <tr
                key={track.id}
                className="border-b border-pulse-border-subtle/60 last:border-0 hover:bg-pulse-surface-2/40"
              >
                <th scope="row" className="px-4 py-3 text-left font-medium">
                  <Link
                    href={`/studio/${encodeURIComponent(track.id)}`}
                    className="hover:text-pulse-indigo hover:underline"
                  >
                    {track.title}
                  </Link>
                  <span className="block text-xs font-normal text-pulse-muted">
                    {[track.campaignCode, track.sourcePdfFileName]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </th>
                <td className="px-3 py-3">
                  <DivisionPill divisionId={track.divisionId} short />
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-col items-start gap-1">
                    <TrackStatusPill status={trackDisplayStatus(track)} />
                    {trackBuildFailed(track) ? (
                      <Link
                        href={`/studio/${encodeURIComponent(track.id)}`}
                        className="text-[0.7rem] font-semibold text-pulse-crimson hover:underline"
                        title={track.generationProgress.message}
                      >
                        {track.status === "GENERATING"
                          ? "Open to retry"
                          : "Revision build failed · Open to retry"}
                      </Link>
                    ) : track.status === "GENERATING" ? (
                      <span className="pulse-metric text-[0.7rem] text-pulse-muted">
                        {Math.round(track.generationProgress.percent)}%
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="pulse-metric px-3 py-3 text-pulse-secondary">
                  {versionLabel(track)}
                </td>
                <td className="px-3 py-3">
                  {track.publishedVersionId ? (
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="whitespace-nowrap text-xs text-pulse-secondary">{assignmentSummary(track)}</span>
                      <Link href={assignHref(track)} className="whitespace-nowrap text-xs font-semibold text-pulse-indigo-text hover:underline">
                        Edit assignment
                      </Link>
                    </div>
                  ) : (
                    <span className="whitespace-nowrap text-xs text-pulse-muted">Not published</span>
                  )}
                </td>
                <td className="pulse-metric px-3 py-3 text-right">
                  {track.unitCount}
                </td>
                <td className="pulse-metric px-3 py-3 text-right">
                  {track.simScenarioCount}
                </td>
                <td
                  className="pulse-metric px-4 py-3 text-right text-xs text-pulse-muted"
                  title={new Date(track.updatedAt).toISOString()}
                >
                  {relativeTime(track.updatedAt, now)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
