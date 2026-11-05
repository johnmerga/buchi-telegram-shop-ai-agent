export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Why Buchi asks the customer to send a pin instead. */
export type PinProblem = 'no_coordinates' | 'outside_ethiopia';

export type PinResult =
  { status: 'found'; coordinates: Coordinates } | { status: 'ask_for_pin'; reason: PinProblem };

/** What a chat message says about a location, before any network lookup. */
export type LocationText =
  | PinResult
  /** A short Google Maps link: its coordinates are in the redirect target. */
  | { status: 'short_link'; url: string }
  | { status: 'not_a_location' };

/** A generous box around Ethiopia. Points outside it are typos or swapped coordinates. */
const ETHIOPIA = { south: 3.3, north: 15, west: 32.9, east: 48.1 };

const NUMBER = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
/** A whole message such as "9.01, 38.76" or "9.01 38.76". */
const PLAIN_COORDINATES = new RegExp(String.raw`^\s*${NUMBER}\s*[,\s]\s*${NUMBER}\s*$`);
const PAIR = new RegExp(String.raw`^${NUMBER}\s*,\s*${NUMBER}$`);
/** The place's own pin inside the `data=` part of a Google Maps URL. */
const PLACE_PIN = new RegExp(String.raw`!3d${NUMBER}!4d${NUMBER}`);
/** The map's center in the path, such as `/@9.01,38.76,17z`. */
const MAP_CENTER = new RegExp(String.raw`/@${NUMBER},${NUMBER}`);
const URL_IN_TEXT = /https?:\/\/\S+/;
/** Query parameters that Google Maps URLs use for a point, in order of preference. */
const POINT_PARAMETERS = ['q', 'query', 'destination', 'daddr', 'll', 'center'];

/** Accepts a point only if it lies in Ethiopia. */
export function checkPin(coordinates: Coordinates): PinResult {
  const { latitude, longitude } = coordinates;
  const inside =
    latitude >= ETHIOPIA.south &&
    latitude <= ETHIOPIA.north &&
    longitude >= ETHIOPIA.west &&
    longitude <= ETHIOPIA.east;
  return inside
    ? { status: 'found', coordinates }
    : { status: 'ask_for_pin', reason: 'outside_ethiopia' };
}

/** Reads coordinates or a Google Maps link from a customer's message. */
export function readLocationText(text: string): LocationText {
  const plain = PLAIN_COORDINATES.exec(text);
  if (plain) return checkPin(toCoordinates(plain[1], plain[2]));

  const url = parseUrl(URL_IN_TEXT.exec(text)?.[0]);
  if (!url) return { status: 'not_a_location' };
  if (isShortMapsLink(url)) return { status: 'short_link', url: url.toString() };
  if (!isMapsUrl(url)) return { status: 'not_a_location' };
  return readMapsUrl(url);
}

/** Reads the point from a full Google Maps URL, such as a short link's redirect target. */
function readMapsUrl(url: URL): PinResult {
  const coordinates = placePin(url) ?? pointParameter(url) ?? mapCenter(url);
  return coordinates ? checkPin(coordinates) : { status: 'ask_for_pin', reason: 'no_coordinates' };
}

function isShortMapsLink(url: URL): boolean {
  return (
    url.hostname === 'maps.app.goo.gl' ||
    (url.hostname === 'goo.gl' && url.pathname.startsWith('/maps/'))
  );
}

function isMapsUrl(url: URL): boolean {
  const host = url.hostname.replace(/^www\./, '');
  if (/^maps\.google\.[a-z.]+$/.test(host)) return true;
  return /^google\.[a-z.]+$/.test(host) && url.pathname.startsWith('/maps');
}

function placePin(url: URL): Coordinates | undefined {
  const match = PLACE_PIN.exec(url.pathname);
  return match ? toCoordinates(match[1], match[2]) : undefined;
}

function pointParameter(url: URL): Coordinates | undefined {
  for (const name of POINT_PARAMETERS) {
    const match = PAIR.exec(url.searchParams.get(name)?.trim() ?? '');
    if (match) return toCoordinates(match[1], match[2]);
  }
  return undefined;
}

function mapCenter(url: URL): Coordinates | undefined {
  const match = MAP_CENTER.exec(url.pathname);
  return match ? toCoordinates(match[1], match[2]) : undefined;
}

/** The regular expressions above always capture both groups when they match. */
function toCoordinates(latitude: string | undefined, longitude: string | undefined): Coordinates {
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

function parseUrl(text: string | undefined): URL | undefined {
  if (text === undefined || !URL.canParse(text)) return undefined;
  return new URL(text);
}
