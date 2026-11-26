import { z } from 'zod';

/**
 * Verbal Practice delivery coaching (Connor 2026-11-24, option 2): how the agent sounded, scored from the audio of
 * their spoken replies. It is coaching only and never changes the Rubric score, pass result or certification.
 */
export const DELIVERY_DIMENSIONS = ['warmth', 'pace', 'conciseness', 'confidence', 'professionalism'] as const;
export const DeliveryDimensionKeySchema = z.enum(DELIVERY_DIMENSIONS);
export type DeliveryDimensionKey = z.infer<typeof DeliveryDimensionKeySchema>;

export const DELIVERY_DIMENSION_LABELS: Record<DeliveryDimensionKey, string> = {
  warmth: 'Friendly, helpful tone',
  pace: 'Unhurried pace',
  conciseness: 'To the point, not wordy',
  confidence: 'Clear and confident',
  professionalism: 'Professional and patient',
};

const clampText = (max: number) => z.string().transform((value) => value.trim().slice(0, max));

/** What the model returns. Scores are 1-5 per dimension; the overall score is computed in code. */
export const DeliveryModelOutputSchema = z.object({
  dimensions: z
    .array(
      z.object({
        key: DeliveryDimensionKeySchema,
        score: z.coerce.number().min(1).max(5).transform((n) => Math.round(n)),
        note: clampText(280),
      }),
    )
    .min(1)
    // Room for a repeated dimension: normalizeDimensions keeps the first answer per key, so a duplicate is not fatal.
    .max(DELIVERY_DIMENSIONS.length * 2),
  strengths: z.array(clampText(240)).max(3).default([]),
  coachingTips: z.array(clampText(280)).max(3).default([]),
  summary: clampText(400),
});
export type DeliveryModelOutput = z.infer<typeof DeliveryModelOutputSchema>;

export const DeliveryAssessmentSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  dimensions: z.array(z.object({ key: DeliveryDimensionKeySchema, score: z.number().int().min(1).max(5), note: z.string() })),
  strengths: z.array(z.string()),
  coachingTips: z.array(z.string()),
  summary: z.string(),
  spokenTurns: z.number().int().nonnegative(),
  spokenSeconds: z.number().nonnegative(),
  model: z.string(),
  assessedAt: z.number(),
});
export type DeliveryAssessment = z.infer<typeof DeliveryAssessmentSchema>;

/** Upload limits for one session's spoken replies (about 10 minutes of Opus at 24 kbps is under 2 MB). */
export const DELIVERY_MAX_CLIPS = 30;
export const DELIVERY_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const DELIVERY_MAX_TOTAL_SECONDS = 15 * 60;
export const DELIVERY_AUDIO_MIME_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'] as const;

export const DeliveryClipMetaSchema = z.object({
  /** Position of the reply among the agent's messages in the session (0 = first agent reply). */
  agentTurnIndex: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().max(DELIVERY_MAX_TOTAL_SECONDS * 1000),
});
export const DeliveryRequestMetaSchema = z.object({ clips: z.array(DeliveryClipMetaSchema).min(1).max(DELIVERY_MAX_CLIPS) });
export type DeliveryRequestMeta = z.infer<typeof DeliveryRequestMetaSchema>;
