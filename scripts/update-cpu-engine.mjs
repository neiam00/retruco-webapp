import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backend = resolve(process.argv[2] ?? resolve(frontend, '../backend'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: backend,
  encoding: 'utf8',
}).trim();
execFileSync(
  'git',
  ['diff', '--exit-code', 'HEAD', '--', 'rules', 'cpu', 'cmd/cpu', 'Makefile', 'go.mod', 'go.sum'],
  { cwd: backend, stdio: 'inherit' },
);
execFileSync('make', ['browser-engine'], { cwd: backend, stdio: 'inherit' });
const destination = resolve(frontend, 'src/lib/cpu/vendor');
mkdirSync(destination, { recursive: true });
const hashes = {};
for (const name of ['cpu.wasm', 'wasm_exec.js', 'LICENSE.GO']) {
  const path = resolve(destination, name);
  copyFileSync(resolve(backend, 'bin/browser-engine', name), path);
  hashes[name] = createHash('sha256').update(readFileSync(path)).digest('hex');
}
const licenses = resolve(frontend, 'static/licenses');
mkdirSync(licenses, { recursive: true });
copyFileSync(resolve(destination, 'LICENSE.GO'), resolve(licenses, 'go.txt'));
const goVersion = execFileSync('go', ['env', 'GOVERSION'], {
  cwd: backend,
  encoding: 'utf8',
}).trim();
writeFileSync(
  resolve(destination, 'manifest.json'),
  JSON.stringify({ sourceCommit, goVersion, hashes }, null, 2) + '\n',
);
console.log(`Updated CPU engine from ${sourceCommit} (${goVersion}).`);
