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
  function modelHeader(format: number, size: number) {
    const bytes = new Uint8Array(format >= 3 ? 16 : 12);
    const header = new DataView(bytes.buffer);
    bytes.set([82, 84, 77, 76]); // RTML
    header.setUint32(4, format, true);
    header.setUint32(8, 2, true);
    if (format >= 3) header.setUint32(12, size, true);
    return bytes;
  }

  it.each([
    { size: 32, format: 3 },
    { size: 64, format: 3 },
    { size: 64, format: 4 },
    { size: 64, format: 5 },
  ])(
    'binds LSTM$size format $format metadata to runtime and saves complete seat memory',
    async ({ size, format }) => {
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
      const bytes = modelHeader(format, size);
      const digest = async (value: Uint8Array<ArrayBuffer>) =>
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)), (x) =>
          x.toString(16).padStart(2, '0'),
        ).join('');
      const manifest = {
        format,
        encoder: 2,
        action_encoder: 1,
        rules: '2',
        approved: false,
        architecture: `candidate-768-96-64-48-32-32-1-signal6-lstm${size}-residual${format === 5 ? '-public-candidates-v1' : ''}`,
        memory_version: 1,
        memory_reset: 'hand',
        memory_size: size,
        parameters: 85127 + 4 * size * size + 328 * size + 64,
        quantization: 'symmetric-int8-per-output-f32-execution',
        bytes: bytes.length,
        sha256: await digest(bytes),
        wasm_sha256: await digest(bytes),
        ...(format >= 4 ? { cell: 'lstm', inference_math: 'centered-f64-heads-f32-state' } : {}),
        ...(format === 5 ? { candidate_features: 1 } : {}),
      };
      try {
        const policy = await LocalPolicy.load(bytes, bytes, manifest, 'evaluation');
        expect(policy.memoryIdentity).toBe(`${manifest.sha256}:${manifest.wasm_sha256}:2:1`);
        if (format === 4) {
          const profile = {
            ...manifest,
            team_play: 'closing-card-and-flor-v1' as const,
            architecture: manifest.architecture + '-team-play-v1',
          };
          await expect(LocalPolicy.load(bytes, bytes, profile, 'evaluation')).rejects.toThrow(
            'Missing team decision runtime',
          );
          await expect(
            LocalPolicy.load(bytes, bytes, { ...profile, team_play: undefined }, 'evaluation'),
          ).rejects.toThrow('Unsupported');
          await expect(
            LocalPolicy.load(
              bytes,
              bytes,
              { ...profile, architecture: manifest.architecture },
              'evaluation',
            ),
          ).rejects.toThrow('Unsupported');
        }
        for (const [offset, value] of [
          [0, 0],
          [4, format >= 4 ? 3 : 4],
          [8, 1],
          [12, size === 64 ? 32 : 64],
        ]) {
          const altered = bytes.slice();
          new DataView(altered.buffer).setUint32(offset, value, true);
          const before = instantiate.mock.calls.length;
          await expect(
            LocalPolicy.load(
              bytes,
              altered,
              { ...manifest, sha256: await digest(altered) },
              'evaluation',
            ),
          ).rejects.toThrow('artifact metadata mismatch');
          expect(instantiate.mock.calls).toHaveLength(before);
        }
        const truncated = bytes.slice(0, 12);
        await expect(
          LocalPolicy.load(
            bytes,
            truncated,
            { ...manifest, bytes: truncated.length, sha256: await digest(truncated) },
            'evaluation',
          ),
        ).rejects.toThrow('artifact metadata mismatch');
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
        // Approval changes eligibility, never the journal requirement. The
        // runtime must receive authorized memory before a release can infer.
        const release = await LocalPolicy.load(bytes, bytes, { ...manifest, approved: true });
        expect(() => release.logits(Array(768).fill(0), [], true)).toThrow('replay required');
        release.advanceMemory(Array(768).fill(0));
        expect(release.logits(Array(768).fill(0), [], true)).toHaveLength(6);
        release.resetMemory();
        expect(() => release.logits(Array(768).fill(0), [], true)).toThrow('replay required');
        if (format >= 4) {
          for (const incompatible of [
            { cell: 'gru' },
            { cell: undefined },
            { inference_math: 'f32-heads' },
            { inference_math: undefined },
            { memory_version: 2 },
            { memory_reset: 'match' },
          ]) {
            await expect(
              LocalPolicy.load(bytes, bytes, { ...manifest, ...incompatible }, 'evaluation'),
            ).rejects.toThrow('Unsupported');
          }
        }
        if (format === 5) {
          for (const candidate_features of [undefined, 0, 2]) {
            await expect(
              LocalPolicy.load(bytes, bytes, { ...manifest, candidate_features }, 'evaluation'),
            ).rejects.toThrow('Unsupported');
          }
        }
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
          const legacyBytes = modelHeader(legacy.format, legacy.memory_size);
          await expect(
            LocalPolicy.load(
              bytes,
              legacyBytes,
              {
                ...manifest,
                ...legacy,
                candidate_features: undefined,
                bytes: legacyBytes.length,
                sha256: await digest(legacyBytes),
              },
              'evaluation',
            ),
          ).rejects.toThrow('architecture mismatch');
        }
        expect(manifest.approved).toBe(false);
      } finally {
        instantiate.mockRestore();
      }
    },
  );
});
