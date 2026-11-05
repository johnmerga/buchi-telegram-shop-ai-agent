import type { Coordinates } from '@buchi/shared';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeTelegram, renderAt } from '../../test/fakes';
import PinPickerScreen from './pin-picker-screen';

// Leaflet needs a real layout engine, so the map is a stand-in that shows its pin.
vi.mock('../../components/map/lazy-maps', () => ({
  LazyPinPickerMap: ({ value }: { value: Coordinates }) => (
    <p data-testid="pin">
      {value.latitude},{value.longitude}
    </p>
  ),
}));

describe('customer map picker', () => {
  it('starts at the suggested place and sends the pin back to the chat', () => {
    const { mainButtonOnClick, sendData } = fakeTelegram({ initData: '' });
    renderAt('/pin?lat=9.02&lng=38.79', <PinPickerScreen />);

    expect(screen.getByTestId('pin').textContent).toBe('9.02,38.79');
    const [deliverHere] = mainButtonOnClick.mock.calls.at(-1) ?? [];
    deliverHere?.();
    expect(sendData).toHaveBeenCalledWith(JSON.stringify({ latitude: 9.02, longitude: 38.79 }));
  });

  it('ignores a suggestion outside the map’s range', () => {
    fakeTelegram({ initData: '' });
    renderAt('/pin?lat=123&lng=38.79', <PinPickerScreen />);
    expect(screen.getByTestId('pin').textContent).toBe('9.0108,38.7613');
  });
});
