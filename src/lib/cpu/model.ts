// Numeric ABI shared with backend/ml/runtime. Call from a dedicated Worker.
export interface PolicyManifest {
  format: number;
  encoder: number;
  rules: string;
  approved: boolean;
  architecture: string;
  quantization: string;
  bytes: number;
  sha256: string;
  wasm_sha256?: string;
}

interface PolicyExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  model_ptr: () => number;
  state_ptr: () => number;
  actions_ptr: () => number;
  output_ptr: () => number;
  load_model: (length: number) => number;
  infer: (count: number, signal: number) => number;
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
  private constructor(private readonly wasm: PolicyExports) {}

  static async load(
    wasmBytes: BufferSource,
    modelBytes: Uint8Array<ArrayBuffer>,
    manifest: PolicyManifest,
  ) {
    if (
      !manifest.approved ||
      manifest.format !== 1 ||
      manifest.encoder !== 1 ||
      manifest.rules !== '2' ||
      manifest.architecture !== 'candidate-768-96-64-48-32-32-1-signal6' ||
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
    return new LocalPolicy(wasm);
  }

  decide(features: number[], actions: number[][], signal: boolean, entropy: number): number {
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
    return sampleLogits(new Float32Array(memory, this.wasm.output_ptr(), count), entropy);
  }
}
