import type { EvalRubricsDoc, TrackUnit, TrackVersionDoc } from '@/lib/schemas/curriculum';
import type { StandardMedsSourceCode } from './source-catalog';
import type { StandardMedsSourceRegistration } from './source-manifest-schema';
import type { StandardMedsPublicationBlocker, StandardMedsSmeDecisionId } from './publication';

export type StandardMedsCallCode = Exclude<StandardMedsSourceCode, 'SM-00'>;

export interface SyntheticStandardMedsLink {
  id: string;
  label: string;
  url: `https://synthetic.invalid/${string}`;
  sourcePages: number[];
  personalized: boolean;
  permittedAction: 'display' | 'fake_sms' | 'fake_portal_open';
  synthetic: true;
  approvalStatus: 'draft';
}

export interface StandardMedsPublicationState {
  eligible: false;
  approvalStatus: 'draft';
  blockers: StandardMedsPublicationBlocker[];
}

export interface StandardMedsCallPack {
  kind: 'call_training';
  code: StandardMedsCallCode;
  title: string;
  source: StandardMedsSourceRegistration;
  inheritedSourceCodes: StandardMedsSourceCode[];
  version: TrackVersionDoc;
  evalRubrics: EvalRubricsDoc;
  syntheticLinks: SyntheticStandardMedsLink[];
  openSmeDecisionIds: StandardMedsSmeDecisionId[];
  publication: StandardMedsPublicationState;
}

export interface StandardMedsOrientationPack {
  kind: 'orientation';
  code: 'SM-00';
  title: string;
  source: StandardMedsSourceRegistration;
  units: TrackUnit[];
  sourceRegistry: readonly StandardMedsSourceRegistration[];
  syntheticLinks: [];
  openSmeDecisionIds: StandardMedsSmeDecisionId[];
  publication: StandardMedsPublicationState;
}
