import { describe, expect, it } from 'vitest';
import { LocalPolicy, sampleLogits } from './model.js';

describe('policy distribution', () => {
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
        encoder: 1,
        rules: '2',
        approved: false,
        architecture: '',
        quantization: '',
        bytes: 0,
        sha256: '',
      }),
    ).rejects.toThrow('unapproved');
  });
});
