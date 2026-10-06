# Current State

## Objective

Qu as a camera ring (brief: `AGENT_SESSION.md`; decisions: `.agent/decisions.md` 2026-10-06). Branch `claude/awesome-archimedes-kqjobu`.

## Done (2026-10-06)

- AAC, vocabulary/SigLIP/MediaPipe, Photon messaging, QR, contacts removed.
- Hub `POST /look` (server/look.ts, server/prompt.ts): Claude vision streamed as SSE; Haiku 4.5 for look/ask, Opus 5.5 (low effort, refusal fallback) for more; `LOOK_MOCK=1` mock.
- Browser loop `src/lib/useQu.ts`: click=look, hold=ask (speech recognition, typed fallback), double=more; quality gate; same-view cache with background re-check; session notebook + goal in every request; offline pending + retry; sentence-by-sentence speech (`speaker.ts`, ElevenLabs prefetch or browser voice).
- Firmware `firmware/qu-ring/` (ESP32-CAM + Grove button) and `scripts/fake-ring.mjs` (same protocol from Node).

## Last verification

`npm run build`, `npm test` (52), `npm run lint` (0 warnings), `npm run typecheck:server`, `npm run e2e` (37/37: look, replay, correction, ask, hold typed fallback, more, goal, dark refusal, hub down + recovery, reload, end session, ring click/double through the hub, streamed hub voice starts before the download ends).

## Not verified

- Real Claude answers, their quality and latency (no ANTHROPIC_API_KEY in the sandbox).
- ElevenLabs itself (no key): the streamed-playback path is verified against the hub's VOICE_MOCK_FILE mock, the upstream call is unchanged from before.
- Firmware: no ESP32 build (no Arduino toolchain reachable) and not run on hardware. `npm run firmware:check` type-checks it against stub headers of the published APIs and simulates the button gestures (7 cases pass). Low-light JPEG-size threshold, focus and timings are starting points.
- Real speech recognition, real webcam, audio output.

## Next

- With a key: run 20-30 real looks (labels, rooms, products), check headline quality, `[qu] firstSentenceMs`, adjust the prompt.
- Flash the ring; tune DOUBLE_GAP_MS / HOLD_MS / LOW_LIGHT_JPEG_BYTES; set HAND_PRESETS for the mount.
- `phone/` still contains the old contacts/say screens; trim to the ring stand-in.
