import { describe, expect, it } from 'vitest';
import { normalizeLandmark } from './landmarks.domain';

describe('normalizeLandmark', () => {
  it('ignores case and extra spaces', () => {
    expect(normalizeLandmark({ name: '  Edna   MALL ', area: 'Bole' })).toEqual({
      name: 'edna mall',
      area: 'bole',
    });
  });

  it('keeps Amharic text and unifies its Unicode form', () => {
    expect(normalizeLandmark({ name: 'ኤድና ሞል', area: 'ቦሌ' })).toEqual({
      name: 'ኤድና ሞል',
      area: 'ቦሌ',
    });
    expect(normalizeLandmark({ name: 'Ｅdna', area: 'Bole' }).name).toBe('edna');
  });
});
