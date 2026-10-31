// Local-only candidate evaluation. Never changes approval or publishes assets.
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const [bundleArgument, casesArgument, outputArgument, samplesArgument] = process.argv.slice(2);
if (!bundleArgument || !casesArgument || !outputArgument)
  throw new Error(
    'Usage: node scripts/benchmark-cpu.mjs BUNDLE CASES_JSON REPORT_JSON [samples-per-case=200]',
  );
const bundle = resolve(bundleArgument);
const output = resolve(outputArgument);
const samples = Number(samplesArgument ?? 200);
if (!Number.isInteger(samples) || samples < 20)
  throw new Error('At least 20 samples per case required');
const manifest = JSON.parse(readFileSync(resolve(bundle, 'manifest.json'), 'utf8'));
const caseData = readFileSync(resolve(casesArgument));
const cases = JSON.parse(caseData);
if (
  cases.format !== 2 ||
  cases.encoder !== manifest.encoder ||
  cases.action_encoder !== manifest.action_encoder ||
  cases.cases.some(
    (c) =>
      !c.view ||
      !Number.isInteger(c.seat) ||
      (!c.signal && c.view.legal.length !== c.actions.length),
  ) ||
  !cases.cases.some((c) => c.signal) ||
  !cases.cases.some((c) => c.history?.signals === 20 && c.history?.cantos >= 16) ||
  !cases.cases.some((c) => !c.signal && c.actions.length === 1024)
) {
  throw new Error(
    'Cases must include complete requests, matching encoders, signaling, full histories and 1024 candidates',
  );
}
const productionGuard = JSON.parse(
  execFileSync(process.execPath, ['scripts/check-cpu-production.mjs'], { encoding: 'utf8' }),
);
const productionWorker = readFileSync(
  resolve('.svelte-kit/output/client/_app/immutable/workers', productionGuard.worker),
);

