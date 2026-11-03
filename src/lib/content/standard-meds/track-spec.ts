import type { TrackUnit } from '@/lib/schemas/curriculum';
import type { StandardMedsSourceCode } from './source-catalog';
import type { StandardMedsSmeDecisionId } from './publication';
import type { StandardMedsCallCode, SyntheticStandardMedsLink } from './types';

export interface StandardMedsTrackSpec {
  code: StandardMedsCallCode;
  title: string;
  scenarioPrefix: 'NC' | 'LR' | 'ED' | 'ZR' | 'NAD' | 'CS' | 'MC' | 'RN';
  inheritedSourceCodes: StandardMedsSourceCode[];
  units: TrackUnit[];
  sharedPages: number[];
  sharedMedicalExample: string;
  sharedLinkExample: string;
  simulationBehavior: string;
  syntheticLinks: SyntheticStandardMedsLink[];
  openSmeDecisionIds: StandardMedsSmeDecisionId[];
}
