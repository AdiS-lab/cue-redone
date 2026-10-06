// Qu hub: the one local process next to the browser.
//   /ring, /phone  WebSocket relay between the ring (or the phone stand-in) and the browser
//   /look          photo + notebook -> Claude vision, streamed back as text (server/look.ts)
//   /voice/speak   ElevenLabs speech for each sentence (server/voice.ts)
//   API keys live in server/.env.local, never in the browser.
import "./env.ts";
import { networkInterfaces } from "node:os";
import { createServer } from "node:http";
import { CORS, readJson, send } from "./http.ts";
import { handleLook, lookStatus } from "./look.ts";
import { configured, currentVoice, speak } from "./voice.ts";
import { attachRing, isRingAction, type RingAction } from "./ring.ts";

const PORT = Number(process.env.HUB_PORT ?? 8787);
const STARTED = Date.now();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://hub");
  if (req.method === "OPTIONS") return send(res, 204, {});

  if (req.method === "GET" && url.pathname === "/health") {
    return send(res, 200, { ok: true, uptimeMs: Date.now() - STARTED, browsers: ring.browsers(), phones: ring.phones(), look: lookStatus() });
  }

  if (req.method === "POST" && url.pathname === "/look") return handleLook(req, res);

  // Fake or real ring press: POST /ring/event {"action":"click"|"double"|"hold"}
  if (req.method === "POST" && url.pathname === "/ring/event") {
    try {
      const body = (await readJson(req)) as { action?: unknown };
      const action = body.action ?? url.searchParams.get("action");
      if (!isRingAction(action)) return send(res, 400, { error: 'action must be "click", "double" or "hold"' });
      return send(res, 200, { action, delivered: ring.emit(action) });
    } catch (err) {
      return send(res, 400, { error: String((err as Error).message) });
    }
  }

  if (req.method === "GET" && url.pathname === "/voice/status") {
    const v = currentVoice();
    return send(res, 200, { configured: configured(), voice: v.name, cloned: v.cloned });
  }

  // POST /voice/speak {"text":"..."} -> streamed audio/mpeg in the current voice
  if (req.method === "POST" && url.pathname === "/voice/speak") {
    try {
      const { text } = (await readJson(req)) as { text?: unknown };
      if (typeof text !== "string" || !text.trim() || text.length > 500) return send(res, 400, { error: "text must be 1-500 characters" });
      if (!configured()) return send(res, 503, { error: "ELEVENLABS_API_KEY is not set" });
      return await speak(text.trim(), res, CORS);
    } catch (err) {
      console.warn("[hub] speak failed:", (err as Error).message);
      if (!res.headersSent) return send(res, 502, { error: (err as Error).message });
      return void res.end();
    }
  }

  send(res, 404, { error: "not found" });
});

const ring = attachRing(server);
ring.onFeedback((kind) => console.log(`[hub] feedback -> ring: ${kind}`));

server.listen(PORT, () => {
  console.log(`[hub] http://localhost:${PORT}  browser ws://localhost:${PORT}/ring`);
  for (const addrs of Object.values(networkInterfaces()))
    for (const a of addrs ?? [])
      if (a.family === "IPv4" && !a.internal) console.log(`[hub] phone app URL: ws://${a.address}:${PORT}/phone`);
  console.log("[hub] type c / d / h + Enter to fake a ring press (click / double / hold)");
});

// Keyboard stand-in for the ring while no hardware is attached.
const KEYS: Record<string, RingAction> = { c: "click", d: "double", h: "hold" };
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  const action = KEYS[chunk.trim()[0] ?? ""];
  if (!action) return;
  console.log(`[hub] fake ${action} -> ${ring.emit(action)} browser(s)`);
});