const moduleSources = new Map();
const modules = new Map();
const evaluationEnvironment = {
  DEV: true,
  VITE_CPU_EVALUATION: 'true',
  VITE_CPU_ML_ENABLED: 'true',
  VITE_CPU_MODEL_MANIFEST: '/manifest.json',
};
for (const name of ['model', 'fallback', 'decision', 'load-policy', 'worker']) {
  const source = readFileSync(new URL(`../src/lib/cpu/${name}.ts`, import.meta.url), 'utf8');
  moduleSources.set(name, source);
  // Match the documented local-development evaluation configuration. This
  // substitution changes build constants only; the actual worker body runs.
  const configured =
    name === 'worker'
      ? source.replaceAll('import.meta.env', `(${JSON.stringify(evaluationEnvironment)})`)
      : source;
  modules.set(
    name,
    ts.transpileModule(configured, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText,
  );
}
function requestFor(input) {
  return {
    version: 2,
    kind: input.signal ? 'signal' : 'game',
    token: '0'.repeat(64),
    seat: input.seat,
    view: input.view,
    entropy: input.entropy ?? 0,
    features: { version: cases.encoder, state: input.features, actions: input.actions },
  };
}
const calibrationCode = `function calibrate() {
  let value=73; const start=performance.now();
  for(let i=0;i<2000000;i++) value=(Math.imul(value^i,1664525)+1013904223)|0;
  return {ms:performance.now()-start,value};
}`;
const helpers = `
import { DecisionSession } from '/decision.js';
import { loadPolicy } from '/load-policy.js';
const cases={encoder:${cases.encoder}};
export ${requestFor.toString()}
export async function load() {
  const started = performance.now();
  const policy = await loadPolicy(true,'/manifest.json','evaluation');
  if(!policy) throw Error('Offline candidate did not load');
  return { policy, session: new DecisionSession(policy), initMs: performance.now()-started };
}
export ${calibrationCode}
export function validate(request,result) {
  if(result.error || result.version!==2 || result.kind!==request.kind || result.token!==request.token || result.seat!==request.seat || result.revision!==request.view.revision) throw Error('Invalid worker response');
  if(request.kind==='signal') {
    if(!['none','perico','perica','seven_spades','seven_coins','receta'].includes(result.signal)) throw Error('Invalid signal');
  } else if(!request.view.legal.some(c=>JSON.stringify(c)===JSON.stringify(result.command))) throw Error('Illegal command');
}
export async function run(loaded,input) {
  const request=requestFor(input);
  const start=performance.now();
  await Promise.resolve();
  const result=loaded.session.decide(request);
  const ms=performance.now()-start;
  if(loaded.session.source!=='learned') throw Error('Benchmark silently fell back');
  validate(request,result);
  return {result,ms,memoryBytes:loaded.policy.memoryBytes};
}`;
const workerCode = `
${calibrationCode}
globalThis.calibrate=calibrate;
const starts=new Map();let lastID, memory, initialMemory;
const started=performance.now();
const instantiate=WebAssembly.instantiate.bind(WebAssembly);
WebAssembly.instantiate=async(...args)=>{
  const result=await instantiate(...args);memory=(result.instance??result).exports.memory;return result;
};
self.addEventListener('message',({data})=>{lastID=data.id;starts.set(data.id,performance.now())});
const post=self.postMessage.bind(self);
self.postMessage=(message,...args)=>{
  if(message.type==='ready') {
    initialMemory=memory?.buffer.byteLength??0;
    return post({...message,initMs:performance.now()-started,memoryBytes:initialMemory,includesNetwork:true},...args);
  }
  const id=message.id??lastID;
  const ms=performance.now()-starts.get(id);starts.delete(id);
  const failed=message.type==='error' || message.source!=='learned' || memory?.buffer.byteLength!==initialMemory;
  return post({...message,id,ms,memoryBytes:memory?.buffer.byteLength??0,error:failed?(message.error??'Worker fallback or memory growth'):undefined},...args);
};
await import('/actual-worker.js');
`;
const pageCode = `
import {load,run,calibrate,requestFor,validate} from '/helpers.js';
window.calibrate=calibrate;
window.inputs=(await fetch('/cases.json').then(r=>r.json())).cases;
const loaded=await load();window.pageInitMs=loaded.initMs;
window.runPage=input=>run(loaded,input);
let next=0;const pending=new Map();
window.workerReady=new Promise((resolve,reject)=>{
 const worker=new Worker('/worker.js',{type:'module'});
 worker.onerror=event=>reject(new Error(event.message));
 worker.onmessage=({data})=>{if(data.type==='ready'){window.workerInit=data;resolve();return}const task=pending.get(data.id);pending.delete(data.id);if(data.error)task.reject(new Error(data.error));else {try{validate(task.request,data.result);task.resolve(data)}catch(error){task.reject(error)}}};
 window.ask=input=>new Promise((resolve,reject)=>{const id=++next;const request=requestFor(input);pending.set(id,{resolve,reject,request});worker.postMessage({id,request})});
});
window.booted=true;
`;
const assets = new Map([
  [
    '/',
    [
      'text/html',
      '<!doctype html><meta charset="utf-8"><script type="module" src="/page.js"></script>',
    ],
  ],
  ['/page.js', ['text/javascript', pageCode]],
  ['/worker.js', ['text/javascript', workerCode]],
  ['/helpers.js', ['text/javascript', helpers]],
  ['/manifest.json', ['application/json', JSON.stringify(manifest)]],
  ['/cases.json', ['application/json', caseData]],
  ['/policy.wasm', ['application/wasm', readFileSync(resolve(bundle, 'policy.wasm'))]],
  ['/policy.bin', ['application/octet-stream', readFileSync(resolve(bundle, 'policy.bin'))]],
]);
for (const [name, code] of modules)
  assets.set(name === 'worker' ? '/actual-worker.js' : `/${name}.js`, ['text/javascript', code]);
const coldInput = cases.cases.find((c) => !c.signal && c.actions.length === 1024);
assets.set('/cold-input.json', ['application/json', JSON.stringify(coldInput)]);
assets.set('/cold-request.json', ['application/json', JSON.stringify(requestFor(coldInput))]);
assets.set('/cold-page', [
  'text/html',
  `<!doctype html><script type="module">
const input=await fetch('/cold-input.json').then(r=>r.json());
const start=performance.now();
const {load,run,calibrate}=await import('/helpers.js');
const loaded=await load();const readyMs=performance.now()-start;
await run(loaded,input);
window.coldResult={totalMs:performance.now()-start,readyMs,memoryBytes:loaded.policy.memoryBytes};
window.calibrate=calibrate;
</script>`,
]);
assets.set('/cold-worker', [
  'text/html',
  `<!doctype html><script type="module">
const request=await fetch('/cold-request.json').then(r=>r.json());
const start=performance.now();const worker=new Worker('/worker.js',{type:'module'});let readyMs;
worker.onerror=e=>{window.coldResult={error:e.message}};
worker.onmessage=({data})=>{
 if(data.error){window.coldResult={error:data.error};return}
 if(data.type==='ready'){readyMs=performance.now()-start;worker.postMessage({id:1,request});return}
 if(data.source!=='learned'){window.coldResult={error:'Cold probe fell back'};return}
 window.coldResult={totalMs:performance.now()-start,readyMs,memoryBytes:data.memoryBytes};
};
</script>`,
]);
const server = createServer((request, response) => {
  const asset = assets.get(new URL(request.url, 'http://localhost').pathname);
  if (!asset) {
    response.writeHead(404);
    response.end();
    return;
  }
  const compressed = gzipSync(Buffer.from(asset[1]));
  response.writeHead(200, {
    'Content-Type': asset[0],
    'Cache-Control': 'no-store',
    'Content-Encoding': 'gzip',
  });
  response.end(compressed);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function attachWorker(browser, worker) {
  const session = await browser.newBrowserCDPSession();
  const { targetInfos } = await session.send('Target.getTargets');
  const target = targetInfos.find((t) => t.type === 'worker' && t.url === worker.url());
  if (!target) throw new Error('Worker target missing');
  const { sessionId } = await session.send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: false,
  });
  let sequence = 0;
  return {
    async send(method, params = {}) {
      const id = ++sequence;
      let listener, timer;
      const answer = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Worker CDP timeout')), 10000);
        listener = (event) => {
          if (event.sessionId !== sessionId) return;
          const message = JSON.parse(event.message);
          if (message.id !== id) return;
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        };
        session.on('Target.receivedMessageFromTarget', listener);
      });
      try {
        await session.send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        });
        return await answer;
      } finally {
        clearTimeout(timer);
        session.off('Target.receivedMessageFromTarget', listener);
      }
    },
    async close() {
      await session.detach();
    },
  };
}

