import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseScreenshotDirArg() {
  const index = process.argv.indexOf('--screenshot-dir');
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return process.env.QA_SCREENSHOT_DIR;
}

function withJavaPath(env = process.env) {
  const javaBin = '/opt/homebrew/opt/openjdk@21/bin';
  const currentPath = env.PATH ?? '';
  const pathValue = currentPath.includes(javaBin) ? currentPath : `${javaBin}:${currentPath}`;
  return {
    ...env,
    PATH: pathValue,
    XDG_CONFIG_HOME: env.XDG_CONFIG_HOME ?? '/tmp/fb-cfg',
    NEXT_FONT_GOOGLE_MOCKED_RESPONSES:
      env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES ?? path.join(ROOT, 'scripts', 'next-font-mock.cjs'),
  };
}

function runStep(label, command, args, env = withJavaPath()) {
  console.log(`\n=== ${label} ===`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${signal ?? `exit ${code}`}).`));
    });
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function buildMockJudgeJson(promptText) {
  const ids = [...new Set([...promptText.matchAll(/criterionId:\s*([A-Za-z0-9_-]+)/g)].map((m) => m[1]))];
  const criterionIds = ids.length > 0 ? ids : ['c-nc-1', 'c-nc-2', 'c-nc-3'];

  const agentTurnMatch = [...promptText.matchAll(/Turn \d+ — AGENT:\s*(.+)/g)];
  const verbatimAgentQuote = agentTurnMatch[0]?.[1]?.trim() ?? '';

  const learnerEventMatches = [...promptText.matchAll(/"id":"([^"]+)","actor":"learner","type":"utterance"/g)];
  const eventIds = learnerEventMatches[0]?.[1] ? [learnerEventMatches[0][1]] : [];

  return JSON.stringify({
    criterionResults: criterionIds.map((criterionId) => ({
      criterionId,
      score: 100,
      agentQuoteEvidence: verbatimAgentQuote,
      evidenceEventIds: eventIds,
      coachingNote: 'Followed the verbal Playbook rule clearly.',
      betterResponseExample: null,
    })),
    autoFailTriggered: false,
    autoFailedReason: null,
    summaryFeedback: 'Strong verbal call handling with compliant verification, clinical scope, and warm-transfer readiness.',
    strengthsHighlighted: ['Verified patient identity verbally', 'Maintained non-clinical scope'],
    coachingImprovements: ['Continue confirming callback numbers concisely'],
  });
}

async function startMockAiServer() {
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'GET' && (url === '/v1/models' || url === '/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mlx-community/Qwen2.5-7B-Instruct-4bit' }] }));
      return;
    }

    if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/chat/completions')) {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON request body' }));
        return;
      }

      const messages = Array.isArray(body.messages) ? body.messages : [];
      const promptText = messages.map((m) => (typeof m?.content === 'string' ? m.content : '')).join('\n');

      if (body.stream === true) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const chunks = [
          'Yes, my name is Taylor Bennett, born July 12 1984, ZIP 60611. ',
          'What should I do about this mild dizziness before my next refill?',
        ];
        for (const content of chunks) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const isPreflight = promptText.includes('Reply with exactly OK.');
      const content = isPreflight ? 'OK' : buildMockJudgeJson(promptText);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content }, finish_reason: 'stop' }],
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function waitForHttpReady(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // keep waiting until server listens
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error(`Timed out waiting for ${url} to become ready.`);
}

async function runInsideEmulators() {
  const mockAiUrl = process.env.VERIFY_MOCK_AI_URL;
  const e2ePort = process.env.VERIFY_E2E_PORT;
  if (!mockAiUrl || !e2ePort) {
    throw new Error('VERIFY_MOCK_AI_URL and VERIFY_E2E_PORT must be set inside emulator runner.');
  }

  const childEnv = withJavaPath({
    ...process.env,
    AI_PROVIDER: 'openai_compatible',
    OPENAI_COMPATIBLE_BASE_URL: mockAiUrl,
    OPENAI_COMPATIBLE_HEAVY_MODEL: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
    OPENAI_COMPATIBLE_FAST_MODEL: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
    LOCAL_RUNTIME_LABEL: 'Mock-Verbal-E2E',
    NEXT_PUBLIC_USE_FIREBASE_EMULATOR: 'true',
  });

  await runStep('Seed Firebase Emulators', 'npx', ['tsx', '--env-file=.env.local', 'scripts/seed-demo.ts'], childEnv);

  console.log(`\n=== Start Next.js production server on http://127.0.0.1:${e2ePort} ===`);
  const nextServer = spawn('npx', ['next', 'start', '-p', String(e2ePort), '-H', '127.0.0.1'], {
    cwd: ROOT,
    env: childEnv,
    stdio: 'inherit',
  });

  try {
    await waitForHttpReady(`http://127.0.0.1:${e2ePort}/login`, 45_000);
    await runStep('Run Playwright E2E Suite', 'npx', ['playwright', 'test'], {
      ...childEnv,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${e2ePort}`,
      ...(process.env.QA_SCREENSHOT_DIR ? { QA_SCREENSHOT_DIR: process.env.QA_SCREENSHOT_DIR } : {}),
    });
  } finally {
    if (!nextServer.killed) {
      nextServer.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 1_500));
      if (!nextServer.killed) nextServer.kill('SIGKILL');
    }
  }
}

async function runRealMlxPreflight(baseEnv) {
  console.log('\n=== 8/8 Real Local MLX Runtime Preflight ===');
  const mlxServerBin = path.join(ROOT, 'mlx-runtime', '.venv', 'bin', 'mlx_lm.server');
  if (!existsSync(mlxServerBin)) {
    throw new Error(`Missing MLX virtual environment binary at ${mlxServerBin}.`);
  }
  const mlxPort = await getFreePort();
  const mlxEnv = {
    ...baseEnv,
    MLX_PORT: String(mlxPort),
    MLX_MODEL: 'mlx-community/Qwen2.5-7B-Instruct-4bit',
  };
  console.log(`Starting local MLX server on http://127.0.0.1:${mlxPort}...`);
  const mlxChild = spawn('sh', ['mlx-runtime/start.sh'], {
    cwd: ROOT,
    env: mlxEnv,
    stdio: 'inherit',
  });

  try {
    await waitForHttpReady(`http://127.0.0.1:${mlxPort}/v1/models`, 60_000);
    await runStep(
      'Run MLX streaming + JSON capability preflight',
      'sh',
      ['scripts/with-mlx-env.sh', 'npm', 'run', 'verify:local-ai'],
      {
        ...baseEnv,
        OPENAI_COMPATIBLE_BASE_URL: `http://127.0.0.1:${mlxPort}`,
      },
    );
  } finally {
    await new Promise((resolve) => {
      const killer = spawn('sh', ['mlx-runtime/stop.sh'], {
        cwd: ROOT,
        env: mlxEnv,
        stdio: 'ignore',
      });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
    if (!mlxChild.killed) {
      mlxChild.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 1_500));
      if (!mlxChild.killed) mlxChild.kill('SIGKILL');
    }
  }
}

async function main() {
  if (process.argv.includes('--inside-emulators')) {
    await runInsideEmulators();
    return;
  }

  const offlineOnly = process.argv.includes('--offline');
  const screenshotDir = parseScreenshotDirArg();
  const baseEnv = withJavaPath({
    ...process.env,
    ...(screenshotDir ? { QA_SCREENSHOT_DIR: screenshotDir } : {}),
  });
  await runStep('1/8 Typecheck', 'npm', ['run', 'typecheck'], baseEnv);
  await runStep('2/8 Lint', 'npm', ['run', 'lint'], baseEnv);
  await runStep('3/8 Unit & Route Integration Tests', 'npm', ['run', 'test:unit'], baseEnv);
  await runStep('4/8 Seed Dry-Run & Publication Gates', 'npx', ['tsx', 'scripts/seed-demo.ts', '--dry-run'], baseEnv);
  await runStep('4b/8 Production Seed Dry-Run', 'npm', ['run', 'seed:prod:dry'], baseEnv);
  await runStep('5/8 Production Build', 'npm', ['run', 'build'], baseEnv);

  if (offlineOnly) {
    console.log(
      "\nOffline/sandbox verification complete (Stages 1-5 passed). Run 'npm run verify:usable' in a normal terminal to also execute Stages 6-8 (Firestore Rules + Chrome E2E + Local MLX).",
    );
    return;
  }

  await runStep('6/8 Firestore Security Rules Tests', 'npm', ['run', 'test:rules'], baseEnv);

  const { server, baseUrl: mockAiUrl } = await startMockAiServer();
  const e2ePort = await getFreePort();
  console.log(`\nStarted deterministic OpenAI-compatible mock server on ${mockAiUrl}`);

  try {
    const e2eEnv = {
      ...baseEnv,
      VERIFY_MOCK_AI_URL: mockAiUrl,
      VERIFY_E2E_PORT: String(e2ePort),
    };
    await runStep(
      '7/8 Emulators + Seed + Playwright Usable-Product E2E',
      'npx',
      [
        'firebase',
        'emulators:exec',
        '--project',
        'logicall-pulse-dev',
        '--only',
        'auth,firestore,storage',
        'node scripts/verify-usable-product.mjs --inside-emulators',
      ],
      e2eEnv,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  await runRealMlxPreflight(baseEnv);

  console.log('\nALL 8 USABLE-PRODUCT VERIFICATION GATES PASSED.');
}

main().catch((error) => {
  console.error('\nVerification loop failed:', error);
  process.exit(1);
});
