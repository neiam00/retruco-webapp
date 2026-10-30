// Run after a production build with ML enabled and VITE_CPU_EVALUATION=true.
// Execute the emitted worker, proving local evaluation cannot survive the build.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const folder = resolve('.svelte-kit/output/client/_app/immutable/workers');
const files = readdirSync(folder).filter((name) => name.endsWith('.js'));
assert.equal(files.length, 1, 'expected exactly one emitted CPU worker');
const code = readFileSync(resolve(folder, files[0]), 'utf8');
const requests = [];
const manifest = {
  approved: false,
  format: 1,
  encoder: 2,
  rules: '2',
  bytes: 86804,
  architecture: 'candidate-768-96-64-48-32-32-1-signal6',
  quantization: 'symmetric-int8-per-output-f32-execution',
  sha256: '0'.repeat(64),
  wasm_sha256: '0'.repeat(64),
};
const location = {
  origin: 'http://localhost',
  hostname: 'localhost',
  href: 'http://localhost/worker.js',
};
let resolveReady;
const ready = new Promise((resolve) => {
  resolveReady = resolve;
});
const self = {
  location,
  postMessage: (message) => {
    if (message.type === 'ready') resolveReady();
  },
};
vm.runInNewContext(code, {
  self,
  location,
  URL,
  AbortSignal,
  Uint8Array,
  Float32Array,
  Float64Array,
  WebAssembly,
  crypto: webcrypto,
  setTimeout,
  clearTimeout,
  fetch: async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify(manifest));
  },
});
let timeout;
try {
  await Promise.race([
    ready,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('worker did not become ready')), 5000);
    }),
  ]);
} finally {
  clearTimeout(timeout);
}
assert.equal(
  requests.length,
  1,
  'enabled production worker must fetch only the unapproved manifest, never candidate binaries',
);
assert.ok(
  requests[0].endsWith('manifest.json'),
  'build with ML enabled and a manifest URL before checking',
);
console.log(
  JSON.stringify({
    productionEvaluationDisabled: true,
    unapprovedBinaryDownloads: 0,
    worker: files[0],
    workerSha256: createHash('sha256').update(code).digest('hex'),
  }),
);
