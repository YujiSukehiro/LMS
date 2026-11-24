/**
 * Write each role's guide to docs/guides/<role>-guide.md from the same data the in-app Guide page shows.
 * Run: npm run guides:export
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GUIDES } from '../src/lib/guides';
import { GUIDE_ROLES } from '../src/lib/guides/types';
import { guideFileName, guideToMarkdown } from '../src/lib/guides/markdown';

const outDir = path.join(process.cwd(), 'docs', 'guides');
mkdirSync(outDir, { recursive: true });
for (const role of GUIDE_ROLES) {
  const guide = GUIDES[role];
  const file = path.join(outDir, guideFileName(guide));
  writeFileSync(file, guideToMarkdown(guide));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
