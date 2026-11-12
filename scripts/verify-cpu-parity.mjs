// Offline candidate verification through the actual browser policy wrapper.
// This script neither changes manifest approval nor publishes assets.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { chromium } from '@playwright/test';

const [bundlePath, inputPath, outputPath] = process.argv.slice(2);
if (!outputPath) throw Error('Usage: node scripts/verify-cpu-parity.mjs BUNDLE CASES OUTPUT');
const bundle = resolve(bundlePath);
const input = JSON.parse(readFileSync(inputPath, 'utf8'));
const source = readFileSync(new URL('../src/lib/cpu/model.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const model = readFileSync(resolve(bundle, 'policy.bin'));
const wasm = readFileSync(resolve(bundle, 'policy.wasm'));
const manifest = JSON.parse(readFileSync(resolve(bundle, 'manifest.json'), 'utf8'));
const sha = (data) => createHash('sha256').update(data).digest('hex');
if (sha(model) !== manifest.sha256 || sha(wasm) !== manifest.wasm_sha256)
  throw Error('Candidate checksum mismatch');
const module = await WebAssembly.compile(wasm);
if (WebAssembly.Module.imports(module).length) throw Error('Unexpected WASM host imports');
const { exports: native } = await WebAssembly.instantiate(module, {});
new Uint8Array(native.memory.buffer, native.model_ptr(), model.length).set(model);
if (native.load_model(model.length) !== 0) throw Error('Node model initialization failed');
const initialMemory = native.memory.buffer.byteLength;
const nodeStates = [];
const teamDecisions = { checked: 0, reassignments: 0 };
const nodeResults = input.cases.map((c) => {
  if (c.events) {
    native.reset_memory();
    for (const event of c.events) {
      new Float32Array(native.memory.buffer, native.state_ptr(), 768).set(event);
      if (native.advance_memory() !== 0) throw Error('Node memory replay failed');
    }
  }
  new Float32Array(native.memory.buffer, native.state_ptr(), 768).set(c.features);
  new Float32Array(native.memory.buffer, native.actions_ptr(), c.actions.length * 48).set(
    c.actions.flat(),
  );
  const count = native.infer(c.actions.length, Number(c.signal));
  if (count !== (c.signal ? 6 : c.actions.length)) throw Error('Node inference failed');
  if (manifest.team_play && !c.signal) {
    if (!Array.isArray(c.team_actions_v1) || c.team_actions_v1.length !== count)
      throw Error('Missing expected team decisions');
    for (let i = 0; i < count; i++) {
      const adjust =
        manifest.team_play === 'closing-card-and-flor-v2'
          ? native.team_action_v2
          : native.team_action_v1;
      const mapped = adjust(count, i);
      if (mapped !== c.team_actions_v1[i]) throw Error('WASM team rule differs on ' + c.name);
      teamDecisions.checked++;
      teamDecisions.reassignments += Number(mapped !== i);
    }
  }
  if (c.events)
    nodeStates.push(Array.from(new Float32Array(native.memory.buffer, native.memory_ptr(), 128)));
  return Array.from(new Float32Array(native.memory.buffer, native.output_ptr(), count));
});
if (native.memory.buffer.byteLength !== initialMemory) throw Error('Node memory grew');
const assets = new Map([
  ['/', ['text/html', '<!doctype html><title>Local CPU parity</title>']],
  ['/model.js', ['text/javascript', compiled]],
  ['/policy.bin', ['application/octet-stream', model]],
  ['/policy.wasm', ['application/wasm', wasm]],
  ['/manifest.json', ['application/json', JSON.stringify(manifest)]],
]);
const server = createServer((request, response) => {
  const asset = assets.get(request.url);
  if (!asset) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': asset[0], 'cache-control': 'no-store' });
  response.end(asset[1]);
});
await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', accept);
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(async (cases) => {
    const { LocalPolicy, sampleLogits } = await import('/model.js');
    const [wasm, model, manifest] = await Promise.all([
      fetch('/policy.wasm').then((r) => r.arrayBuffer()),
      fetch('/policy.bin').then((r) => r.arrayBuffer()),
      fetch('/manifest.json').then((r) => r.json()),
    ]);
    const policy = await LocalPolicy.load(wasm, new Uint8Array(model), manifest, 'evaluation');
    const before = policy.memoryBytes;
    const states = [];
    let sampledReassignments = 0;
    const results = cases.map((c, index) => {
      if (c.events) {
        policy.resetMemory();
        for (const event of c.events) policy.advanceMemory(event);
        states.push(Array.from(policy.saveMemory()));
      }
      const logits = Array.from(policy.logits(c.features, c.actions, c.signal));
      if (logits.some((x) => !Number.isFinite(x))) throw Error('Nonfinite browser output');
      const samples = manifest.team_play && !c.synthetic ? 8 : 1;
      for (let draw = 0; draw < samples; draw++) {
        const entropy = (Math.imul(index + 1, 2654435761) + Math.imul(draw, 2246822519)) >>> 0;
        const mask = c.signal ? c.signalMask : undefined;
        const raw = sampleLogits(logits, entropy, mask);
        const selected = policy.decide(c.features, c.actions, c.signal, entropy, mask);
        const expected = manifest.team_play && !c.signal ? c.team_actions_v1[raw] : raw;
        if (selected !== expected) throw Error('Browser decision differs on ' + c.name);
        sampledReassignments += Number(selected !== raw);
      }
      return logits;
    });
    if (policy.memoryBytes !== before) throw Error('Browser memory grew');
    return { results, states, memory_bytes: before, sampledReassignments };
  }, input.cases);
  writeFileSync(
    outputPath,
    JSON.stringify({
      node: nodeResults,
      node_states: nodeStates,
      browser: result.results,
      browser_states: result.states,
      memory_bytes: result.memory_bytes,
      node_memory_bytes: initialMemory,
      browser_version: browser.version(),
      ...(manifest.team_play
        ? {
            team_decisions: {
              ...teamDecisions,
              browser_sampled_reassignments: result.sampledReassignments,
            },
          }
        : {}),
      model_source_sha256: sha(source),
      compiled_wrapper_sha256: sha(compiled),
      harness_sha256: sha(readFileSync(new URL(import.meta.url))),
      model_sha256: sha(model),
      wasm_sha256: sha(wasm),
    }),
  );
} finally {
  await browser?.close();
  await new Promise((accept) => server.close(accept));
}
