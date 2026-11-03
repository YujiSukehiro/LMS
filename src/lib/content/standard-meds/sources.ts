import manifestJson from './source-manifest.json';
import { STANDARD_MEDS_SOURCE_CODES, type StandardMedsSourceCode } from './source-catalog';
import { StandardMedsSourceManifestSchema, type StandardMedsSourceRegistration } from './source-manifest-schema';

export const STANDARD_MEDS_SOURCE_MANIFEST = StandardMedsSourceManifestSchema.parse(manifestJson);
export const STANDARD_MEDS_SOURCES: readonly StandardMedsSourceRegistration[] = STANDARD_MEDS_SOURCE_MANIFEST.sources;

const byCode = new Map(STANDARD_MEDS_SOURCES.map((source) => [source.code, source]));

export function getStandardMedsSource(code: StandardMedsSourceCode): StandardMedsSourceRegistration {
  const source = byCode.get(code);
  if (!source) throw new Error(`Missing registered Standard Meds source ${code}.`);
  return source;
}

export function assertStandardMedsSourceInventory(): void {
  const actual = STANDARD_MEDS_SOURCES.map((source) => source.code);
  if (JSON.stringify(actual) !== JSON.stringify(STANDARD_MEDS_SOURCE_CODES)) {
    throw new Error('Standard Meds source manifest must contain SM-00 through SM-08 in catalog order.');
  }
}

assertStandardMedsSourceInventory();
