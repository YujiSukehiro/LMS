/**
 * Shared prompt text, Division profiles, and deterministic text helpers for the Track build prompts.
 * Pure module (no Firebase, no network).
 */
import type { CanonicalPillarKey, CompetencyPillar } from '@/lib/schemas/curriculum';
import type { DivisionId } from '@/lib/schemas/domain';
import { CANONICAL_PILLARS, DIVISION_LABELS } from '@/lib/schemas/constants';

/** Mandatory grounding rule (docs/04 §3.2). Every curriculum prompt includes it verbatim. */
export const GROUNDING_RULE =
  'NEVER invent refund percentages, prices, phone numbers, CRM names, clinical dosages, or escalation SLAs not explicitly stated in the provided SOURCE PAGES. Use synthetic customer names and synthetic order numbers for scenario framing while enforcing exact policy rules from the PDF.';

export const LANGUAGE_RULE = 'Write all content in plain, clear English only.';

export const CITATION_RULE =
  'Every item must cite the SOURCE PAGE numbers it is based on in "sourcePages". Cite only page numbers that appear in the provided SOURCE PAGES.';

export interface DivisionProfile {
  traineeDescription: string;
  playbookTypes: string;
  defaultPillars: string[];
  /** Suggested canonical keys for the four default pillars, in the same order. */
  defaultPillarKeys: CanonicalPillarKey[];
  counterparty: string;
  counterpartyRoleLabel: string;
}

/** Division-specific training profiles (docs/01 §3). */
export const DIVISION_PROFILES: Record<DivisionId, DivisionProfile> = {
  TELEHEALTH: {
    traineeDescription: 'telehealth intake specialists and clinical coordinators',
    playbookTypes: 'patient intake SOPs, clinical triage protocols, appointment scheduling guides, privacy and escalation rules',
    defaultPillars: [
      'Intake & Screening Accuracy',
      'Clinical Red-Flag Escalation',
      'Privacy & Boundary Compliance',
      'Patient Empathy & Clarity',
    ],
    defaultPillarKeys: ['verification_crm', 'escalation_triage', 'compliance_boundaries', 'empathy_communication'],
    counterparty:
      'a patient who wants a consultation, asks medication or scheduling questions, or reports an urgent symptom that needs escalation',
    counterpartyRoleLabel: 'Telehealth Patient',
  },
  INBOUND: {
    traineeDescription: 'inbound customer service representatives (phone and email)',
    playbookTypes: 'campaign refund and reship Playbooks, multi-campaign flow guides, CRM and escalation SOPs',
    defaultPillars: [
      'Identity & CRM Order Verification',
      'Save-Offer & Retention Execution',
      'Escalation Triage & Required Fields',
      'De-escalation & Disposition Accuracy',
    ],
    defaultPillarKeys: ['verification_crm', 'retention_objection', 'escalation_triage', 'closing_next_steps'],
    counterparty:
      'a frustrated buyer who demands a refund, reports broken bottles or medical side effects, or threatens a bank chargeback',
    counterpartyRoleLabel: 'Inbound Buyer',
  },
  OUTBOUND: {
    traineeDescription: 'outbound sales agents and recovery agents',
    playbookTypes: 'outbound campaign pitch books, offer and upsell matrices, continuity disclosure rules, rebuttal and PCI guides',
    defaultPillars: [
      'Discovery & Pitch Framing',
      'Offer, Pricing & Continuity Clarity',
      'Objection & Rebuttal Execution',
      'Order Close & Payment Compliance',
    ],
    defaultPillarKeys: ['workflow_execution', 'product_offer_terms', 'retention_objection', 'compliance_boundaries'],
    counterparty: 'a warm lead, an abandoned-cart shopper, or a skeptical prospect who raises price, trust, or spouse/timing objections',
    counterpartyRoleLabel: 'Outbound Lead',
  },
};

export function divisionLabel(divisionId: DivisionId): string {
  return DIVISION_LABELS[divisionId];
}

/** "- key: Label" lines for the 8 canonical CompetencyPillar keys. */
export function canonicalPillarList(): string {
  return CANONICAL_PILLARS.map((pillar) => `- ${pillar.key}: ${pillar.label}`).join('\n');
}