function summarize(values) {
  values.sort((a, b) => a - b);
  const q = (p) => values[Math.min(values.length - 1, Math.floor(values.length * p))];
  return {
    samples: values.length,
    medianMs: q(0.5),
    p95Ms: q(0.95),
    p99Ms: q(0.99),
    maxMs: values.at(-1),
  };
}
async function coldInitialization(rate) {
  const result = {};
  for (const target of ['page', 'worker']) {
    // Fresh browser processes avoid a compiled-WASM cache shared with the warm
    // benchmark. Fast loopback traffic stays in elapsed time: this is a
    // conservative upper bound on initialization with network time excluded.
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.goto(`${origin}/cold-${target}`);
      await page.waitForFunction(() => window.coldResult);
      const value = await page.evaluate(() => window.coldResult);
      if (value.error || !value.memoryBytes)
        throw Error(value.error ?? 'Cold probe did not load WASM');
      result[target] = value;
      if (target === 'page') {
        const calibration = await page.evaluate(() => {
          for (let i = 0; i < 5; i++) window.calibrate();
          return Array.from({ length: 5 }, () => window.calibrate().ms);
        });
        result.pageCalibrationMs = summarize(calibration).medianMs;
      }
    } finally {
      await browser.close();
    }
  }
  return result;
}
const report = {
  approved: false,
  measurementVersion: 2,
  decisionPath: 'actual-worker-and-decision-session',
  harnessSha256: createHash('sha256')
    .update(readFileSync(new URL(import.meta.url)))
    .digest('hex'),
  productionGuard,
  artifactApproved: manifest.approved,
  modelSha256: manifest.sha256,
  wasmSha256: manifest.wasm_sha256,
  sourceSha256: Object.fromEntries(
    [...moduleSources].map(([name, code]) => [
      name,
      createHash('sha256').update(code).digest('hex'),
    ]),
  ),
  workerBuildConstants: evaluationEnvironment,
  casesSha256: createHash('sha256').update(caseData).digest('hex'),
  host: { platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model },
  profiles: [],
  note: 'Actual worker requests include the heuristic precheck and message handling. When worker throttling is unavailable, estimatedComplete combines calibrated page DecisionSession time with measured worker round-trip overhead. This is emulation, not a physical-phone measurement.',
  coldScope:
    'Fresh processes; complete initialization and first 1024-candidate decision, including fast loopback network as a conservative upper bound. The page DecisionSession supplies the calibrated slow target when worker throttling is unavailable.',
  networkPreset: { latencyMs: 150, downloadBytesPerSecond: 200000, uploadBytesPerSecond: 75000 },
  assets: {
    model: manifest.bytes,
    wasm: manifest.wasm_bytes,
    gzipModel: gzipSync(assets.get('/policy.bin')[1]).length,
    gzipWasm: gzipSync(assets.get('/policy.wasm')[1]).length,
    gzipWorker: gzipSync(productionWorker).length,
    gzipManifest: gzipSync(readFileSync(resolve(bundle, 'manifest.json'))).length,
  },
};
let baselineWorker, baselinePage, baselineCold;
try {
  for (const rate of [1, 6, 10]) {
    const browser = await chromium.launch();
    let attached;
    try {
      const page = await browser.newPage({
        viewport: { width: 360, height: 640 },
        deviceScaleFactor: 1,
      });
      const pageCDP = await page.context().newCDPSession(page);
      await pageCDP.send('Emulation.setCPUThrottlingRate', { rate });
      await pageCDP.send('Network.enable');
      await pageCDP.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: 200000,
        uploadThroughput: 75000,
      });
      const workerPromise = page.waitForEvent('worker');
      await page.goto(origin);
      await page.waitForFunction(() => window.booted);
      await page.evaluate(() => window.workerReady);
      const worker = await workerPromise;
      attached = await attachWorker(browser, worker);
      let workerThrottleError;
      try {
        await attached.send('Emulation.setCPUThrottlingRate', { rate });
      } catch (error) {
        workerThrottleError = error.message;
      }
      const calibration = await worker.evaluate(() => {
        for (let i = 0; i < 5; i++) globalThis.calibrate();
        return Array.from({ length: 5 }, () => globalThis.calibrate().ms);
      });
      const pageCalibration = await page.evaluate(() => {
        for (let i = 0; i < 5; i++) window.calibrate();
        return Array.from({ length: 5 }, () => window.calibrate().ms);
      });
      const workerMedian = summarize(calibration).medianMs,
        pageMedian = summarize(pageCalibration).medianMs;
      if (rate === 1) {
        baselineWorker = workerMedian;
        baselinePage = pageMedian;
      }
      const verified =
        rate === 1 || (!workerThrottleError && workerMedian / baselineWorker >= rate * 0.55);
      const pageVerified = rate === 1 || pageMedian / baselinePage >= rate * 0.55;
      const profiles = await page.evaluate(
        async ({ samples }) => {
          const records = [];
          for (const input of window.inputs) {
            for (let i = 0; i < 25; i++) await window.ask({ ...input, entropy: i });
            const worker = [],
              roundTrip = [],
              page = [],
              workerResults = [];
            for (let i = 0; i < samples; i++) {
              const start = performance.now();
              const result = await window.ask({
                ...input,
                entropy: Math.imul(i + 1, 2654435761) >>> 0,
              });
              worker.push(result.ms);
              workerResults.push(result.result);
              roundTrip.push(performance.now() - start);
            }
            for (let i = 0; i < 25; i++) await window.runPage({ ...input, entropy: i });
            for (let i = 0; i < samples; i++) {
              const result = await window.runPage({
                ...input,
                entropy: Math.imul(i + 1, 2654435761) >>> 0,
              });
              if (JSON.stringify(result.result) !== JSON.stringify(workerResults[i]))
                throw Error('Worker/page decision mismatch');
              page.push(result.ms);
            }
            const overhead = roundTrip.map((duration, i) => Math.max(0, duration - worker[i]));
            records.push({
              name: input.name,
              synthetic: input.synthetic,
              actions: input.actions.length,
              history: input.history,
              worker,
              roundTrip,
              page,
              overhead,
              estimatedComplete: page.map((duration, i) => duration + overhead[i]),
            });
          }
          return records;
        },
        { samples, rate },
      );
      await attached.send('HeapProfiler.collectGarbage');
      const memory = await attached.send('Runtime.getHeapUsage');
      const startup = await page.evaluate(() => ({
        worker: window.workerInit,
        pageMs: window.pageInitMs,
      }));
      const cold = await coldInitialization(rate);
      if (rate === 1) baselineCold = cold.pageCalibrationMs;
      cold.pageCalibrationRatio = cold.pageCalibrationMs / baselineCold;
      cold.pageThrottleVerified = rate === 1 || cold.pageCalibrationRatio >= rate * 0.55;
      const profile = {
        rate,
        browser: browser.version(),
        workerThrottleError,
        workerThrottleVerified: verified,
        pageThrottleVerified: pageVerified,
        workerCalibrationRatio: workerMedian / baselineWorker,
        pageCalibrationRatio: pageMedian / baselinePage,
        startup,
        cold,
        memory,
        cases: profiles.map((item) => ({
          ...item,
          worker: summarize(item.worker),
          roundTrip: summarize(item.roundTrip),
          page: summarize(item.page),
          overhead: summarize(item.overhead),
          estimatedComplete: summarize(item.estimatedComplete),
        })),
      };
      report.profiles.push(profile);
      console.log(
        JSON.stringify({
          rate,
          workerThrottleVerified: verified,
          pageThrottleVerified: pageVerified,
          cases: profile.cases.map((c) => ({
            name: c.name,
            p95Ms: (verified ? c.roundTrip : c.estimatedComplete).p95Ms,
          })),
        }),
      );
    } finally {
      if (attached) await attached.close();
      await browser.close();
    }
  }
  report.assets.totalGzipBytes =
    report.assets.gzipModel +
    report.assets.gzipWasm +
    report.assets.gzipWorker +
    report.assets.gzipManifest;
  const slow = report.profiles.at(-1);
  report.performancePass =
    (slow.workerThrottleVerified || slow.pageThrottleVerified) &&
    slow.cases.every((c) => {
      const value = slow.workerThrottleVerified ? c.roundTrip : c.estimatedComplete;
      return value.p95Ms <= 20 && value.p99Ms <= 50;
    }) &&
    slow.startup.worker.memoryBytes <= 4 * 1024 * 1024 &&
    slow.cold.pageThrottleVerified &&
    slow.cold.page.totalMs <= 500 &&
    slow.cold.worker.totalMs <= 500 &&
    report.assets.totalGzipBytes <= 256 * 1024;
  report.timingScope = slow.workerThrottleVerified
    ? 'throttled-worker'
    : 'calibrated-page-decision-session-plus-measured-worker-overhead';
  if (!report.performancePass) process.exitCode = 2;
} finally {
  server.close();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
