// Own a disposable database and local API/Vite processes for CPU recovery tests.
// No development .env database, production service, or manifest is modified.
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  openSync,
  closeSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(frontend, '../backend');
const [bundleArgument, outputArgument, ...testArguments] = process.argv.slice(2);
if (!outputArgument)
  throw Error(
    'Usage: node scripts/test-cpu-integration.mjs BUNDLE OUTPUT [--human-review | Playwright arguments]',
  );
const humanReview = testArguments.includes('--human-review');
if (humanReview && (testArguments.length !== 1 || testArguments[0] !== '--human-review'))
  throw Error('--human-review cannot be combined with Playwright arguments');
const bundle = resolve(bundleArgument);
const output = resolve(outputArgument);
if (
  humanReview &&
  ['review-session.json', 'human-review.template.json', 'human-review.json'].some((name) =>
    existsSync(resolve(output, name)),
  )
)
  throw Error('Use a new output directory for each human review session');
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(resolve(tmpdir(), 'retruco-cpu-e2e-'));
const suffix = randomUUID().slice(0, 8);
const assetDirectory = resolve(frontend, 'static/cpu-evaluation', suffix);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const candidateAssets = new Map(
  ['manifest.json', 'policy.bin', 'policy.wasm'].map((name) => [
    name,
    readFileSync(resolve(bundle, name)),
  ]),
);
const manifest = JSON.parse(candidateAssets.get('manifest.json').toString('utf8'));
for (const [file, expected] of [
  ['policy.bin', manifest.sha256],
  ['policy.wasm', manifest.wasm_sha256],
]) {
  if (sha(candidateAssets.get(file)) !== expected) throw Error(`Invalid candidate ${file}`);
}
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const source = {
  backend_commit: git(backend, 'rev-parse', 'HEAD'),
  frontend_commit: git(frontend, 'rev-parse', 'HEAD'),
  source_dirty: Boolean(
    git(backend, 'status', '--porcelain') || git(frontend, 'status', '--porcelain'),
  ),
};
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abort.abort());
const children = new Set();
const delay = (ms) => new Promise((accept) => setTimeout(accept, ms));
function launch(command, args, cwd, environment, log) {
  const descriptor = openSync(log, 'a');
  const child = spawn(command, args, {
    cwd,
    env: environment,
    detached: true,
    stdio: ['ignore', descriptor, descriptor],
  });
  closeSync(descriptor);
  children.add(child);
  child.done = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => accept(code));
  });
  // A failed spawn must remain observable even while readiness is being checked.
  child.done.catch(() => {});
  return child;
}
async function stop(child) {
  if (!child || !children.has(child)) return;
  const kill = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  };
  if (child.exitCode === null && child.signalCode === null) {
    kill('SIGTERM');
    await Promise.race([child.done.catch(() => {}), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) {
      kill('SIGKILL');
      await child.done.catch(() => {});
    }
  }
  children.delete(child);
}
async function run(command, args, cwd, environment, log) {
  const child = launch(command, args, cwd, environment, log);
  const onAbort = () => {
    void stop(child);
  };
  abort.signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (abort.signal.aborted) throw Error('Integration interrupted');
    const code = await child.done;
    if (code !== 0) throw Error(`${command} exited ${code}; inspect ${log}`);
  } finally {
    abort.signal.removeEventListener('abort', onAbort);
    await stop(child);
  }
}
async function port() {
  const server = createSocketServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const value = server.address().port;
  await new Promise((accept) => server.close(accept));
  return value;
}
async function ready(url, child) {
  for (let retry = 0; retry < 120; retry++) {
    if (abort.signal.aborted) throw Error('Integration interrupted');
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error(`Local process stopped before ${url} was ready`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* startup */
    }
    await delay(250);
  }
  throw Error(`Local service did not become ready: ${url}`);
}
let container,
  api,
  vite,
  control,
  restarting = false,
  restarts = 0;