/** "- id (key): label — description" lines for prompts that must reference CompetencyPillar ids. */
export function describePillars(pillars: CompetencyPillar[]): string {
  return pillars.map((pillar) => `- ${pillar.id} (${pillar.key}): ${pillar.label} — ${pillar.description}`).join('\n');
}

/** Stable CompetencyPillar id for a canonical key. */
export function pillarIdForKey(key: string): string {
  return `pillar_${key}`;
}

/** Cut text to `max` characters at a word boundary when possible, and add an ellipsis if text was cut. */
export function clampText(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const hardCut = text.slice(0, Math.max(0, max - 1));
  const lastSpace = hardCut.lastIndexOf(' ');
  const cut = lastSpace >= Math.floor(max * 0.6) ? hardCut.slice(0, lastSpace) : hardCut;
  return `${cut.replace(/[\s,;:.-]+$/, '')}…`;
}

/** Same as clampText but keeps line breaks (for markdown bodies). */
export function clampMultiline(value: string, max: number): string {
  const text = value.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= max) return text;
  const hardCut = text.slice(0, Math.max(0, max - 1));
  const lastSpace = Math.max(hardCut.lastIndexOf(' '), hardCut.lastIndexOf('\n'));
  const cut = lastSpace >= Math.floor(max * 0.6) ? hardCut.slice(0, lastSpace) : hardCut;
  return `${cut.replace(/[\s,;:.-]+$/, '')}…`;
}

/** Keep at most `maxWords` words. */
export function clampWords(value: string, maxWords: number): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return `${words.slice(0, maxWords).join(' ')}…`;
}

export function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** Sorted unique page numbers that exist in `allowed`; falls back to `fallback` when none remain. */
export function sanitizePages(pages: readonly number[], allowed: ReadonlySet<number>, fallback: number[]): number[] {
  const kept = [...new Set(pages.filter((page) => Number.isInteger(page) && allowed.has(page)))].sort((a, b) => a - b);
  return kept.length > 0 ? kept : [...fallback];
}

/** Zod issue helper: report pages outside the allowed set. */
export function invalidPages(pages: readonly number[], allowed: ReadonlySet<number>): number[] {
  return pages.filter((page) => !allowed.has(page));
}

/** Short readable list of allowed page numbers (ranges collapsed). */
export function describePageSet(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
      continue;
    }
    if (start !== undefined) parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = current;
    prev = current;
  }
  return parts.join(', ');
}

interface PageText {
  pageNumber: number;
  text: string;
}

/**
 * Keep page text within a character budget. When the pages are too long, every page is cut
 * to an equal share so each cited page stays visible to the model.
 */
export function fitPagesToBudget<T extends PageText>(pages: readonly T[], charBudget: number): T[] {
  const total = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (total <= charBudget || pages.length === 0) return [...pages];
  const share = Math.max(400, Math.floor(charBudget / pages.length));
  return pages.map((page) =>
    page.text.length <= share ? page : { ...page, text: `${page.text.slice(0, share).trimEnd()} [page text shortened]` },
  );
}

/**
 * Choose page text for a prompt within a budget: pages in `preferred` order get full text first,
 * the remaining pages get a short excerpt so the model still sees the whole Playbook structure.
 */
export function selectPagesWithinBudget<T extends PageText>(
  pages: readonly T[],
  preferredOrder: readonly number[],
  charBudget: number,
  excerptChars = 300,
): T[] {
  const total = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (total <= charBudget) return [...pages];
  const byNumber = new Map(pages.map((page) => [page.pageNumber, page]));
  const full = new Set<number>();
  let used = 0;
  const excerptCost = pages.length * (excerptChars + 40);
  const fullBudget = Math.max(0, charBudget - excerptCost);
  for (const pageNumber of preferredOrder) {
    const page = byNumber.get(pageNumber);
    if (!page || full.has(pageNumber)) continue;
    if (used + page.text.length > fullBudget) continue;
    full.add(pageNumber);
    used += page.text.length;
  }
  return pages.map((page) =>
    full.has(page.pageNumber) || page.text.length <= excerptChars
      ? page
      : { ...page, text: `${page.text.slice(0, excerptChars).trimEnd()} [excerpt]` },
  );
}
