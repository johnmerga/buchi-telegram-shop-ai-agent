import { describe, expect, it } from 'vitest';
import { driverInviteSchema } from './drivers';

describe('driverInviteSchema', () => {
  it('stores a username in lowercase without the "@"', () => {
    expect(driverInviteSchema.parse({ username: ' @Abebe_Rides ' })).toEqual({
      username: 'abebe_rides',
    });
  });

  it.each(['abc', '1abebe', 'abebe-rides', `a${'b'.repeat(32)}`])('rejects %s', (username) => {
    expect(driverInviteSchema.safeParse({ username }).success).toBe(false);
  });
});
