import { useRef } from 'react';

export type PressAction = 'click' | 'double' | 'hold';

const DOUBLE_MS = 300;

/**
 * One big button, three gestures: tap = click, double tap = double, long press = hold.
 * Like the ring firmware, a tap is sent at once and a second tap within DOUBLE_MS adds "double";
 * the app then gives "more" about the look the first tap started, so no tap waits for the double-tap window.
 */
export function useRingButton(send: (a: PressAction) => void) {
  const lastTap = useRef(0);
  return {
    onTap() {
      const now = Date.now();
      if (now - lastTap.current <= DOUBLE_MS) {
        lastTap.current = 0;
        send('double');
        return;
      }
      lastTap.current = now;
      send('click');
    },
    onHold() {
      lastTap.current = 0;
      send('hold');
    },
  };
}
