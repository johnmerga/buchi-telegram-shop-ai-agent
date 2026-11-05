import { describe, expect, it } from 'vitest';
import { parseSuggestions, unsupportedNumbers } from './suggestions.domain';

const rule = { type: 'delivery_settings', deliverySettings: { ratePerKm: '22' } };

describe('parseSuggestions', () => {
  it('reads the JSON reply, also inside code fences', () => {
    const reply = JSON.stringify({ suggestions: [{ text: 'Far trips lose money.', rule }] });
    expect(parseSuggestions(reply)).toEqual([{ text: 'Far trips lose money.', rule }]);
    expect(parseSuggestions(`\`\`\`json\n${reply}\n\`\`\``)).toHaveLength(1);
  });

  it('refuses malformed output and more than three suggestions', () => {
    expect(parseSuggestions('Raise your prices.')).toBeUndefined();
    const four = Array.from({ length: 4 }, () => ({ text: 'Far trips lose money.', rule }));
    expect(parseSuggestions(JSON.stringify({ suggestions: four }))).toBeUndefined();
  });
});

describe('unsupportedNumbers', () => {
  const findings = JSON.stringify({
    deliveryMargins: {
      rows: [{ distance: 'over 10 km', deliveries: 12, average_margin: '-60.00' }],
    },
  });

  it('accepts numbers the analysis returned, in any spelling', () => {
    expect(unsupportedNumbers('12 trips over 10 km lost 60 birr each.', findings)).toEqual([]);
  });

  it('names every number the analysis did not return', () => {
    expect(unsupportedNumbers('12 trips lost 75 birr; raise it to 22.', findings)).toEqual([
      '75',
      '22',
    ]);
  });
});
