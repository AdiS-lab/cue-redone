# src/vision

Camera and ring-button code for Qu. It is split so hardware can change without touching the rest of the app:

```
sources/        camera input (FrameSource): webcam, Wi-Fi/WebSocket, Bluetooth still, files
input/          ring button input (ButtonInput): keyboard, WebSocket, Bluetooth + feedback output
core/           image helpers with no hardware imports (sharpness, frame buffer)
settings.ts     which source/button is used, burst size, per-source+hand orientation
useVisionIO.ts  React hooks that start/stop the chosen source and button inputs
```

## Camera sources

Every camera implements `FrameSource` (`sources/types.ts`):

| Member | Meaning |
|---|---|
| `mode` | `"stream"` (continuous frames, live preview + tracking) or `"still"` (pictures on button press) |
| `start()` / `stop()` | Open / close the connection. Safe to call repeatedly. |
| `onFrame(cb)` | Stream mode. `cb(frame, time)` receives an `ImageBitmap` it now owns (and must close). |
| `capture()` | One picture. Must reject or time out instead of hanging. |
| `captureBurst(n)` | Optional. Several pictures from one press; may return fewer than `n`. |
| `status()` / `onStatus(cb)` | `idle / connecting / live / reconnecting / error` plus a message for the user. |
| `pair()` | Optional; for sources that need a click to connect (Bluetooth). |

Callers use `captureFrames(source, { count, discard, delayMs })`. It waits `delayMs` after the press (lets the hand settle), asks for `count + discard` pictures, and drops the first `discard` (small camera modules often return dark or off-color frames right after waking). It uses `captureBurst` when the source has it and falls back to a single `capture()` otherwise; it never discards the last remaining frame, so single-image hardware keeps working.

The real ring keeps its camera off until the button is pressed, so **still mode is the primary path**; the webcam stream is for development and demos. Nothing in still mode assumes frames exist from before the press.

| Source | File | Notes |
|---|---|---|
| Webcam / USB camera | `WebcamSource.ts` | getUserMedia; reconnects when the camera is unplugged |
| Wi-Fi camera | `WebSocketSource.ts` | One JPEG per binary message. Stream: board pushes frames. Still: see protocol below. |
| Bluetooth ring | `BleStillSource.ts` | Still only; see protocol below |
| Image files | `FileSource.ts` | Still; pick images, or pass Blobs/URLs (a nested array is one burst). Used by tests and eval. |

### Bursts

In still mode one press can return several JPEGs (taken in quick succession, or the best few from an on-device buffer just before the press). Every frame is oriented, scored with `core/sharpness.ts` (variance of the Laplacian on a 160 px grayscale copy of the central 60 %), and the sharpest is shown and sent. Transfer stops at whichever comes first:

- the requested count arrives;
- the board signals the end of the burst;
- no new image for `max(gap, 1.5 × slowest gap so far)` (600 ms Wi-Fi, 1.5 s Bluetooth), which covers firmware that ignores the count;
- the total timeout (5 s Wi-Fi, 8 s Bluetooth). A partial burst is used; zero images is reported to the user as an error.

"Photos per press" (1–5, default 3, `?burst=N`) trades blur robustness against press-to-answer latency. "Skip first photos" (0–3, default 1, `?discard=N`) and "Wait after press" (0–3000 ms, default 0, `?delay=MS`) are next to it in the panel.

`FileSource` can simulate a ring burst from one still image: `?source=file&simwake=1&simwakems=300&simframems=150&simshake=2` adds 1 dark/off-color wake frame, 300 ms camera wake-up, 150 ms per photo transfer, and press shake (blur strongest right after the press, then settling: `SHAKE_PATTERN`). The same fields are in the panel when "Image files" is selected.

### Stream mode: frame buffer (webcam / dev path)

Stream sources keep the last 10 upright frames in `core/frameBuffer.ts` with their timestamp. On a button press, frames from the last 50 ms are skipped (the press itself shakes the camera), the rest are scored with the same sharpness measure as still bursts, and the best one is used (`components/Viewfinder.tsx`). If the stream has sent nothing for 1.5 s its buffer is stale and a still capture is tried instead. The preview freezes on the chosen frame for 1.2 s so you see what was sent.

### Choosing a source

One place: `settings.ts`. The "Camera & ring" panel under the camera saves to localStorage; URL parameters override it:

```
?source=webcam|ws|ble|file
&url=ws://192.168.4.1:81/     WebSocket camera URL
&mode=stream|still             WebSocket frame mode
&burst=1..5                    photos per press (still mode)
&discard=0..3                  drop the first N photos of each burst (default 1)
&delay=0..3000                 ms to wait after the press before capturing
&simwake=N&simwakems=MS&simframems=MS&simshake=X   file-source ring simulation
&button=none|ws|ble            ring button connection (keyboard always works)
&buttonUrl=ws://...            if the button uses a different socket than the camera
&hand=right|left
&rotate=0|90|180|270&flip=1    orientation override for this source + hand
&beep=0|1                      local tick/vibrate on press (default on)
```

### Orientation

Every frame goes through `orientFrame()` (`sources/orient.ts`) before anything else sees it, so the photo sent to Claude is upright. Settings are stored per source and per hand (`ws:left`, `ble:right`, …). The hand presets in `HAND_PRESETS` (right = upright, left = 180°) are guesses until the ring is built; adjust them once the camera is mounted. The preview's "Mirror" button is display-only and separate from "Flip image".

## Ring button

