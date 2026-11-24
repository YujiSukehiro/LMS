import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // tsconfig keeps `jsx: preserve` for Next.js; tests that render a component need it compiled.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // tests/integration and tests/rules need the Firestore emulator: run them with `npm run test:rules`.
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts', 'tests/rules/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
