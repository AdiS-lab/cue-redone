# Verified Knowledge

## Claude API from the hub (@anthropic-ai/sdk 0.131.0, verified 2026-10-06 against the SDK types; no key in the sandbox, so not run live)

- `client.messages.stream({...}, { signal })`, iterate events, `content_block_delta` + `delta.type === "text_delta"`; `await stream.finalMessage()` for `stop_reason` / `model`.
- `output_config: { effort: "low" }` type-checks on `messages.stream` params.
- Refusal fallback: `client.beta.messages.stream({ ..., betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })` (`BetaFallbacksParam = Array<BetaFallbackParam> | "default"`). Used for the Opus "more" request.
- Model ids used: `claude-haiku-4-5` (look/ask, no thinking param), `claude-opus-5-5` (more; thinking can't be disabled, effort is the lever).
- Image block: `{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }`. Claude downscales images above ~1.15 MP, so the browser sends ≤ 1280 px on the long side.
- `system` with `cache_control: { type: "ephemeral" }` only caches if the prefix reaches the model's minimum cacheable length; the Qu system prompt is probably shorter, so expect no cache hits until measured.

## Same-view fingerprint (measured 2026-10-06 by scripts/e2e.mjs on 12 test-images, headless Chromium)

- 64-bit dHash on a 9x8 grid: a 2-3 % shift + 10 % brightness flipped 8-23 bits; different images differed by 20-23+ bits. Unusable for re-points even with block-averaged downscaling.
- 32x24 block-averaged grayscale + normalised cross-correlation at the best of ±3 px shifts: same view 0.98-0.99, different images ≤ 0.54. Threshold 0.9 plus a quadrant colour check (same view ≤ 19.3 mean RGB difference; threshold 28).

## Browser

- SpeechSynthesis: `speak(utterance)` is async and fires `onend`; `cancel()` stops; may need a prior user gesture. Some systems never fire `onend`, so `speak.ts` has a safety timeout.
- Speech recognition: `webkitSpeechRecognition` in Chrome (sends audio to Google's service, needs network); absent in Firefox. Headless Chromium has no usable recognition; the e2e deletes it to exercise the typed fallback.
- MediaSource with `audio/mpeg` works in the Playwright Chromium build (headless): appending fetch-body chunks of a streamed mp3 starts playback on the first chunk (measured 23 ms after queueing vs ≥ 1.2 s for blob-then-play with an 8 x 150 ms mock stream).
- A `canvas.captureStream()` only emits frames when the canvas is repainted: a fake webcam must redraw continuously or the frame buffer keeps stale frames.

## Tailwind v4 with Vite

- Plugin `@tailwindcss/vite`; `@import "tailwindcss";` in index.css; no config file

## Testing in the agent sandbox

- `npm install` fails in onnxruntime-node's postinstall (blocked download) when transformers.js is a dependency; it no longer is. Use `npm install --ignore-scripts` if it comes back.
- Headless Chromium: `/opt/pw-browsers/chromium`, launch with `--no-proxy-server` for localhost-only tests.
- Fake webcam: override `navigator.mediaDevices.getUserMedia` to return `canvas.captureStream()` of a repainted canvas (`scripts/e2e.mjs`).
- `spawn("npx", ["tsx", ...])` starts a child node process; kill the process group (`detached: true`, `process.kill(-pid)`) or the hub keeps running.
- Hugging Face, ElevenLabs and GitHub release downloads are blocked by the egress proxy; api.anthropic.com is reachable.

## ElevenLabs (verified 2026-10-03 with a restricted key)

- Auth header `xi-api-key`; secret keys are `sk_` + 51 chars total. The key *ID* shown in the dashboard is rejected (`api_key_id_used_as_api_key`); a wrong length gives `invalid_api_key_length`.
- TTS: `POST /v1/text-to-speech/{voice_id}[/stream]?output_format=mp3_44100_64`, body `{text, model_id}`. Models `eleven_flash_v2_5`, `eleven_v3` both work; v3 accepts `[laughs]`.
- Latency from the dev laptop: first byte 0.25 s via the hub on a warm connection, 0.8-1.4 s cold. `src/lib/speaker.ts` therefore fetches the next sentences' audio while the current one plays.
- Instant clone: `POST /v1/voices/add` multipart `name` + `files` (+ `remove_background_noise`) -> `{voice_id, requires_verification}`.
- Scribe realtime: `POST /v1/single-use-token/realtime_scribe` returned a token; model id `scribe_v2_realtime`.
- A restricted key can lack `user_read` (`/v1/user/subscription` returns 401) and still do TTS/voices.

## Removed on-device recognition (history, see git before 2026-10-06)

- MediaPipe: float16 EfficientDet on GPU worked; int8 detector returned 0 detections on GPU; int8 EfficientNet classifier threw on GPU.
- SigLIP 2 (q4f16 vision) named objects in ~0.1 s on WebGPU but could not tell fine object states (empty/full, open/closed, on/off) at 224 px; coarse situations ("held in a hand") separated well.
