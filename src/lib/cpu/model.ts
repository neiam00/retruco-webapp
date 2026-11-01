// Numeric ABI shared with backend/ml/runtime. Call from a dedicated Worker.
export interface PolicyManifest {
  format: number;
  encoder: number;
  action_encoder: number;
  rules: string;
  approved: boolean;
  architecture: string;
  quantization: string;
  bytes: number;
  sha256: string;
  wasm_sha256?: string;
  memory_version?: number;
  memory_reset?: string;
}

interface PolicyExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  model_ptr: () => number;
  state_ptr: () => number;
  actions_ptr: () => number;
  output_ptr: () => number;
  load_model: (length: number) => number;
  infer: (count: number, signal: number) => number;
  memory_ptr: () => number;
  reset_memory: () => void;
  advance_memory: () => number;
}

// Use the distribution itself, preserving learned mixtures and bluff rates.
export function sampleLogits(logits: ArrayLike<number>, entropy: number): number {
  if (!logits.length || !Number.isInteger(entropy) || entropy < 0 || entropy > 0xffffffff) {
    throw new Error('Invalid policy sampling input');
  }
  let maximum = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (!Number.isFinite(logits[i])) throw new Error('Nonfinite policy output');
    maximum = Math.max(maximum, logits[i]);
  }
  let sum = 0;
  const weights = new Float64Array(logits.length);
  for (let i = 0; i < logits.length; i++) sum += weights[i] = Math.exp(logits[i] - maximum);
  let threshold = (entropy / 0x100000000) * sum;
  for (let i = 0; i < weights.length; i++) {
    threshold -= weights[i];
    if (threshold < 0) return i;
  }
  return weights.length - 1;
}

export class LocalPolicy {
  private memoryReady = false;
  private constructor(
    private readonly wasm: PolicyExports,
    readonly recurrent = false,
  ) {}

  static async load(
    wasmBytes: BufferSource,
    modelBytes: Uint8Array<ArrayBuffer>,
    manifest: PolicyManifest,
    purpose: 'release' | 'evaluation' = 'release',
  ) {
    if (
      typeof manifest.approved !== 'boolean' ||
      (manifest.approved !== true && purpose !== 'evaluation') ||
      ![1, 2].includes(manifest.format) ||
      manifest.encoder !== 2 ||
      manifest.action_encoder !== 1 ||
      manifest.rules !== '2' ||
      manifest.architecture !==
        `candidate-768-96-64-48-32-32-1-signal6${manifest.format === 2 ? '-lstm16-residual' : ''}` ||
      (manifest.format === 2 &&
        (purpose !== 'evaluation' ||
          manifest.memory_version !== 1 ||
          manifest.memory_reset !== 'hand')) ||
      manifest.quantization !== 'symmetric-int8-per-output-f32-execution' ||
      modelBytes.byteLength !== manifest.bytes ||
      manifest.bytes > 128 * 1024
    ) {
      throw new Error('Unsupported or unapproved CPU model');
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', modelBytes));
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== manifest.sha256) throw new Error('CPU model checksum mismatch');
    const wasmDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', wasmBytes));
    const wasmHash = Array.from(wasmDigest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (wasmHash !== manifest.wasm_sha256) throw new Error('CPU evaluator checksum mismatch');
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const wasm = instance.exports as PolicyExports;
    new Uint8Array(wasm.memory.buffer, wasm.model_ptr(), modelBytes.length).set(modelBytes);
    if (wasm.load_model(modelBytes.length) !== 0) throw new Error('Invalid CPU model');
    if (wasm.memory.buffer.byteLength > 4 * 1024 * 1024)
      throw new Error('CPU memory budget exceeded');
    return new LocalPolicy(wasm, manifest.format === 2);
  }

  resetMemory() {
    this.wasm.reset_memory();
    this.memoryReady = false;
  }

  advanceMemory(features: ArrayLike<number>) {
    if (
      !this.recurrent ||
      features.length !== 768 ||
      Array.from(features).some((x) => !Number.isFinite(x))
    )
      throw new Error('Invalid memory event');
    new Float32Array(this.wasm.memory.buffer, this.wasm.state_ptr(), 768).set(features);
    if (this.wasm.advance_memory() !== 0) throw new Error('Memory inference failed');
    this.memoryReady = true;
  }

  saveMemory(): Float32Array {
    return new Float32Array(this.wasm.memory.buffer, this.wasm.memory_ptr(), 32).slice();
  }

  restoreMemory(state: Float32Array) {
    if (!this.recurrent || state.length !== 32 || state.some((x) => !Number.isFinite(x)))
      throw new Error('Invalid memory state');
    new Float32Array(this.wasm.memory.buffer, this.wasm.memory_ptr(), 32).set(state);
    this.memoryReady = true;
  }

  // Offline evaluation can measure a candidate before approval. The deployed
  // worker always uses load's default release purpose; manifests are unchanged.
  get memoryBytes(): number {
    return this.wasm.memory.buffer.byteLength;
  }

  decide(features: number[], actions: number[][], signal: boolean, entropy: number): number {
    return sampleLogits(this.logits(features, actions, signal), entropy);
  }

  // The returned view is valid until the next inference. Offline parity checks
  // use this same path as the worker; callers that retain it must copy it.
  logits(features: number[], actions: number[][], signal: boolean): Float32Array {
    if (this.recurrent && !this.memoryReady) throw new Error('Authorized hand replay required');
    if (
      features.length !== 768 ||
      features.some((x) => !Number.isFinite(x)) ||
      actions.length > 1024 ||
      (!signal && actions.length === 0) ||
      actions.some((row) => row.length !== 48 || row.some((x) => !Number.isFinite(x)))
    ) {
      throw new Error('Invalid CPU observation');
    }
    const memory = this.wasm.memory.buffer;
    new Float32Array(memory, this.wasm.state_ptr(), 768).set(features);
    const candidates = new Float32Array(memory, this.wasm.actions_ptr(), actions.length * 48);
    actions.forEach((row, index) => candidates.set(row, index * 48));
    const count = this.wasm.infer(actions.length, Number(signal));
    if (count !== (signal ? 6 : actions.length) || this.wasm.memory.buffer !== memory) {
      throw new Error('CPU inference failed');
    }
    return new Float32Array(memory, this.wasm.output_ptr(), count);
  }
}
