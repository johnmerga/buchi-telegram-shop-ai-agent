import { describe, expect, it } from 'vitest';
import { checkInvite, currentWork, driverDisplayName, hashInviteToken } from './drivers.domain';

const now = new Date('2026-11-05T09:00:00Z');
const invite = { username: 'abebe_rides', expiresAt: new Date('2026-11-06T09:00:00Z') };

describe('checkInvite', () => {
  it('accepts the invited username in any case before the expiry', () => {
    expect(checkInvite(invite, { username: 'Abebe_Rides' }, now)).toBeUndefined();
  });

  it('rejects someone else who opens a forwarded link', () => {
    expect(checkInvite(invite, { username: 'kebede' }, now)).toBe('wrong_user');
  });

  it('rejects a Telegram account without a username', () => {
    expect(checkInvite(invite, { username: undefined }, now)).toBe('wrong_user');
  });

  it('rejects the link at and after its expiry', () => {
    expect(checkInvite(invite, { username: 'abebe_rides' }, invite.expiresAt)).toBe('expired');
  });
});

describe('hashInviteToken', () => {
  it('stores a fixed-length hash that does not contain the token', () => {
    const hash = hashInviteToken('secret-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('secret-token');
    expect(hashInviteToken('secret-token')).toBe(hash);
  });
});

describe('driverDisplayName', () => {
  it('is the Telegram name when it has a letter, in any script', () => {
    expect(driverDisplayName({ name: 'Abebe ', username: 'abebe_rides' })).toBe('Abebe');
    expect(driverDisplayName({ name: 'አበበ', username: 'abebe_rides' })).toBe('አበበ');
  });

  it('falls back to the username for a name of only symbols', () => {
    expect(driverDisplayName({ name: '.', username: 'abebe_rides' })).toBe('@abebe_rides');
    expect(driverDisplayName({ name: null, username: 'abebe_rides' })).toBe('@abebe_rides');
  });
});

describe('currentWork', () => {
  const firstOrder = '3f2a9c00-0000-4000-8000-000000000001';
  const secondOrder = '7b1d4e00-0000-4000-8000-000000000002';

  it("names each driver's first open stop and whether they picked it up", () => {
    const work = currentWork([
      { driverId: 'abebe', jobStatus: 'picked_up', orderId: firstOrder },
      { driverId: 'abebe', jobStatus: 'picked_up', orderId: secondOrder },
      { driverId: 'kebede', jobStatus: 'assigned', orderId: secondOrder },
    ]);
    expect(work.get('abebe')).toEqual({ stage: 'delivering', orderReference: '#3F2A9C' });
    expect(work.get('kebede')).toEqual({ stage: 'to_pickup', orderReference: '#7B1D4E' });
  });

  it('leaves a driver without open stops out', () => {
    expect(currentWork([]).size).toBe(0);
  });
});
