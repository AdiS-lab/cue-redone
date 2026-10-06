# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

Qu: a camera ring you point at things. An ESP32-CAM ring (or the webcam while developing) takes a photo on a button press, the local hub asks Claude vision about it, and the answer is spoken sentence by sentence as it streams. A session notebook of everything pointed at goes with each request, so answers adapt to the place and to what was asked. Stack: React 19 + Vite + Tailwind v4 + TypeScript in the browser, a small Node/TypeScript hub in `server/`, Arduino firmware in `firmware/qu-ring/`. Stable facts live in `project.md`, the current task and acceptance criteria in `task.md`, decisions in `.agent/decisions.md`, verified API quirks in `.agent/knowledge.md`. Read those before changing behavior they cover.

## Commands

```bash
npm install
npm run hub          # local hub on :8787 (LOOK_MOCK=1 for a mock brain without a key)
npm run dev          # http://localhost:5173 (use Chrome, allow camera)
npm run build        # tsc -b && vite build; this is the type check + build gate
npm test             # vitest: src/lib and server unit tests
npm run e2e          # headless Chromium against a mock hub, fake webcam and fake ring
npm run lint         # oxlint
npm run typecheck:server
```

Keys go in `server/.env.local` (see `server/.env.example`): `ANTHROPIC_API_KEY` for `/look`, optional `ELEVENLABS_API_KEY` for the voice. The browser never holds a key. In this sandbox, install with `npm install --ignore-scripts` (onnxruntime-node's postinstall download is blocked; nothing here needs it).

## Architecture

```
Ring / webcam (FrameSource) ─► Viewfinder: sharpest frame of the burst or recent stream frames
Button (ButtonInput: keyboard, Wi-Fi, BLE) ─► useQu: click=look, hold=ask, double=more
look: quality gate (dark/blurry, on device) ─► same-view cache (fingerprint.ts) ─► hub POST /look (SSE)
hub: server/prompt.ts + Claude (Haiku 4.5 look/ask, Opus 5.5 more) ─► streamed text
browser: AnswerStream splits sentences ─► Speaker (ElevenLabs via /voice/speak, else SpeechSynthesis) ─► notebook
```

Things that take reading several files to see:

- **Answer contract**: line 1 is a spoken headline, then optional detail, then a `@meta {...}` line that is parsed into the notebook and never spoken. `server/prompt.ts` asks for it; `src/lib/answer.ts` enforces it on the stream.
- **One interaction at a time**: every press calls `begin()` in `useQu.ts`, which stops speech and aborts the in-flight request; a stale answer never speaks over a newer press. An interrupted answer keeps what arrived.
- **Cache**: a replay is spoken immediately and re-checked silently; a different fresh headline (`sameAnswer`, number-aware) is spoken as a correction.
- **Offline**: `HubUnavailable` marks the entry `pending` (photo kept in memory) and it is answered when `/health` comes back.
- **Hardware seam**: `src/vision/sources` (`FrameSource`) and `src/vision/input` (`ButtonInput`) are the contract with the ring; the wire protocol is in `src/vision/README.md`. The hub relays `/phone` (ring) ↔ `/ring` (browser) untouched.
- **Coordinates/orientation**: frames are rotated/flipped per source + hand before anything else sees them (`vision/sources/orient.ts`).

## Constraints

- No server-side ML; the hub only proxies API calls (keys stay off the browser) and relays the ring.
- Stay on Vite + React + TypeScript + Tailwind v4 (no config file, no component library).
- Do not break `FrameSource` / `ButtonInput`; `npm run build` must pass.

# Hackathon Goals & Tracks

### Beyond the Code (Hardware) (The main track)

Push past the screen. Build physical, tangible tech — circuits, sensors, wearables, robotics — that bridges the digital and the real.

### ASI:One Agent Challenge (sponsor track)

**FetchAI**

Most AI applications stop at conversation. Your challenge is to go further.

Build an AI agent, register it on Agentverse (https://agentverse.ai/), and make it discoverable through ASI:One (https://asi1.ai/. Your agent should understand a user’s intent and take meaningful action to solve a real-world problem.

It could coordinate services, automate a multi-step workflow, analyze live information, make context-aware recommendations, complete transactions, or collaborate with other specialized agents. The problem space and approach are entirely up to you.

We are looking for agents that do more than answer questions. Your project should demonstrate real utility, autonomy, and the ability to turn a user’s request into an outcome. Avoid simple chatbots or thin wrappers around a single API. Refer the full hackpack here : https://www.fetch.ai/events/hackathons/mhacks-2026/hackpack

Submission Requirement: In addition to your Devpost submission, you must also submit your project on ASI through the designated Submission Agent. (Link : https://asi1.ai/auth/signup?returnTo=%2Ffestival%2Fmhacks2026%2Fdashboard%3Futm_source%3Dmhacks2026)

Refer the submission process here : https://docs.google.com/document/d/1UDW-X1C24hxZviFOQzjTeh0pXRNAoflMb8lhJqZP9Z0

### Best Project Built with ElevenLabs (sponsor track)

**ElevenLabs**

Awarded to the project with the best use of ElevenLabs.

### Agents in iMessage using Photon (sponsor track)

**Photon**

Build AI agents that naturally participate in human conversations through iMessage. Participants can create AI companions, multi-agent systems, or other experiences that understand social context, persist context across interactions, and seamlessly integrate AI into everyday communication.

Projects must integrate with Photon's Spectrum framework and use Spectrum to connect their agent to iMessage to qualify for the prize.

### Build Better Personalized Healthcare with FinchNode (sponsor track)

**FinchNode**

Build an app that makes healthcare easier for patients, clinicians, or care teams using the FinchNode API. Projects should demonstrate a working FinchNode integration using our synthetic demo health records.

### Best use of Spacetime (sponsor track)

**Spacetime**

We’d love to see projects where Spacetime is the core real-time backend, especially anything with live shared state, multiplayer interaction, or instant sync between users/agents/systems. That makes it a great fit not just for games, but also for things like chat/community apps, collaborative tools, social experiences, AI agent coordination, live dashboards, trading / financial-style apps, auctions / marketplaces, shared simulations, multiplayer productivity tools, and stream/creator tools. Spacetime’s docs position it around real-time subscriptions, transactional updates, and server-side logic running close to the data, which is why these kinds of apps fit well.

We’d be excited by something like a real-time portfolio sim, prediction market, collaborative trading game, shared ops dashboard, multi-user planning tool, or AI systems coordinating in a persistent world state. The main thing we’d want is for Spacetime to be meaningfully used, not just added on the side.

A few cool examples already built with Spacetime:

- BitCraft Online
- Pogly, a real-time collaborative stream overlay
- Elegon, a fantasy MMORPG
- Catacomb Crawlers, an online RPG
