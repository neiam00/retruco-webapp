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
  memory_size?: number;
  parameters?: number;
  cell?: string;
  inference_math?: string;
  candidate_features?: number;
  team_play?: 'closing-card-and-flor-v1' | 'closing-card-and-flor-v2';
  choice_policy?:
    'value-and-team-v1' | 'value-and-team-v2' | 'value-and-team-v3' | 'value-and-team-v4';
}

type PolicyExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  model_ptr: () => number;
  state_ptr: () => number;
  actions_ptr: () => number;
  output_ptr: () => number;
  load_model: (length: number) => number;
  infer: (count: number, signal: number) => number;
  memory_ptr: () => number;
  memory_size: () => number;
  reset_memory: () => void;
  advance_memory: () => number;
  team_action_v1?: (count: number, sampled: number) => number;
  team_action_v2?: (count: number, sampled: number) => number;
};

// Use the distribution itself, preserving learned mixtures and bluff rates.
export function sampleLogits(logits: ArrayLike<number>, entropy: number, mask?: boolean[]): number {
  if (!logits.length || !Number.isInteger(entropy) || entropy < 0 || entropy > 0xffffffff) {
    throw new Error('Invalid policy sampling input');
  }
  if (
    mask &&
    (mask.length !== logits.length ||
      !mask.some(Boolean) ||
      mask.some((x) => typeof x !== 'boolean'))
  )
    throw new Error('Invalid legal policy mask');
  let maximum = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    if (!Number.isFinite(logits[i])) throw new Error('Nonfinite policy output');
    if (!mask || mask[i]) maximum = Math.max(maximum, logits[i]);
  }
  let sum = 0;
  const weights = new Float64Array(logits.length);
  for (let i = 0; i < logits.length; i++)
    sum += weights[i] = mask && !mask[i] ? 0 : Math.exp(logits[i] - maximum);
  let threshold = (entropy / 0x100000000) * sum;
  for (let i = 0; i < weights.length; i++) {
    threshold -= weights[i];
    if (threshold < 0) return i;
  }
  return mask ? mask.lastIndexOf(true) : weights.length - 1;
}

export class LocalPolicy {
  private memoryReady = false;
  private constructor(
    private readonly wasm: PolicyExports,
    readonly recurrent = false,
    readonly memorySize = recurrent ? 16 : 0,
    readonly memoryIdentity = '',
    private readonly adjustTeamAction?: (count: number, sampled: number) => number,
    readonly choicePolicy?: PolicyManifest['choice_policy'],
  ) {}

