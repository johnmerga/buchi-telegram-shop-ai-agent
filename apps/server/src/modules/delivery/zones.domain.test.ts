import { getResolution, isValidCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { straightLineMeters } from './distance.domain';
import { nearbyZones, parentZone, zoneCenter, zoneOf } from './zones.domain';

const ednaMall = { latitude: 8.9970566, longitude: 38.7866129 };

describe('zones', () => {
  it('puts a pin in an H3 resolution-7 zone whose parent is at resolution 6', () => {
    const zone = zoneOf(ednaMall);
    expect(isValidCell(zone)).toBe(true);
    expect(getResolution(zone)).toBe(7);
    expect(getResolution(parentZone(zone))).toBe(6);
  });

  it('centers a zone within its 1.4 km edge of the pin', () => {
    expect(straightLineMeters(zoneCenter(zoneOf(ednaMall)), ednaMall)).toBeLessThan(1500);
  });

  it('counts the zone itself and its six neighbours as nearby', () => {
    const zone = zoneOf(ednaMall);
    const nearby = nearbyZones(zone);
    expect(nearby).toHaveLength(7);
    expect(nearby).toContain(zone);
  });
});
