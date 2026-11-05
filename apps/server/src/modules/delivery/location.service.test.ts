import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { LocationService, type RedirectReader } from './location.service';

const logger = pino({ level: 'silent' });

function serviceFollowing(targets: Record<string, string>) {
  const read: string[] = [];
  const redirects: RedirectReader = {
    target: (url) => {
      read.push(url);
      return Promise.resolve(targets[url]);
    },
  };
  return { service: new LocationService(redirects, logger), read };
}

describe('LocationService', () => {
  it('reads the pin from the target of a short link', async () => {
    const { service } = serviceFollowing({
      'https://maps.app.goo.gl/abc':
        'https://www.google.com/maps/place/Edna+Mall/@8.99,38.78,17z/data=!3d8.9970566!4d38.7866129',
    });
    await expect(service.fromText('https://maps.app.goo.gl/abc')).resolves.toEqual({
      status: 'found',
      coordinates: { latitude: 8.9970566, longitude: 38.7866129 },
    });
  });

  it('follows a short link that leads to another short link', async () => {
    const { service, read } = serviceFollowing({
      'https://goo.gl/maps/old': 'https://maps.app.goo.gl/new',
      'https://maps.app.goo.gl/new': 'https://maps.google.com/?q=9.01,38.76',
    });
    await expect(service.fromText('https://goo.gl/maps/old')).resolves.toMatchObject({
      status: 'found',
    });
    expect(read).toEqual(['https://goo.gl/maps/old', 'https://maps.app.goo.gl/new']);
  });

  it('asks for a pin when the target has no coordinates', async () => {
    const { service } = serviceFollowing({
      'https://maps.app.goo.gl/abc': 'https://www.google.com/maps/search/Edna+Mall',
    });
    await expect(service.fromText('https://maps.app.goo.gl/abc')).resolves.toEqual({
      status: 'ask_for_pin',
      reason: 'no_coordinates',
    });
  });

  it('asks for a pin when a short link leads somewhere other than a map', async () => {
    const { service } = serviceFollowing({
      'https://maps.app.goo.gl/abc': 'https://consent.google.com/ml?continue=x',
    });
    await expect(service.fromText('https://maps.app.goo.gl/abc')).resolves.toMatchObject({
      status: 'ask_for_pin',
    });
  });

  it('asks for a pin when a short link does not redirect', async () => {
    const { service } = serviceFollowing({});
    await expect(service.fromText('https://maps.app.goo.gl/gone')).resolves.toMatchObject({
      status: 'ask_for_pin',
    });
  });

  it('stops after three redirects', async () => {
    const { service, read } = serviceFollowing({
      'https://maps.app.goo.gl/a': 'https://maps.app.goo.gl/b',
      'https://maps.app.goo.gl/b': 'https://maps.app.goo.gl/c',
      'https://maps.app.goo.gl/c': 'https://maps.app.goo.gl/d',
      'https://maps.app.goo.gl/d': 'https://maps.google.com/?q=9.01,38.76',
    });
    await expect(service.fromText('https://maps.app.goo.gl/a')).resolves.toMatchObject({
      status: 'ask_for_pin',
    });
    expect(read).toHaveLength(3);
  });

  it('asks for a pin when the short link cannot be read', async () => {
    const service = new LocationService(
      { target: () => Promise.reject(new Error('network down')) },
      logger,
    );
    await expect(service.fromText('https://maps.app.goo.gl/abc')).resolves.toMatchObject({
      status: 'ask_for_pin',
    });
  });

  it('reads coordinates without any lookup', async () => {
    const { service, read } = serviceFollowing({});
    await expect(service.fromText('9.01, 38.76')).resolves.toMatchObject({ status: 'found' });
    expect(read).toEqual([]);
  });
});
