import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBinary = require.resolve('next/dist/bin/next');

// Kimi Work and other preview runners commonly use Vite-style --host arguments.
// Next.js calls the same option --hostname, so translate it without changing other CLI arguments.
const args = process.argv.slice(2).map((arg) => {
  if (arg === '--host') return '--hostname';
  if (arg.startsWith('--host=')) return `--hostname=${arg.slice('--host='.length)}`;
  return arg;
});

const child = spawn(process.execPath, [nextBinary, 'dev', ...args], { stdio: 'inherit' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}

child.on('error', (error) => {
  console.error(`Unable to start the Next.js development server: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  process.exitCode = signal ? 1 : code ?? 1;
});
