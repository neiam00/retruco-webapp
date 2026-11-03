import { describe, expect, it, vi } from 'vitest';
import { LocalPolicy, sampleLogits } from './model.js';

describe('policy distribution', () => {
  it('never samples a masked claim even when its logit dominates', () => {
    for (const entropy of [0, 0x7fffffff, 0xffffffff])
      expect(sampleLogits([0, 10000, -1], entropy, [true, false, false])).toBe(0);
    expect(() => sampleLogits([0, 1], 0, [false, false])).toThrow();
  });
  it.each([0, 2, undefined])(
    'rejects unsupported or missing action encoder %j',
    async (actionEncoder) => {
      await expect(
        LocalPolicy.load(
          new Uint8Array(),
          new Uint8Array(),
          {
            format: 1,
            encoder: 2,
            action_encoder: actionEncoder as number,
            rules: '2',
            approved: false,
            architecture: 'candidate-768-96-64-48-32-32-1-signal6',
            quantization: 'symmetric-int8-per-output-f32-execution',
            bytes: 0,
            sha256: 'invalid',
          },
          'evaluation',
        ),
      ).rejects.toThrow('Unsupported');
    },
  );
  it('samples both actions rather than selecting only the highest score', () => {
    expect(sampleLogits([0, Math.log(3)], 0)).toBe(0);
    expect(sampleLogits([0, Math.log(3)], 0xffffffff)).toBe(1);
    const counts = [0, 0];
    for (let i = 0; i < 1000; i++)
      counts[sampleLogits([0, Math.log(3)], Math.floor((i / 1000) * 0x100000000))]++;
    expect(counts).toEqual([250, 750]);
  });
  it('remains stable for large finite logits', () => {
    expect(sampleLogits([10000, 10000], 0)).toBe(0);
    expect(sampleLogits([10000, 10000], 0xffffffff)).toBe(1);
    expect(() => sampleLogits([NaN], 0)).toThrow();
    expect(() => sampleLogits([Infinity], 0)).toThrow();
    expect(() => sampleLogits([], 0)).toThrow();
  });
  it('rejects an unapproved model before instantiating any module', async () => {
    await expect(
      LocalPolicy.load(new Uint8Array(), new Uint8Array(), {
        format: 1,
        encoder: 2,
        action_encoder: 1,
        rules: '2',
        approved: false,
        architecture: 'candidate-768-96-64-48-32-32-1-signal6',
        quantization: 'symmetric-int8-per-output-f32-execution',
        bytes: 0,
        sha256: '',
      }),
    ).rejects.toThrow('unapproved');
  });

  it('evaluation mode does not waive checksums or mutate approval', async () => {
    const manifest = {
      format: 1,
      encoder: 2,
      action_encoder: 1,
      rules: '2',
      approved: false,
      architecture: 'candidate-768-96-64-48-32-32-1-signal6',
      quantization: 'symmetric-int8-per-output-f32-execution',
      bytes: 0,
      sha256: 'invalid',
    };
    await expect(
      LocalPolicy.load(new Uint8Array(), new Uint8Array(), manifest, 'evaluation'),
    ).rejects.toThrow('checksum');
    expect(manifest.approved).toBe(false);
  });

  it.each(['false', 1, null])(
    'evaluation rejects malformed approval %j before checksums',
    async (approved) => {
      await expect(
        LocalPolicy.load(
          new Uint8Array(),
          new Uint8Array(),
          {
            format: 1,
            encoder: 2,
            action_encoder: 1,
            rules: '2',
            approved: approved as unknown as boolean,
            architecture: 'candidate-768-96-64-48-32-32-1-signal6',
            quantization: 'symmetric-int8-per-output-f32-execution',
            bytes: 0,
            sha256: 'invalid',
          },
          'evaluation',
        ),
      ).rejects.toThrow('Unsupported');
    },
  );
});

describe('larger recurrent model loading', () => {
  it.each([32, 64])(
    'binds LSTM%d metadata to runtime and saves complete seat memory',
    async (size) => {
      const memory = new WebAssembly.Memory({ initial: 2 });
      const runtime = {
        memory,
        model_ptr: () => 0,
        state_ptr: () => 2048,
        actions_ptr: () => 4096,
        output_ptr: () => 1024,
        memory_ptr: () => 512,
        memory_size: () => size,
        load_model: () => 0,
        reset_memory: () => {},
        advance_memory: () => 0,
        infer: () => 6,
      };
      const instantiate = vi.spyOn(WebAssembly, 'instantiate').mockResolvedValue({
        instance: { exports: runtime },
      } as unknown as WebAssembly.Instance);
      const bytes = new Uint8Array([1]);
      const digest = async (value: Uint8Array<ArrayBuffer>) =>
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), (x) =>
          x.toString(16).padStart(2, '0'),
        ).join('');
      const manifest = {
        format: 3,
        encoder: 2,
        action_encoder: 1,
        rules: '2',
        approved: false,
        architecture: `candidate-768-96-64-48-32-32-1-signal6-lstm${size}-residual`,
        memory_version: 1,
        memory_reset: 'hand',
        memory_size: size,
        parameters: 85127 + 4 * size * size + 328 * size + 64,
        quantization: 'symmetric-int8-per-output-f32-execution',
        bytes: 1,
        sha256: await digest(bytes),
        wasm_sha256: await digest(bytes),
      };
      try {
        const policy = await LocalPolicy.load(bytes, bytes, manifest, 'evaluation');
        policy.restoreMemory(Float32Array.from({ length: size * 2 }, (_, i) => i / 128));
        const saved = policy.saveMemory();
        expect(saved.length).toBe(size * 2);
        expect(saved.at(-1)).toBe((size * 2 - 1) / 128);
        expect(() => policy.restoreMemory(new Float32Array(32))).toThrow('Invalid memory');
        runtime.memory_size = () => (size === 64 ? 32 : 64);
        await expect(LocalPolicy.load(bytes, bytes, manifest, 'evaluation')).rejects.toThrow(
          'architecture mismatch',
        );
        await expect(LocalPolicy.load(bytes, bytes, manifest, 'release')).rejects.toThrow(
          'Unsupported',
        );
        await expect(
          LocalPolicy.load(bytes, bytes, { ...manifest, parameters: 150001 }, 'evaluation'),
        ).rejects.toThrow('Unsupported');
        runtime.memory_size = () => size;
        for (const legacy of [
          {
            format: 1,
            memory_size: 0,
            parameters: 85127,
            architecture: 'candidate-768-96-64-48-32-32-1-signal6',
          },
          {
            format: 2,
            memory_size: 16,
            parameters: 91463,
            architecture: 'candidate-768-96-64-48-32-32-1-signal6-lstm16-residual',
          },
        ]) {
          await expect(
            LocalPolicy.load(bytes, bytes, { ...manifest, ...legacy }, 'evaluation'),
          ).rejects.toThrow('architecture mismatch');
        }
        expect(manifest.approved).toBe(false);
      } finally {
        instantiate.mockRestore();
      }
    },
  );
});
