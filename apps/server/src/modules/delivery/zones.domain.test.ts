import { getResolution, isValidCell } from 'h3-js';
import { describe, expect, it } from 'vitest';
import { straightLineMeters } from './distance.domain';
import {
  isZone,
  parentZone,
  timeFactorZones,
  zoneBoundary,
  zoneCenter,
  zoneOf,
} from './zones.domain';

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

  it('looks for a time factor in the zone, its parent, and then the whole city', () => {
    const zone = zoneOf(ednaMall);
    expect(timeFactorZones(zone)).toEqual([zone, parentZone(zone), 'all']);
  });

  it('tells resolution-7 zones from their parents and the city', () => {
    const zone = zoneOf(ednaMall);
    expect(isZone(zone)).toBe(true);
    expect(isZone(parentZone(zone))).toBe(false);
    expect(isZone('all')).toBe(false);
  });

  it('draws a zone as a hexagon around its center', () => {
    const zone = zoneOf(ednaMall);
    const corners = zoneBoundary(zone);
    // A cell that crosses an edge of H3's icosahedron gets an extra corner there.
    expect(corners.length).toBeGreaterThanOrEqual(6);
    for (const corner of corners) {
      expect(straightLineMeters(corner, zoneCenter(zone))).toBeLessThan(1500);
    }
  });
});
