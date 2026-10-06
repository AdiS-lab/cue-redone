# Architecture Decisions

> Record durable decisions, not ordinary implementation chatter.

## Template

### [YYYY-MM-DD] — [decision title]

**Decision**

[What we decided.] 

**Reason**

[Why.] 

**Alternatives considered**

- [alternative + reason not chosen]

**Consequence**

[What future work should assume.] 

---


### 2026-10-03 — Local hub + sponsor care loop (reverses "browser-only, no backend")

**Decision**

Add a local Node/TypeScript hub (`server/`) and Python agents (`agents/`) so one demo scene uses ElevenLabs, Photon, FinchNode and Fetch.ai as a single care loop. Plan and phases: `docs/care-loop.md`.

**Reason**

API keys must stay off the browser; Photon (iMessage) and uAgents need a server process; FinchNode and Fetch.ai are Python. The earlier "no backend" and "ElevenLabs/Photon non-goal" decisions were for the offline prototype.

**Alternatives considered**

- Keep browser-only and call every sponsor API from the page: exposes keys and cannot run uAgents or Photon.

**Consequence**

The hub speaks the existing ring WebSocket protocol, so the browser's "Ring button (Wi-Fi)" input works unchanged. Offline mode (templates + SpeechSynthesis) must keep working when the hub is down.

---

---

### 2026-10-04 — Communication and information only

**Decision**

Remove FinchNode and every healthcare tool: the browser health-record panel and alerts, medication mode (label reading, Check medicine), the clinic summary, the pain report, the hub's `/meds/*` and `/care/*` routes, and all Fetch.ai agents (`agents/`). The pain button becomes **I need help**: say it aloud, or text a contact through the existing private-message path.

**Reason**

Team scope decision: Qu focuses on communication and information.

**Consequence**

The hub only serves voice (ElevenLabs), messages (Photon) and the ring relay. The FinchNode and Fetch.ai sponsor tracks are no longer targeted.

---

### 2026-10-06 — Qu becomes a camera ring: point to ask, and it remembers what you pointed at

**Decision**

Retire the AAC product. Qu is now a camera ring (ESP32-CAM + one Grove button) that answers "what should I know about *this*, right now?" out loud. One button, three gestures:

| Gesture | Action |
|---|---|
| click | **Look**: photograph, explain in one short spoken headline (text is read, products named with key facts, rooms described briefly). The model decides what kind of shot it is; there are no modes. |
| hold | **Ask**: photograph at the hold, then listen to a spoken question (browser speech recognition, ends at a pause); photo + question go together. With no photo it asks the session notebook ("what did that label say?"). |
| double | **More**: deeper answer about the last look, same photo, stronger model. |

Pipeline:

```
ESP32-CAM --Wi-Fi WS--> hub /phone -> /ring relay (unchanged) --> browser
browser: sharpest of burst -> quality gate (blur/dark, on device) -> fingerprint cache
       -> POST hub /look (JPEG + notebook + question)  -> hub streams Claude text (SSE)
       -> first sentence spoken immediately (ElevenLabs via hub, else SpeechSynthesis)
       -> notebook entry (headline, kind, place guess, thumbnail, fingerprint)
```

Specifics:

