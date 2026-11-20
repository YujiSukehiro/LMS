/**
 * Checkpoint score shown to the learner. First-try accuracy (server `firstIndependent`) stays the analytics
 * measure, but on "Practice Again" nothing is a first try any more, so the completion card shows how this
 * round went instead of a misleading 0%.
 */
export interface DrillRoundSummary {
  /** Drills answered correctly on their first answer in this round. */
  correct: number;
  total: number;
  /** True when this round repeated Drills the learner had already answered before. */
  replay: boolean;
}

export interface RoundFirstAnswer {
  correct: boolean;
  /** Server-derived: true only for the learner's very first attempt at this Drill. */
  firstIndependent: boolean;
}

export function summarizeDrillRound(firstAnswers: Readonly<Record<number, RoundFirstAnswer>>, total: number): DrillRoundSummary {
  const answers = Object.values(firstAnswers);
  return {
    correct: answers.filter((answer) => answer.correct).length,
    total,
    replay: answers.some((answer) => !answer.firstIndependent),
  };
}

export interface CheckpointScoreLine {
  label: string;
  pct: number;
  detail: string;
}

export function checkpointScoreLine(
  firstTry: { firstTryCorrect: number; total: number; accuracyPct: number },
  round?: DrillRoundSummary | null,
): CheckpointScoreLine {
  if (round?.replay) {
    return {
      label: 'This Round',
      pct: round.total === 0 ? 100 : Math.round((round.correct / round.total) * 100),
      detail: `${round.correct}/${round.total} correct this round`,
    };
  }
  return { label: 'First-Try Accuracy', pct: firstTry.accuracyPct, detail: `${firstTry.firstTryCorrect}/${firstTry.total} first try` };
}
