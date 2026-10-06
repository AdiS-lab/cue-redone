# Qu

A camera ring you point at things. Press the button and Qu tells you, out loud, what matters about what you're
pointing at: it reads labels and signs, says what a product is and the one useful fact about it, describes a room.
It remembers what you've pointed at during the session, so a box in a pharmacy and the same box in a kitchen get
different answers, and you can ask later "what did that label say?".

Pointing and listening is faster than reading when your hands are busy, the light is bad, or audio just suits you.

| Ring gesture | Keyboard | What happens |
|---|---|---|
| press | Space | **Look**: explain what you're pointing at, headline first |
| hold | H | **Ask**: photo now, then speak a question ("is this vegan?", "when does it expire?") |
| press twice | D | **More**: a deeper answer about the last look |

Say "my goal is …" or "I'm shopping for …" while holding to set a goal that shapes every answer
("I'm allergic to nuts").

## Quick start

```bash
npm install
cp server/.env.example server/.env.local   # add ANTHROPIC_API_KEY (and optionally ELEVENLABS_API_KEY)
npm run hub                                 # terminal 1: the local hub on :8787
npm run dev                                 # terminal 2: the app on :5173
```

Open **Chrome** at http://localhost:5173, allow the camera, point at something and press Space.

No key yet? `LOOK_MOCK=1 npm run hub` streams a labelled mock answer so you can try the whole loop.

### With the ring

Flash `firmware/qu-ring/` onto an ESP32-CAM with a Grove button ([firmware/qu-ring/README.md](firmware/qu-ring/README.md)),
then open http://localhost:5173/?source=ws&url=ws://localhost:8787/ring&mode=still&button=ws.

No hardware? `npm run fake-ring` connects to the hub exactly like the board does: type `c` / `d` / `h` + Enter to press,
`n` + Enter to point at the next image in `test-images/`. The phone app in `phone/` can also stand in for the ring.

## How it works

```
ring (ESP32-CAM) --Wi-Fi WS--> hub /phone <-> /ring --> browser
                                                         │ press: tick, ask the ring for a 2-3 photo burst
                                                         │ sharpest photo -> dark/blurry? say so (on device, < 0.5 s)
                                                         │ same view as a recent look? replay its answer instantly
                                                         ▼
                              hub POST /look  <── photo (≤1280 px) + question + session notebook + goal
                                 │ Claude vision (Haiku 4.5 for look/ask, Opus 5.5 for "more"), streamed
                                 ▼
browser: each sentence is spoken the moment it is complete (ElevenLabs via the hub, streamed into MediaSource
         so audio starts on the first bytes; else the browser voice)
         -> notebook entry: headline, detail, kind, place guess, thumbnail
```

- **Answer format.** The first line is a spoken headline of ≤ 15 words that stands on its own; a few detail sentences
  may follow; a final `@meta {"kind","title","place"}` line feeds the notebook and is never spoken
  (`server/prompt.ts`, `src/lib/answer.ts`).
- **Latency.** Target: under 2 s from press to first word on a new look, under 0.3 s on a replay. A tick plays the
  instant you press. The browser console logs `[qu] {"firstSentenceMs":…, "hubTtftMs":…}` for every answer.
- **Same-view cache.** A 32×24 thumbnail compared by normalised cross-correlation over small shifts recognises a
  re-point of the same thing (≥ 0.98 on test images) and rejects different things (≤ 0.54). A replay is spoken at
  once and re-checked in the background; if the fresh answer differs it is spoken as a correction
  (`src/lib/fingerprint.ts`).
- **Session notebook.** The last 12 answers and the goal go with every request; the notebook survives a reload until
  you press *End session* (`src/lib/notebook.ts`).
- **Offline.** If the hub can't be reached, Qu says so, keeps the photo, and answers it when the hub is back.
- **Privacy.** On the ring the camera only takes pictures when you press. Qu describes people but never identifies them.
- **Keys** stay in `server/.env.local`; the browser only talks to the hub.

Decisions and the research behind them: [.agent/decisions.md](.agent/decisions.md). Camera sources, orientation,
bursts and the ring wire protocol: [src/vision/README.md](src/vision/README.md).

## Commands

```bash
npm run dev               # app
npm run hub               # local hub (LOOK_MOCK=1 for a mock brain; LOOK_MODEL / DEEP_MODEL to change models)
npm run build             # type check + production build (the verification gate)
npm test                  # unit tests (browser lib + hub)
npm run e2e               # headless Chromium end to end against a mock hub, fake webcam and fake ring
npm run lint
npm run fake-ring         # ring stand-in that talks to the hub
npm run mock-ring         # older stand-in: a WebSocket camera the browser connects to directly
npm run voice -- status   # ElevenLabs voice (clone with: npm run voice -- clone a.mp3 --name "Me")
```

## Layout

| Path | What |
|---|---|
| `src/App.tsx` | Page: viewfinder, gesture buttons, answer card, notebook |
| `src/lib/useQu.ts` | The core loop: look / ask / more, cache, offline retry |
| `src/lib/look.ts` | Client for the hub's streamed `/look` |
| `src/lib/answer.ts` | Streamed text → speakable sentences + meta |
| `src/lib/speaker.ts` | Sentence queue; ElevenLabs with prefetch, browser voice fallback |
| `src/lib/fingerprint.ts`, `notebook.ts`, `quality.ts`, `ask.ts`, `encode.ts` | Cache, session memory, photo gate, speech recognition, JPEG encoding |
| `src/components/Viewfinder.tsx` | Preview and best-frame capture for stream and still sources |
| `src/vision/` | Camera sources (`FrameSource`) and ring buttons (`ButtonInput`): webcam, Wi-Fi, Bluetooth, files |
| `server/` | Hub: `/look` (Claude), `/voice/speak` (ElevenLabs), ring relay |
| `firmware/qu-ring/` | ESP32-CAM + Grove button sketch |
| `phone/` | Expo app that can act as the ring |
