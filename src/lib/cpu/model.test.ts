import { describe, expect, it } from 'vitest';
import { LocalPolicy, sampleLogits } from './model.js';

describe('policy distribution', () => {
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
