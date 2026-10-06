# Project Context

## Name

Qu

## One-line purpose

A camera ring you point at things: press, and hear what matters about what you're pointing at, with answers that get smarter over a session.

## Current stage

prototype

## Stack

- Runtime: Node 20+ (hub), Chrome (app), ESP32 Arduino core (ring)
- Language: TypeScript; C++ (firmware)
- Frontend: React 19 + Vite 8 + Tailwind 4
- Backend: local hub (`server/`, Node + TypeScript): `/look` (Claude vision, streamed), `/voice/speak` (ElevenLabs), ring WebSocket relay
- Data: session notebook in the browser (`localStorage`), nothing server-side
- Deployment: none (local only)

## Architecture

1. **Capture**: ESP32-CAM ring (still photos on press, via the hub's `/phone` → `/ring` relay) or a webcam/Wi-Fi stream while developing (`src/vision/sources`).
2. **Press**: the ring's one button gives click / double / hold (`src/vision/input`); keyboard Space / D / H stand in.
3. **Gate + cache** (browser): sharpest frame, dark/blurry check, same-view fingerprint cache.
4. **Understand** (hub): photo + question + session notebook + goal → Claude vision, streamed as SSE.
5. **Speak** (browser): each sentence as soon as it is complete; ElevenLabs via the hub when configured, else SpeechSynthesis.
6. **Remember**: every answer becomes a notebook entry that later requests carry as context.

Data flow: press → photo → gate → (replay) → `/look` → sentences → speech → notebook

## Important directories

| Path | Purpose |
|---|---|
| `src/lib/` | Core loop (`useQu.ts`), streaming client, answer parsing, speaker, cache, notebook |
| `src/components/` | Viewfinder, notebook/answer UI, camera & ring settings |
| `src/vision/` | Camera sources and ring button inputs (hardware seam) |
| `server/` | Hub: Claude, ElevenLabs, ring relay |
| `firmware/qu-ring/` | ESP32-CAM + Grove button firmware |
| `phone/` | Expo app that can act as the ring |
| `scripts/` | e2e check, fake ring, mock ring |

## Important commands

```text
Install: npm install
Hub: npm run hub
Dev: npm run dev
Build: npm run build
Test: npm test && npm run e2e
Lint: npm run lint
```

## Environment

Configuration lives in `server/.env.local` (template: `server/.env.example`):

- `ANTHROPIC_API_KEY` — Claude for `/look` (required unless `LOOK_MOCK=1`)
- `LOOK_MODEL`, `DEEP_MODEL` — optional model overrides
- `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` — optional voice

Browser: `VITE_HUB_URL` if the hub is not on `http://<page host>:8787`.

Never put secret values here.

## Stable constraints

- No server-side ML. The hub only proxies API calls (so keys stay off the browser) and relays the ring.
- Ring hardware plugs in through `src/vision/` (`FrameSource`, `ButtonInput`) and the WebSocket protocol in `src/vision/README.md`.
- One button: click = look, hold = ask, double = more.
- Answers are spoken; the first line is a standalone headline of at most ~15 words.
- Describe people, never identify them.

## Explicit non-goals

- AAC / sentence building, messaging (removed 2026-10-06)
- Health records and medication checking as a product (the ring may read a medicine label like any other label)
- Always-on video or continuous capture from the ring
- On-device vision-language models
- Production deployment, user accounts, cross-device sync
