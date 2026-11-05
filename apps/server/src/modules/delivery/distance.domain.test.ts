import { describe, expect, it } from 'vitest';
import { straightLineMeters, straightLineRoute } from './distance.domain';

const meskelSquare = { latitude: 9.0108, longitude: 38.7613 };
const ednaMall = { latitude: 8.9970566, longitude: 38.7866129 };

describe('straightLineMeters', () => {
  it('is zero for the same point', () => {
    expect(straightLineMeters(meskelSquare, meskelSquare)).toBe(0);
  });

  it('measures one degree of latitude as about 111 km', () => {
    const north = { ...meskelSquare, latitude: meskelSquare.latitude + 1 };
    expect(straightLineMeters(meskelSquare, north)).toBeCloseTo(111_195, -1);
  });

  it('measures across Addis Ababa', () => {
    expect(straightLineMeters(meskelSquare, ednaMall)).toBeCloseTo(3170, -1);
  });
});

describe('straightLineRoute', () => {
  it('adds the road detour, estimates the time at 25 km/h, and is flagged approximate', () => {
    const route = straightLineRoute(meskelSquare, ednaMall);
    expect(route.approximate).toBe(true);
    expect(route.meters).toBe(Math.round(straightLineMeters(meskelSquare, ednaMall) * 1.4));
    expect(route.seconds).toBe(Math.round((route.meters / 25_000) * 3600));
  });
});