- **Model call lives in the hub** (`server/look.ts`), so the key never reaches the browser. It is an API call, not server-side ML. Default models: `claude-haiku-4-5` for look/ask (speed), `claude-opus-5-5` at low effort for "more" (depth); both overridable with `LOOK_MODEL` / `DEEP_MODEL`. Streaming; system prompt is stable and cached.
- **Output contract**: first line is a spoken headline of ≤ 15 words; optional detail sentences follow; a final machine line `@meta {"kind","place","title"}` feeds the notebook and is never spoken.
- **Latency target**: < 2 s press-to-first-word on a fresh look, < 300 ms on a cache hit. A tick plays at once on press. Images are sent at ≤ 1280 px long side (Claude downscales above ~1.15 MP, so larger only costs upload).
- **Quality gate** before any network call: variance-of-Laplacian sharpness (existing `core/sharpness.ts`) and mean brightness. Fails speak "Too blurry, hold still" / "Too dark" in < 0.5 s.
- **Cache**: 64-bit dHash + coarse colour signature per look. A close match replays the stored answer instantly *and* re-asks in the background (stale-while-revalidate); if the fresh headline differs it is spoken as a correction. Two similar-looking pill bottles must never silently share an answer, hence always revalidating. "Same object, different angle" is handled by the model, which sees the notebook.
- **Session notebook**: in-memory list of looks (time, headline, detail, kind, place, question, thumbnail). The last 12 entries plus a spoken goal ("I'm shopping, I have a nut allergy") are sent with every request as compact text. Persisted to `localStorage` for the session; "End session" clears it.
- **Offline / hub down**: say "Can't reach Qu's brain, saved it for later", keep the photo in the notebook as pending, and answer pending looks when the hub is back.
- **Privacy**: camera off until press (still mode on the ring); the prompt describes people but never identifies them.
- **Hardware**: firmware sketch in `firmware/qu-ring/` speaks the existing WebSocket protocol (`src/vision/README.md`), handles click/double/hold timing on the Grove button, sends a 2–3 frame burst at SVGA/XGA, switches on the flash LED in low light. Untested without hardware.

**Reason**

Prior art (MIT EyeRing / FingerReader, Sony Ring Camera 2026) shows finger cameras + audio work for reading and identifying; none keep context or let you ask a question about what you point at. Pointing + listening is faster than reading. A vision-language model is required to read and explain labels, and nothing that runs in a browser tab does that well enough. Streaming plus speaking the first sentence is the main latency lever we control.

**Alternatives considered**

- Keep detect → classify → compose: names objects, cannot read or explain. Rejected by the brief.
- On-device VLM in the browser (SmolVLM/Moondream class): multi-second, weak OCR, big download.
- Always-on video from the ring: ESP32 manages ~7 fps at VGA, battery, privacy.
- SigLIP embeddings for the semantic cache (proposed earlier): dropped. It needs a 55 MB model download, its vocabulary is being deleted, and Hugging Face is unreachable from the build sandbox so it could not be verified. Perceptual fingerprint + model-side recall cover the useful cases; revisit if same-object-new-angle hits matter.
- Calling Claude from the browser (old `claude.ts`): ships the key to the page.

**Consequence**

AAC features, the 637-label vocabulary, SigLIP, MediaPipe, Photon/iMessage messaging, QR, contacts and "I need help" are deleted. `FrameSource` / `ButtonInput` and the hub's ring relay are unchanged. `ANTHROPIC_API_KEY` goes in `server/.env.local`; without it the hub runs `/look` in mock mode (`LOOK_MOCK=1`, also used by tests) so the loop is demoable. Supersedes "Communication and information only" (2026-10-04).

---

### 2026-10-06 — Clicks are sent on release; "double" follows

**Decision**

The ring firmware (and the phone stand-in) sends `click` the moment the button is released and `double` if a second press follows within 300 ms. The app's `more` waits for the look that the first click started and answers about that photo.

**Reason**

Deciding click vs double on the board means every click waits out the double-press window (250-300 ms), about 15 % of the 2 s press-to-first-word budget, to serve the rarer gesture. With click-first the look's capture starts immediately; a double costs nothing extra because "more" reuses that capture (the look's own answer is cut off before it speaks).

**Alternatives considered**

- Board-side disambiguation (`CLICK_FIRST 0` in the sketch): simpler protocol, slower clicks.
- Hold for "more": hold is "ask", which needs the microphone.

**Consequence**

`useQu.more()` must keep handling a double that arrives while the click's photo is still in flight (`capturingLookRef`); `scripts/e2e.mjs` covers it through the fake ring.
