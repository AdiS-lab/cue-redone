# Qu ring firmware (ESP32-CAM)

The ring is an AI-Thinker ESP32-CAM (OV2640) plus a Grove button. It joins your Wi-Fi, connects to the Qu hub
(`npm run hub` on a computer on the same network) at `ws://<hub>:8787/phone`, and the hub relays it to the
browser. Untested on hardware so far: treat pins, timings and the low-light threshold as starting points.

## Wiring

| Grove button | ESP32-CAM |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SIG | GPIO 13 |

GPIO 13 is one of the SD card pins, free when no card is inserted. The red LED on the back blinks for feedback;
an optional Grove buzzer can go on another free pin (`BUZZER_PIN`).

## Build

1. Arduino IDE: install the **esp32** board package and the **WebSockets** library by Markus Sattler.
2. Board: *AI Thinker ESP32-CAM*, PSRAM enabled.
3. `cp secrets.example.h secrets.h` and fill in Wi-Fi and the hub's LAN address (the hub prints it).
4. Flash with a USB-serial adapter (GPIO 0 to GND while resetting).

## Check without hardware

`npm run firmware:check` type-checks the sketch with host `g++` against stub headers that mirror the published
Arduino / arduinoWebSockets / esp32-camera APIs, and simulates the button state machine (click, click-then-double,
hold, debounce). It is not an ESP32 build.

## Use it with the browser

Open the app, expand **Camera & ring**, and choose:

- Camera source: *Wi-Fi camera (WebSocket)*, URL `ws://localhost:8787/ring`, Frames: *One photo per press*
- Ring button: *Wi-Fi*, same URL

or open `http://localhost:5173/?source=ws&url=ws://localhost:8787/ring&mode=still&button=ws`.

| Gesture | Sent | Qu does |
|---|---|---|
| press | `click` (the moment you let go) | look |
| press twice | `click`, then `double` | look, then more about it (the app reuses the first press's photo) |
| hold 0.55 s | `hold` (while still held) | ask: speak your question |

## Notes

- **Focus.** The stock OV2640 lens is fixed focus. Twist it (after cutting the glue dab) so things 20-30 cm away are
  sharp; that's the distance you point at labels from. An OV5640 autofocus module works with the same driver.
- **Light.** If the first frame of a burst is tiny (dark scenes compress well), the flash LED switches on and the frame
  is retaken. Tune `LOW_LIGHT_JPEG_BYTES` from the sizes printed on the serial console.
- **Latency.** The camera stays on between presses and Wi-Fi power save is off, so a capture is one frame time plus
  upload. Clicks are sent on release without waiting for a possible second press (`CLICK_FIRST`); set it to 0 for
  firmware-side click/double disambiguation at the cost of `DOUBLE_GAP_MS` on every click.
- **Power.** Always-on camera and Wi-Fi draw roughly 150-250 mA. Fine for a tethered prototype; a battery ring would
  need light sleep between presses (costing wake-up time on the first frame).
