import { describe, expect, it } from 'vitest';
import links from './fixtures/maps-links.json';
import { checkPin, readLocationText } from './location.domain';

describe('readLocationText', () => {
  it.each(links.withCoordinates)('reads $name', ({ text, latitude, longitude }) => {
    expect(readLocationText(text)).toEqual({
      status: 'found',
      coordinates: { latitude, longitude },
    });
  });

  it.each(links.withoutCoordinates)('asks for a pin for %s', (text) => {
    expect(readLocationText(text)).toEqual({ status: 'ask_for_pin', reason: 'no_coordinates' });
  });

  it.each(links.shortLinks)('hands a short link on to be resolved: %s', (text) => {
    expect(readLocationText(text)).toMatchObject({ status: 'short_link' });
  });

  it('keeps only the link from a message with a short link', () => {
    expect(readLocationText('Here it is: https://goo.gl/maps/AbCdEf123')).toEqual({
      status: 'short_link',
      url: 'https://goo.gl/maps/AbCdEf123',
    });
  });

  it.each(links.notLocations)('ignores %s', (text) => {
    expect(readLocationText(text)).toEqual({ status: 'not_a_location' });
  });

  it.each(['9.01, 38.76', '9.01,38.76', ' 9.01 38.76 '])('reads plain coordinates "%s"', (text) => {
    expect(readLocationText(text)).toEqual({
      status: 'found',
      coordinates: { latitude: 9.01, longitude: 38.76 },
    });
  });

  it('rejects coordinates with latitude and longitude swapped', () => {
    expect(readLocationText('38.76, 9.01')).toEqual({
      status: 'ask_for_pin',
      reason: 'outside_ethiopia',
    });
  });

  it('rejects a Maps link outside Ethiopia', () => {
    expect(readLocationText('https://maps.google.com/?q=51.5072,-0.1276')).toEqual({
      status: 'ask_for_pin',
      reason: 'outside_ethiopia',
    });
  });
});

describe('checkPin', () => {
  it('accepts points in Addis Ababa and at the edges of Ethiopia', () => {
    for (const point of [
      { latitude: 9.01, longitude: 38.76 },
      { latitude: 3.3, longitude: 32.9 },
      { latitude: 15, longitude: 48.1 },
    ]) {
      expect(checkPin(point)).toEqual({ status: 'found', coordinates: point });
    }
  });

  it('rejects points just outside the box', () => {
    for (const point of [
      { latitude: 3.29, longitude: 38 },
      { latitude: 15.01, longitude: 38 },
      { latitude: 9, longitude: 32.89 },
      { latitude: 9, longitude: 48.11 },
    ]) {
      expect(checkPin(point)).toEqual({ status: 'ask_for_pin', reason: 'outside_ethiopia' });
    }
  });
});
