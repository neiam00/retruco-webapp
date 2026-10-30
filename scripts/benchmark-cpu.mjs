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
  cases.encoder !== manifest.encoder ||
  !cases.cases.some((c) => c.signal) ||
  !cases.cases.some((c) => !c.signal && c.actions.length === 1024)
) {
  throw new Error(
    'Cases must match the encoder and include signaling and the 1024-candidate capacity case',
  );
}
const productionGuard = JSON.parse(
  execFileSync(process.execPath, ['scripts/check-cpu-production.mjs'], { encoding: 'utf8' }),
);
const productionWorker = readFileSync(
  resolve('.svelte-kit/output/client/_app/immutable/workers', productionGuard.worker),
);

const source = readFileSync(new URL('../src/lib/cpu/model.ts', import.meta.url), 'utf8');
const moduleCode = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const helpers = `
import { LocalPolicy } from '/model.js';
export async function load() {
  const [wasm, model, manifest] = await Promise.all([fetch('/policy.wasm').then(r=>r.arrayBuffer()),fetch('/policy.bin').then(r=>r.arrayBuffer()),fetch('/manifest.json').then(r=>r.json())]);
  const started = performance.now();
  const policy = await LocalPolicy.load(wasm, new Uint8Array(model), manifest, 'evaluation');
  return { policy, initMs: performance.now()-started };
}
export function calibrate() {
  let value=73; const start=performance.now();
  for(let i=0;i<2000000;i++) value=(Math.imul(value^i,1664525)+1013904223)|0;
  return {ms:performance.now()-start,value};
}
export function run(policy,input) {
  const start=performance.now();
  const index=policy.decide(input.features,input.actions,input.signal,input.entropy);
  return {index,ms:performance.now()-start,memoryBytes:policy.memoryBytes};
}`;
const workerCode = `
import {load,run,calibrate} from '/helpers.js';
const loaded=await load();
globalThis.calibrate=calibrate;
self.postMessage({type:'ready',initMs:loaded.initMs,memoryBytes:loaded.policy.memoryBytes});
self.onmessage=({data})=>{try{self.postMessage({id:data.id,...run(loaded.policy,data)})}catch(error){self.postMessage({id:data.id,error:String(error)})}};
`;
const pageCode = `
import {load,run,calibrate} from '/helpers.js';
window.calibrate=calibrate;
window.inputs=(await fetch('/cases.json').then(r=>r.json())).cases;
const loaded=await load();window.pageInitMs=loaded.initMs;
window.runPage=input=>run(loaded.policy,input);
let next=0;const pending=new Map();
window.workerReady=new Promise((resolve,reject)=>{
 const worker=new Worker('/worker.js',{type:'module'});
 worker.onerror=event=>reject(new Error(event.message));
 worker.onmessage=({data})=>{if(data.type==='ready'){window.workerInit=data;resolve();return}const task=pending.get(data.id);pending.delete(data.id);if(data.error)task.reject(new Error(data.error));else task.resolve(data)};
 window.ask=input=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});worker.postMessage({...input,id})});
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
  ['/model.js', ['text/javascript', moduleCode]],
  ['/helpers.js', ['text/javascript', helpers]],
  ['/manifest.json', ['application/json', JSON.stringify(manifest)]],
  ['/cases.json', ['application/json', caseData]],
  ['/policy.wasm', ['application/wasm', readFileSync(resolve(bundle, 'policy.wasm'))]],
  ['/policy.bin', ['application/octet-stream', readFileSync(resolve(bundle, 'policy.bin'))]],
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
const report = {
  approved: false,
  harnessSha256: createHash('sha256')
    .update(readFileSync(new URL(import.meta.url)))
    .digest('hex'),
  productionGuard,
  artifactApproved: manifest.approved,
  modelSha256: manifest.sha256,
  wasmSha256: manifest.wasm_sha256,
  runtimeSourceSha256: createHash('sha256').update(source).digest('hex'),
  casesSha256: createHash('sha256').update(caseData).digest('hex'),
  host: { platform: os.platform(), architecture: os.arch(), cpu: os.cpus()[0]?.model },
  profiles: [],
  note: 'Emulated timing, not a claim about a physical phone. Page supplement is used if actual worker throttling cannot be verified.',
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
let baselineWorker, baselinePage;
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
              page = [];
            for (let i = 0; i < samples; i++) {
              const start = performance.now();
              const result = await window.ask({
                ...input,
                entropy: Math.imul(i + 1, 2654435761) >>> 0,
              });
              worker.push(result.ms);
              roundTrip.push(performance.now() - start);
            }
            for (let i = 0; i < 25; i++) window.runPage({ ...input, entropy: i });
            for (let i = 0; i < samples; i++)
              page.push(window.runPage({ ...input, entropy: i }).ms);
            records.push({
              name: input.name,
              synthetic: input.synthetic,
              actions: input.actions.length,
              worker,
              roundTrip,
              page,
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
      const profile = {
        rate,
        browser: browser.version(),
        workerThrottleError,
        workerThrottleVerified: verified,
        pageThrottleVerified: pageVerified,
        workerCalibrationRatio: workerMedian / baselineWorker,
        pageCalibrationRatio: pageMedian / baselinePage,
        startup,
        memory,
        cases: profiles.map((item) => ({
          ...item,
          worker: summarize(item.worker),
          roundTrip: summarize(item.roundTrip),
          page: summarize(item.page),
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
            p95Ms: (verified ? c.worker : c.page).p95Ms,
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
      const value = slow.workerThrottleVerified ? c.worker : c.page;
      return value.p95Ms <= 20 && value.p99Ms <= 50;
    }) &&
    slow.startup.worker.memoryBytes <= 4 * 1024 * 1024 &&
    slow.startup.pageMs <= 500 &&
    report.assets.totalGzipBytes <= 256 * 1024;
  report.timingScope = slow.workerThrottleVerified
    ? 'throttled-worker'
    : 'verified-throttled-page-supplement';
  if (!report.performancePass) process.exitCode = 2;
} finally {
  server.close();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