  static async load(
    wasmBytes: BufferSource,
    modelBytes: Uint8Array<ArrayBuffer>,
    manifest: PolicyManifest,
    purpose: 'release' | 'evaluation' = 'release',
  ) {
    const memorySize = manifest.format >= 3 ? manifest.memory_size : manifest.format === 2 ? 16 : 0;
    const parameters = memorySize
      ? 85127 + 4 * memorySize * memorySize + 328 * memorySize + 64
      : 85127;
    if (
      typeof memorySize !== 'number' ||
      (manifest.format >= 3 && ![32, 64].includes(memorySize)) ||
      (manifest.format < 3 &&
        manifest.memory_size !== undefined &&
        manifest.memory_size !== memorySize) ||
      parameters > 150000 ||
      (manifest.parameters !== undefined && manifest.parameters !== parameters) ||
      (manifest.format >= 3 && manifest.parameters !== parameters) ||
      (manifest.format >= 4 &&
        (memorySize !== 64 ||
          manifest.cell !== 'lstm' ||
          manifest.inference_math !== 'centered-f64-heads-f32-state')) ||
      (manifest.candidate_features !== undefined && manifest.candidate_features !== 0) ||
      (manifest.choice_policy !== undefined &&
        (![
          'value-and-team-v1',
          'value-and-team-v2',
          'value-and-team-v3',
          'value-and-team-v4',
        ].includes(manifest.choice_policy) ||
          manifest.team_play !== 'closing-card-and-flor-v2')) ||
      (manifest.team_play !== undefined &&
        (!['closing-card-and-flor-v1', 'closing-card-and-flor-v2'].includes(manifest.team_play) ||
          manifest.format !== 4)) ||
      typeof manifest.approved !== 'boolean' ||
      (manifest.approved !== true && purpose !== 'evaluation') ||
      ![1, 2, 3, 4].includes(manifest.format) ||
      manifest.encoder !== 2 ||
      manifest.action_encoder !== 1 ||
      manifest.rules !== '2' ||
      manifest.architecture !==
        `candidate-768-96-64-48-32-32-1-signal6${memorySize ? `-lstm${memorySize}-residual` : ''}${manifest.team_play ? '-team-play-' + manifest.team_play.slice(-2) : ''}` ||
      (manifest.format !== 1 &&
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
    if (manifest.format === 4) {
      const header = new DataView(modelBytes.buffer, modelBytes.byteOffset, modelBytes.byteLength);
      if (
        header.byteLength < 16 ||
        header.getUint32(0, true) !== 0x4c4d5452 ||
        header.getUint32(4, true) !== manifest.format ||
        header.getUint32(8, true) !== manifest.encoder ||
        header.getUint32(12, true) !== memorySize
      )
        throw new Error('CPU artifact metadata mismatch');
    }
    const { instance } = await WebAssembly.instantiate(wasmBytes, {});
    const wasm = instance.exports as PolicyExports;
    new Uint8Array(wasm.memory.buffer, wasm.model_ptr(), modelBytes.length).set(modelBytes);
    if (wasm.load_model(modelBytes.length) !== 0) throw new Error('Invalid CPU model');
    if (wasm.memory.buffer.byteLength > 4 * 1024 * 1024)
      throw new Error('CPU memory budget exceeded');
    const runtimeMemorySize =
      typeof wasm.memory_size === 'function' ? wasm.memory_size() : undefined;
    const teamAction =
      manifest.team_play === 'closing-card-and-flor-v2' ? wasm.team_action_v2 : wasm.team_action_v1;
    if (manifest.team_play && typeof teamAction !== 'function')
      throw new Error('Missing team decision runtime');
    if (
      (manifest.format >= 3 && runtimeMemorySize === undefined) ||
      (runtimeMemorySize !== undefined && runtimeMemorySize !== memorySize)
    )
      throw new Error('CPU memory architecture mismatch');
    return new LocalPolicy(
      wasm,
      manifest.format !== 1,
      memorySize,
      `${manifest.sha256}:${manifest.wasm_sha256}:${manifest.encoder}:${manifest.memory_version ?? 0}` +
        (manifest.team_play ? `:${manifest.team_play}` : '') +
        (manifest.choice_policy ? `:${manifest.choice_policy}` : ''),
      manifest.team_play ? teamAction : undefined,
      manifest.choice_policy,
    );
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
    return new Float32Array(
      this.wasm.memory.buffer,
      this.wasm.memory_ptr(),
      2 * this.memorySize,
    ).slice();
  }

  restoreMemory(state: Float32Array) {
    if (
      !this.recurrent ||
      state.length !== 2 * this.memorySize ||
      state.some((x) => !Number.isFinite(x))
    )
      throw new Error('Invalid memory state');
    new Float32Array(this.wasm.memory.buffer, this.wasm.memory_ptr(), 2 * this.memorySize).set(
      state,
    );
    this.memoryReady = true;
  }

  // Offline evaluation can measure a candidate before approval. The deployed
  // worker always uses load's default release purpose; manifests are unchanged.
  get memoryBytes(): number {
    return this.wasm.memory.buffer.byteLength;
  }

  decide(
    features: number[],
    actions: number[][],
    signal: boolean,
    entropy: number,
    signalMask?: boolean[],
  ): number {
    const sampled = sampleLogits(
      this.logits(features, actions, signal),
      entropy,
      signal ? signalMask : undefined,
    );
    if (signal || features[0] !== 1 || !this.adjustTeamAction) return sampled;
    const index = this.adjustTeamAction(actions.length, sampled);
    if (!Number.isInteger(index) || index < 0 || index >= actions.length)
      throw new Error('Invalid adjusted team action');
    return index;
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