const report = {
  ...source,
  approved: false,
  checkpoint_sha256: manifest.checkpoint_sha256,
  model_sha256: manifest.sha256,
  wasm_sha256: manifest.wasm_sha256,
  soak_matches_per_mode: Number(process.env.CPU_SOAK_MATCHES ?? 2),
  checks: [],
};
async function holdForHumanReview(origin) {
  if (
    !['browser-1v1', 'browser-2v2'].every((name) =>
      report.checks.some((check) => check.name === name),
    )
  )
    throw Error('Human review requires successful learned-policy matches in both modes');
  const session = {
    ...source,
    approved: false,
    kind: 'local-human-review-session',
    checkpoint_sha256: manifest.checkpoint_sha256,
    model_sha256: manifest.sha256,
    wasm_sha256: manifest.wasm_sha256,
    manifest_sha256: sha(candidateAssets.get('manifest.json')),
    preflight_sha256: sha(readFileSync(resolve(output, 'review-preflight.json'))),
    url: origin,
    started_at: new Date().toISOString(),
    ended_at: null,
    status: 'ready',
  };
  const save = () =>
    writeFileSync(resolve(output, 'review-session.json'), JSON.stringify(session, null, 2) + '\n');
  writeFileSync(
    resolve(output, 'human-review.template.json'),
    JSON.stringify(
      {
        checkpoint_sha256: manifest.checkpoint_sha256,
        model_sha256: manifest.sha256,
        reviewer: '',
        played_modes: [],
        notes: '',
        coordination_acceptable: false,
        weaknesses_reviewed: false,
      },
      null,
      2,
    ) + '\n',
  );
  save();
  console.log(`Human review ready: ${origin}`);
  console.log(
    'Play both 1v1 and 2v2, including a CPU teammate. Review the named señas, cooperation and known weaknesses.',
  );
  console.log(
    'Record your own findings in a copy of human-review.template.json. This launcher never marks the review passed or approves the model. Ctrl+C cleans up the local services.',
  );
  let onAbort;
  try {
    await Promise.race([
      new Promise((accept) => {
        onAbort = accept;
        if (abort.signal.aborted) accept();
        else abort.signal.addEventListener('abort', onAbort, { once: true });
      }),
      ...[api, vite].map((child) =>
        child.done.then(() => {
          throw Error('A local review service stopped unexpectedly');
        }),
      ),
    ]);
    session.status = 'closed';
  } catch (error) {
    session.status = 'failed';
    session.error = String(error);
    throw error;
  } finally {
    abort.signal.removeEventListener('abort', onAbort);
    session.ended_at = new Date().toISOString();
    session.source_changed =
      git(backend, 'rev-parse', 'HEAD') !== source.backend_commit ||
      git(frontend, 'rev-parse', 'HEAD') !== source.frontend_commit ||
      Boolean(git(backend, 'status', '--porcelain') || git(frontend, 'status', '--porcelain'));
    save();
  }
}
try {
  if (
    !Number.isInteger(report.soak_matches_per_mode) ||
    report.soak_matches_per_mode < 2 ||
    report.soak_matches_per_mode > 100
  )
    throw Error('CPU_SOAK_MATCHES must be an integer in [2,100]');
  const apiOrigin = `http://127.0.0.1:${await port()}`;
  const requestedPort = humanReview ? process.env.CPU_REVIEW_PORT : undefined;
  const frontendPort = requestedPort === undefined ? await port() : Number(requestedPort);
  if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535)
    throw Error('CPU_REVIEW_PORT must identify a valid local port');
  const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
  const password = randomUUID();
  container = execFileSync(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      `retruco-cpu-${suffix}`,
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=cpu_e2e',
      '-p',
      '127.0.0.1::5432',
      'postgres:18-alpine',
    ],
    { encoding: 'utf8' },
  ).trim();
  const databasePort = execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' })
    .trim()
    .split(':')
    .at(-1);
  const environment = {
    ...process.env,
    APP_ENV: 'test',
    DATABASE_URL: `postgres://postgres:${password}@127.0.0.1:${databasePort}/cpu_e2e?sslmode=disable`,
    LISTEN_ADDR: new URL(apiOrigin).host,
    ALLOWED_ORIGINS: frontendOrigin,
    COOKIE_SECURE: 'false',
    API_PROXY_SECRET: '',
    TURNSTILE_SITE_KEY: '',
    TURNSTILE_SECRET_KEY: '',
    CLOUDFLARE_TURN_TOKEN_ID: '',
    CLOUDFLARE_TURN_API_TOKEN: '',
  };
  for (let attempt = 0; ; attempt++) {
    if (attempt >= 60 || abort.signal.aborted) throw Error('Disposable database startup failed');
    try {
      execFileSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres', '-d', 'cpu_e2e'], {
        stdio: 'ignore',
      });
      break;
    } catch {
      await delay(500);
    }
  }
  console.log('Building isolated API and migration binaries.');
  await run(
    'go',
    ['build', '-o', resolve(temporary, 'server'), './cmd/server'],
    backend,
    environment,
    resolve(output, 'build-server.log'),
  );
  await run(
    'go',
    ['build', '-o', resolve(temporary, 'migrate'), './cmd/migrate'],
    backend,
    environment,
    resolve(output, 'build-migrate.log'),
  );
  await run(
    resolve(temporary, 'migrate'),
    ['up'],
    backend,
    environment,
    resolve(output, 'migrate.log'),
  );
  const startAPI = async () => {
    api = launch(
      resolve(temporary, 'server'),
      [],
      backend,
      environment,
      resolve(output, 'server.log'),
    );
    await ready(`${apiOrigin}/api/health`, api);
  };
  await startAPI();
  const token = randomUUID();
  control = createServer(async (request, response) => {
    if (
      request.method !== 'POST' ||
      request.url !== '/restart' ||
      request.headers.authorization !== `Bearer ${token}`
    )
      return response.writeHead(404).end();
    if (restarting) return response.writeHead(409).end();
    restarting = true;
    try {
      await stop(api);
      await startAPI();
      restarts++;
      response.writeHead(200).end('restarted');
    } catch {
      response.writeHead(500).end('owned API restart failed');
    } finally {
      restarting = false;
    }
  });
  await new Promise((accept, reject) => {
    control.once('error', reject);
    control.listen(0, '127.0.0.1', accept);
  });
  mkdirSync(assetDirectory, { recursive: true });
  for (const [file, data] of candidateAssets) writeFileSync(resolve(assetDirectory, file), data);
  const frontendEnvironment = {
    ...environment,
    API_ORIGIN: apiOrigin,
    TEST_API_ORIGIN: apiOrigin,
    SITE_ORIGIN: frontendOrigin,
    CARD_ASSET_ORIGIN: '',
    GOOGLE_ANALYTICS_ID: '',
    BACKEND_ORIGIN: '',
    VITE_CPU_ML_ENABLED: 'true',
    VITE_CPU_EVALUATION: 'true',
    VITE_CPU_MODEL_MANIFEST: `/cpu-evaluation/${suffix}/manifest.json`,
    PLAYWRIGHT_BASE_URL: frontendOrigin,
    CPU_TEST_RESTART_URL: `http://127.0.0.1:${control.address().port}/restart`,
    CPU_TEST_RESTART_TOKEN: token,
    CPU_SOAK_MATCHES: String(report.soak_matches_per_mode),
  };
  vite = launch(
    'pnpm',
    ['dev', '--port', new URL(frontendOrigin).port, '--strictPort'],
    frontend,
    frontendEnvironment,
    resolve(output, 'vite.log'),
  );
  await ready(frontendOrigin, vite);
  console.log('Running CPU browser integration against the disposable database.');
  const jsonPath = resolve(output, 'playwright.json');
  rmSync(jsonPath, { force: true });
  frontendEnvironment.PLAYWRIGHT_JSON_OUTPUT_NAME = jsonPath;
  const command = [
    'exec',
    'playwright',
    'test',
    'tests/cpu.spec.ts',
    '--project=desktop',
    '--reporter=line,json',
    `--output=${resolve(output, 'test-results')}`,
    ...(humanReview
      ? ['--grep', 'seats can finish a match with browser CPU players']
      : testArguments),
  ];
  const log = resolve(output, 'playwright.log');
  try {
    await run('pnpm', command, frontend, frontendEnvironment, log);
    report.exit_code = 0;
  } catch (error) {
    report.exit_code = 1;
    report.error = String(error);
  }
  report.command = ['pnpm', ...command];
  report.evidence_path = existsSync(jsonPath) ? 'playwright.json' : 'playwright.log';
  report.evidence_sha256 = sha(readFileSync(resolve(output, report.evidence_path)));
  report.server_restarts = restarts;
  if (report.exit_code === 0) {
    const results = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const passed = new Set();
    function visit(suite) {
      for (const spec of suite.specs ?? []) {
        if (
          spec.tests.length &&
          spec.tests.every(
            (t) =>
              t.status === 'expected' && t.results.length === 1 && t.results[0].status === 'passed',
          )
        )
          passed.add(spec.title);
      }
      for (const child of suite.suites ?? []) visit(child);
    }
    for (const suite of results.suites) visit(suite);
    const groups = {
      'browser-1v1': ['2 seats can finish a match with browser CPU players'],
      'browser-2v2': ['4 seats can finish a match with browser CPU players'],
      'controller-handoff': [
        'mixed CPU room keeps human seats open and transfers one worker between players',
      ],
      'server-restore': ['learned CPU reconnects after server and browser worker restart'],
      'corrupt-artifacts': ['corrupt', 'incompatible', 'unavailable'].map(
        (kind) => `CPU continues with heuristic after ${kind} model assets`,
      ),
      [report.soak_matches_per_mode >= 10 ? 'soak' : 'soak-smoke']: [2, 4].map(
        (players) =>
          `learned CPU survives repeated ${players}-seat matches without accumulating workers`,
      ),
    };
    for (const [name, tests] of Object.entries(groups)) {
      if (!tests.every((title) => passed.has(title))) continue;
      if (name === 'server-restore' && restarts < 1)
        throw Error('Restart test did not restart the owned API');
      report.checks.push({
        name,
        tests,
        command: report.command,
        exit_code: 0,
        evidence_path: report.evidence_path,
        evidence_sha256: report.evidence_sha256,
      });
    }
    report.test_stats = results.stats;
  }
  if (
    git(backend, 'rev-parse', 'HEAD') !== source.backend_commit ||
    git(frontend, 'rev-parse', 'HEAD') !== source.frontend_commit
  )
    throw Error('Source revision changed while integration was running');
  report.source_dirty ||= Boolean(
    git(backend, 'status', '--porcelain') || git(frontend, 'status', '--porcelain'),
  );
  const reportPath = resolve(output, humanReview ? 'review-preflight.json' : 'integration.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      exit_code: report.exit_code,
      server_restarts: restarts,
      report: reportPath,
    }),
  );
  if (report.exit_code) process.exitCode = 1;
  else if (humanReview) await holdForHumanReview(frontendOrigin);
} finally {
  for (const child of [...children]) await stop(child);
  if (control) {
    control.closeAllConnections();
    await new Promise((accept) => control.close(accept));
  }
  if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' });
  rmSync(assetDirectory, { recursive: true, force: true });
  rmSync(temporary, { recursive: true, force: true });
}