| Gesture | Qu does | Keyboard |
|---|---|---|
| click | look: explain what the ring points at | Space |
| hold | ask: photo now, then a spoken question | H |
| double | more about the last look | D |

The gesture is decided where the button is (the firmware for the ESP32-CAM ring, `firmware/qu-ring/`), and the app handles it in `src/lib/useQu.ts`.

Every button implements `ButtonInput` (`input/types.ts`): `start(handler)`, `stop()`, optional `status/onStatus`, `pair()`, and `feedback(kind)` for buzz/beep output (`on-target`, `captured`, `highlight`, `select`, `error`). `InputHub` runs the keyboard plus at most one ring button and sends feedback to all of them.

## Wire protocols

### Wi-Fi (WebSocket)

| Direction | Message |
|---|---|
| board → browser, binary | one complete JPEG |
| browser → board | `{"type":"capture","count":3}` (still mode) |
| board → browser | `{"type":"burst-end"}` after the last JPEG of a burst (optional but saves the gap wait) |
| board → browser | `click` / `double` / `hold`, or `{"type":"button","action":"click"}` |
| browser → board | `{"type":"feedback","kind":"select"}` |

Camera and button may share one socket (same URL); `wsLink.ts` reference-counts it. The ESP32-CAM firmware (`firmware/qu-ring/`) implements this side of the protocol and connects to the hub's `/phone` endpoint; the hub relays it to browsers on `/ring`, so the browser uses `?source=ws&url=ws://localhost:8787/ring&mode=still&button=ws`.

### Bluetooth

`sources/bleLink.ts` → `RING_BLE`. **All UUIDs are placeholders** (`isPlaceholder: true`); replace them with the firmware's values.

| Characteristic | Direction | Content |
|---|---|---|
| `imageControl` | write | `0x01 N` = take N pictures |
| `imageData` | notify | per JPEG: `0xA0` + uint32 LE length + bytes, then `0xA1` + bytes … ; `0xA2` = end of burst |
| `button` | notify | `0x01` click, `0x02` double, `0x03` hold |
| `feedback` | write | 1 on-target, 2 captured, 3 highlight, 4 select, 5 error |

If the firmware pushes pictures on its own when the button is pressed, `captureBurst()` uses those (if under 1.5 s old) instead of requesting more. Pair once with the "Pair ring" button (Chrome requires a click); it reconnects automatically after drop-outs.

## Testing without hardware

```bash
npm test                                                           # unit tests
npm run e2e                                                        # whole app in headless Chromium, incl. a fake ring
node scripts/fake-ring.mjs --hub ws://localhost:8787/phone         # the firmware's side, through the hub
node scripts/mock-ring.mjs --dir test-images --port 8181           # Wi-Fi ring, streaming
node scripts/mock-ring.mjs --dir test-images --port 8181 --still   # one burst per capture request
```

With `fake-ring`, open `http://localhost:5173/?source=ws&url=ws://localhost:8787/ring&mode=still&button=ws` and type `c` / `d` / `h` (+ Enter) to press, `n` to point at the next image. With `mock-ring`, open `http://localhost:5173/?source=ws&url=ws://localhost:8181/&button=ws` (add `&mode=still` for still mode) and type `c`, `d` or `h` + Enter in the mock's terminal to press the ring button. Mock options: `--frame-delay MS` (simulate slow transfer), `--single` (firmware that ignores burst count), `--sequential` (cycle through images), `--drop-after N` (drop the connection to test reconnects).

## Connecting new hardware

Nothing outside `src/vision/` imports hardware code: the app takes an upright image. A new ring only needs a source (camera), maybe a button, and orientation.

1. **Camera.** Add `sources/MyRingSource.ts` implementing `FrameSource` (`sources/types.ts`). For a networked board copy `WebSocketSource.ts`; for Bluetooth copy `BleStillSource.ts` and put the real UUIDs in `RING_BLE` (`bleLink.ts`). Set `mode` to `"still"` if the camera only takes pictures on a press (implement `capture()` and ideally `captureBurst(n)`), or `"stream"` if it pushes frames (`onFrame`). Report connection state with `StatusEmitter` (`connecting / live / reconnecting / error`), reconnect on drop-outs without a reload, and use `collectBurst` / `withTimeout` so a capture rejects instead of hanging.
2. **Button.** If the button comes over a different link, add a class to `input/inputs.ts` implementing `ButtonInput` that turns the hardware's events into `click` / `double` / `hold`. If the ring can buzz or beep, implement `feedback(kind)` (`on-target`, `captured`, `highlight`, `select`, `error`) on the source or the button. Keyboard (Space / D / H) always keeps working.
3. **Register it** in three places: `SourceKind` in `sources/types.ts`, `SOURCE_KINDS` in `settings.ts`, and `createSource()` in `sources/index.ts` (buttons: the switch in `useVisionIO.ts`).
4. **Select it** in the "Camera & ring" panel or with `?source=<kind>` (plus e.g. `&url=`, `&mode=still`, `&button=`).
5. **Orientation.** Mount the ring, open the preview, and set "Rotate" / "Flip image" in the panel until the picture is upright (or `?rotate=90&flip=1`). This is saved per source and per hand; update `HAND_PRESETS` in `sources/orient.ts` once you know how the ring sits on each hand.
6. **Check it.** Compare against the reference protocol with `scripts/fake-ring.mjs` / `scripts/mock-ring.mjs`, then point at a few things; `[qu]` console lines show time to first sentence and the hub's time to first token.
