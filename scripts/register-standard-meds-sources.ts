import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerStandardMedsSources } from '@/lib/content/standard-meds/register-sources';

/** Rebuild the checked-in, text-free registration manifest from the supplied local PDFs. */
async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const manifest = await registerStandardMedsSources({ workspaceRoot });
  const outputPath = path.join(workspaceRoot, 'src/lib/content/standard-meds/source-manifest.json');
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const pageCount = manifest.sources.reduce((total, source) => total + source.pageCount, 0);
  console.log(`Registered ${manifest.sources.length} local Standard Meds PDFs across ${pageCount} pages; raw text omitted.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown local PDF registration error.';
  console.error(`Standard Meds source registration failed: ${message}`);
  process.exitCode = 1;
});
