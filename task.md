# Active Task

## Objective

Turn Qu into a camera ring: point the ESP32-CAM ring at something, press, and hear what matters about it, with context that accumulates over the session. Brief: `AGENT_SESSION.md`. Decisions: `.agent/decisions.md` (2026-10-06).

## Required behavior

1. Click: photo → spoken explanation, headline first, in under ~2 s to first word with a real key.
2. Hold: photo + spoken question (typed fallback where speech recognition is missing).
3. Double: deeper answer about the last look, even while the previous answer is still playing.
4. Dark or blurry photos are refused on device with advice, without a network call.
5. Pointing at the same thing again replays the answer instantly and re-checks it.
6. Every answer goes into a session notebook that later requests carry; a spoken goal shapes answers.
7. Hub down: say so, keep the photo, answer it when the hub returns.
8. Works with the ring over Wi-Fi through the hub, and with a webcam for development.

## Acceptance criteria

- [x] AAC features, vocabulary/SigLIP/MediaPipe and messaging removed
- [x] Hub `/look` streams Claude's answer (SSE); key stays on the hub
- [x] Sentences spoken as they arrive; meta line never spoken
- [x] Quality gate, same-view cache, notebook context, goal, offline retry
- [x] Click / double / hold from keyboard and from a ring speaking the firmware protocol
- [x] Firmware sketch for ESP32-CAM + Grove button
- [x] `npm run build`, `npm test`, `npm run lint`, `npm run e2e` pass
- [ ] Real Claude answers checked for quality and latency (needs `ANTHROPIC_API_KEY`)
- [ ] Firmware compiled and run on the ESP32-CAM; focus, low-light threshold and gesture timing tuned
- [ ] ElevenLabs streaming checked with a key

## Verification

```bash
npm run build && npm test && npm run lint && npm run e2e
LOOK_MOCK=1 npm run hub   # + npm run dev, then press Space in Chrome
```
