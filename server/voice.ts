// ElevenLabs voice: the key stays here; the browser only ever talks to the hub.
//   Sentences  -> Flash v2.5 (lowest latency), streamed through POST /voice/speak
//   Voice      -> ELEVENLABS_VOICE_ID, else server/voice.json (written by `voice clone`), else a stock voice
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import type { ServerResponse } from "node:http";

const API = "https://api.elevenlabs.io";
export const SENTENCE_MODEL = "eleven_flash_v2_5";
const FORMAT = "mp3_44100_64";
const STOCK_VOICE = { voiceId: "EXAVITQu4vr4xnSDxMaL", name: "Sarah (stock)" }; // premade, for development
const VOICE_FILE = fileURLToPath(new URL("./voice.json", import.meta.url));

const key = () => {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new Error("ELEVENLABS_API_KEY is not set in server/.env.local");
  return k;
};

export function currentVoice(): { voiceId: string; name: string; cloned: boolean } {
  if (process.env.ELEVENLABS_VOICE_ID) return { voiceId: process.env.ELEVENLABS_VOICE_ID, name: "env voice", cloned: true };
  if (existsSync(VOICE_FILE)) {
    const v = JSON.parse(readFileSync(VOICE_FILE, "utf8")) as { voiceId: string; name: string };
    return { ...v, cloned: true };
  }
  return { ...STOCK_VOICE, cloned: false };
}

/** VOICE_MOCK_FILE=<mp3>: stream that file instead of calling ElevenLabs (tests of streamed playback, no key). */
const MOCK_FILE = process.env.VOICE_MOCK_FILE;

export function configured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY || MOCK_FILE);
}

function ttsUrl(voiceId: string, stream: boolean): string {
  return `${API}/v1/text-to-speech/${voiceId}${stream ? "/stream" : ""}?output_format=${FORMAT}`;
}

async function ttsRequest(text: string, model: string, stream: boolean): Promise<Response> {
  const res = await fetch(ttsUrl(currentVoice().voiceId, stream), {
    method: "POST",
    headers: { "xi-api-key": key(), "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: model }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Pipe streamed mp3 for `text` straight to the browser as it is generated. */
export async function speak(text: string, res: ServerResponse, cors: Record<string, string>): Promise<void> {
  if (MOCK_FILE) return mockSpeak(res, cors);
  const upstream = await ttsRequest(text, SENTENCE_MODEL, true);
  res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", ...cors });
  Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
}

/** Instant voice clone from one or more clean recordings. Saves the id to server/voice.json. */
export async function cloneVoice(files: string[], name: string): Promise<string> {
  const form = new FormData();
  form.set("name", name);
  form.set("remove_background_noise", "true");
  for (const f of files) form.append("files", new Blob([readFileSync(f)]), basename(f));
  const res = await fetch(`${API}/v1/voices/add`, { method: "POST", headers: { "xi-api-key": key() }, body: form });
  const body = (await res.json()) as { voice_id?: string; detail?: unknown };
  if (!res.ok || !body.voice_id) throw new Error(`clone failed ${res.status}: ${JSON.stringify(body.detail ?? body)}`);
  writeFileSync(VOICE_FILE, JSON.stringify({ voiceId: body.voice_id, name }, null, 2));
  return body.voice_id;
}

/** Send the mock mp3 in 8 chunks, VOICE_MOCK_CHUNK_MS apart, like a voice being generated while it streams. */
async function mockSpeak(res: ServerResponse, cors: Record<string, string>): Promise<void> {
  const audio = readFileSync(MOCK_FILE!);
  const gap = Number(process.env.VOICE_MOCK_CHUNK_MS ?? 150);
  res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", ...cors });
  const step = Math.ceil(audio.length / 8);
  for (let i = 0; i < audio.length; i += step) {
    if (res.destroyed) return;
    res.write(audio.subarray(i, i + step));
    await new Promise((r) => setTimeout(r, gap));
  }
  res.end();
}
