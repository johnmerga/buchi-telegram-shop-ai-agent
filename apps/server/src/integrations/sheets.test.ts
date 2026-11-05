import { describe, expect, it } from 'vitest';
import { urlOf } from '../../test/fakes/fetch';
import { GoogleSheets } from './sheets';

function sheetsAnswering(body: unknown, status = 200) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push({ url: urlOf(input), init });
    return Promise.resolve(Response.json(body, { status }));
  };
  return { sheets: new GoogleSheets(() => Promise.resolve('access-1'), fetch), requests };
}

describe('GoogleSheets', () => {
  it('reads the first column of a tab with the access token', async () => {
    const { sheets, requests } = sheetsAnswering({ values: [['Buchi ID', 'sale-a']] });
    await expect(sheets.firstColumn('sheet-1', 'Sales')).resolves.toEqual(
      new Set(['Buchi ID', 'sale-a']),
    );
    expect(requests[0]?.url).toBe(
      'https://sheets.googleapis.com/v4/spreadsheets/sheet-1/values/Sales!A%3AA?majorDimension=COLUMNS',
    );
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe('Bearer access-1');
  });

  it('reads an empty tab as no keys', async () => {
    const { sheets } = sheetsAnswering({ range: 'Sales!A1:A1000' });
    await expect(sheets.firstColumn('sheet-1', 'Sales')).resolves.toEqual(new Set());
  });

  it('appends rows as raw values, so text is never run as a formula', async () => {
    const { sheets, requests } = sheetsAnswering({});
    await sheets.append('sheet-1', 'Daily', [['day-2026-11-05', '=1+1', 3500]]);
    const [request] = requests;
    expect(request?.url).toBe(
      'https://sheets.googleapis.com/v4/spreadsheets/sheet-1/values/Daily!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    );
    expect(request?.init?.method).toBe('POST');
    expect(JSON.parse(typeof request?.init?.body === 'string' ? request.init.body : '')).toEqual({
      values: [['day-2026-11-05', '=1+1', 3500]],
    });
  });

  it('names Google’s reason when it refuses, so the owner can fix the sharing', async () => {
    const { sheets } = sheetsAnswering(
      { error: { code: 403, message: 'The caller does not have permission' } },
      403,
    );
    await expect(sheets.firstColumn('sheet-1', 'Sales')).rejects.toThrow(
      'Google Sheets answered 403: The caller does not have permission',
    );
  });
});
