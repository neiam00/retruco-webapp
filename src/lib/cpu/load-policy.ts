import { LocalPolicy, type PolicyManifest } from './model.js';

// Explicit build-time kill switch. Artifact URLs stay on the app origin.
export async function loadPolicy(
  enabled: boolean,
  manifestURL: string,
  purpose: 'release' | 'evaluation' = 'release',
): Promise<LocalPolicy | undefined> {
  if (!enabled || !manifestURL) return undefined;
  try {
    const url = new URL(manifestURL, globalThis.location.origin);
    if (url.origin !== globalThis.location.origin) return undefined;
    const signal = AbortSignal.timeout(10000);
    const manifestResponse = await fetch(url, { signal });
    if (!manifestResponse.ok) return undefined;
    const manifest = (await manifestResponse.json()) as PolicyManifest;
    if (!manifest.approved && purpose !== 'evaluation') return undefined;
    const [wasm, model] = await Promise.all([
      fetch(new URL('policy.wasm', url), { signal }),
      fetch(new URL('policy.bin', url), { signal }),
    ]);
    if (!wasm.ok || !model.ok) return undefined;
    return await LocalPolicy.load(
      await wasm.arrayBuffer(),
      new Uint8Array(await model.arrayBuffer()),
      manifest,
      purpose,
    );
  } catch {
    return undefined;
  }
}
