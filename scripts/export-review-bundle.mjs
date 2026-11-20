/**
 * Export the tracked source into a few plain-text files for an outside LLM review.
 *
 *   node scripts/export-review-bundle.mjs            # writes _gemini_review/ (gitignored, not deployed)
 *   node scripts/export-review-bundle.mjs --no-checks
 *
 * Only git-tracked text files are included, so .env.local, node_modules, build output and binaries never leak.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_gemini_review');
const RULE = '='.repeat(80);
const TEXT_EXT = /\.(ts|tsx|mts|mjs|cjs|js|json|md|rules|yaml|yml|sh|css|example|txt)$/i;
const ROOT_CONFIG = [
  'package.json',
  'tsconfig.json',
  'next.config.ts',
  'firebase.json',
  '.firebaserc',
  'firestore.rules',
  'firestore.indexes.json',
  'storage.rules',
  'apphosting.yaml',
  '.env.example',
  'README.md',
];

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((file) => TEXT_EXT.test(file) || ROOT_CONFIG.includes(file));

const pick = (test) => tracked.filter(test);
const groups = [
  {
    file: '01_docs_and_config.txt',
    files: [
      ...ROOT_CONFIG.filter((file) => tracked.includes(file)),
      ...pick((f) => f.startsWith('docs/') && f.endsWith('.md')),
      ...pick((f) => f.startsWith('mlx-runtime/')),
    ],
  },
  {
    file: '02_backend_lib_and_scripts.txt',
    files: [...pick((f) => f.startsWith('src/lib/')), ...pick((f) => f === 'src/middleware.ts'), ...pick((f) => f.startsWith('scripts/'))],
  },
  { file: '03_app_and_components.txt', files: pick((f) => f.startsWith('src/app/') || f.startsWith('src/components/')) },
  {
    file: '04_tests.txt',
    files: [...pick((f) => f.startsWith('tests/')), ...pick((f) => f === 'playwright.config.ts' || f === 'vitest.config.ts')],
  },
];

function block(file) {
  return `\n${RULE}\nFILE: ${file}\n${RULE}\n${readFileSync(path.join(ROOT, file), 'utf8')}`;
}

function run(label, cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return `=== ${label} ===\n${output}\n${result.status === 0 ? '' : `(exit ${result.status})\n`}\n`;
}

mkdirSync(OUT, { recursive: true });

let diagnostics = run('GIT STATUS & RECENT COMMITS', 'sh', ['-c', 'git status && git log --oneline -10']);
if (!process.argv.includes('--no-checks')) {
  diagnostics += run('TYPECHECK (tsc)', 'npx', ['tsc', '--noEmit']);
  diagnostics += run('LINT', 'npm', ['run', 'lint']);
  diagnostics += run('UNIT TESTS', 'npm', ['run', 'test:unit']);
}
writeFileSync(path.join(OUT, '00_diagnostics.txt'), diagnostics);

const seen = new Set();
for (const group of groups) {
  const files = [...new Set(group.files)].filter((file) => !seen.has(file));
  files.forEach((file) => seen.add(file));
  writeFileSync(path.join(OUT, group.file), files.map(block).join('\n'));
  console.log(`${group.file}: ${files.length} files`);
}
console.log(`Wrote ${path.relative(ROOT, OUT)}/ (00_diagnostics.txt + ${groups.length} source files).`);
