import { describe, expect, it } from 'vitest';
import { noteZone } from './area-notes.domain';

describe('noteZone', () => {
  it('puts points a few hundred metres apart in one zone', () => {
    const megenagna = { latitude: 9.0203, longitude: 38.8027 };
    expect(noteZone({ latitude: 9.0215, longitude: 38.8031 })).toBe(noteZone(megenagna));
  });

  it('puts another neighbourhood in another zone', () => {
    const megenagna = { latitude: 9.0203, longitude: 38.8027 };
    const kality = { latitude: 8.9285, longitude: 38.7637 };
    expect(noteZone(kality)).not.toBe(noteZone(megenagna));
  });
});
