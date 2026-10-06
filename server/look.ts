// POST /look: photo (+ question + session notebook) in, Qu's spoken answer out as Server-Sent Events.
//   data: {"type":"text","text":"..."}            streamed text deltas
//   data: {"type":"done","model":...,"ttftMs":...,"ms":...}
//   data: {"type":"error","message":"..."}
// The Anthropic key stays in server/.env.local. LOOK_MOCK=1 streams a canned answer (tests, demos without a key).
import type { IncomingMessage, ServerResponse } from "node:http";
import type Anthropic from "@anthropic-ai/sdk";
import { CORS, readJson, send } from "./http.ts";
import { BadRequest, SYSTEM_PROMPT, parseLookRequest, userContent, type LookRequest } from "./prompt.ts";

export const LOOK_MODEL = process.env.LOOK_MODEL ?? "claude-haiku-4-5";
export const DEEP_MODEL = process.env.DEEP_MODEL ?? "claude-opus-5-5";
const MOCK = process.env.LOOK_MOCK === "1";
const MAX_BODY = 2_000_000;

export function lookStatus() {
  return {
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    mock: MOCK,
    model: LOOK_MODEL,
    deepModel: DEEP_MODEL,
  };
}

let client: Anthropic | null = null;
async function anthropic(): Promise<Anthropic> {
  if (!client) {
    const { default: SDK } = await import("@anthropic-ai/sdk");
    client = new SDK();
  }
  return client;
}

type Emit = (event: Record<string, unknown>) => void;

async function streamClaude(req: LookRequest, emit: Emit, signal: AbortSignal): Promise<{ model: string; ttftMs: number }> {
  const sdk = await anthropic();
  const deep = req.mode === "more";
  const model = deep ? DEEP_MODEL : LOOK_MODEL;
  const t0 = performance.now();
  let ttftMs = -1;
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userContent(req) }];
  const onText = (text: string) => {
    if (ttftMs < 0) ttftMs = performance.now() - t0;
    emit({ type: "text", text });
  };
  // "more" uses the deeper model at low effort; on a policy refusal the API re-runs it on a fallback model.
  const stream = deep
    ? sdk.beta.messages.stream(
        {
          model,
          max_tokens: 4000,
          system,
          messages,
          output_config: { effort: "low" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal }
      )
    : sdk.messages.stream({ model, max_tokens: 400, system, messages }, { signal });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") onText(event.delta.text);
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") onText("\nI can't help with that one.\n");
  return { model: final.model, ttftMs: Math.round(ttftMs) };
}

/** Deterministic stand-in so the whole loop runs without a key. Clearly labelled as a mock. */
export function mockAnswer(req: LookRequest): string {
  const kb = req.image ? Math.round((req.image.length * 3) / 4 / 1024) : 0;
  const seen = req.notebook.length;
  switch (req.mode) {
    case "look":
      return `Mock answer: a ${kb} kilobyte photo, look number ${seen + 1} this session.\nAdd an Anthropic key to the hub for real answers.\n@meta {"kind":"object","title":"Mock look ${seen + 1}","place":""}`;
    case "ask":
      return `Mock answer to "${req.question}".\nAdd an Anthropic key to the hub for real answers.\n@meta {"kind":"object","title":"Mock question","place":""}`;
    case "more":
      return `Mock detail: here is more about the same photo.\nThe real version uses a deeper model.\n@meta {"kind":"object","title":"Mock detail","place":""}`;
    case "recall": {
      const last = req.notebook[req.notebook.length - 1];
      return `${last ? `Earlier you looked at ${last.title}: ${last.headline}` : "You haven't looked at anything yet."}\n@meta {"kind":"unclear","title":"Recall","place":""}`;
    }
  }
}

async function streamMock(req: LookRequest, emit: Emit, signal: AbortSignal): Promise<{ model: string; ttftMs: number }> {
  const words = mockAnswer(req).split(/(?<=\s)/);
  const delay = Number(process.env.LOOK_MOCK_DELAY_MS ?? 40);
  for (const w of words) {
    if (signal.aborted) break;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    emit({ type: "text", text: w });
  }
  return { model: "mock", ttftMs: delay };
}

export async function handleLook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let look: LookRequest;
  try {
    look = parseLookRequest(await readJson(req, MAX_BODY));
  } catch (err) {
    const status = err instanceof BadRequest || err instanceof SyntaxError ? 400 : 413;
    return send(res, status, { error: (err as Error).message });
  }
  if (!MOCK && !process.env.ANTHROPIC_API_KEY) return send(res, 503, { error: "ANTHROPIC_API_KEY is not set in server/.env.local" });

  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", ...CORS });
  const ctl = new AbortController();
  res.on("close", () => ctl.abort());
  const emit: Emit = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const t0 = performance.now();
  try {
    const { model, ttftMs } = await (MOCK ? streamMock : streamClaude)(look, emit, ctl.signal);
    const ms = Math.round(performance.now() - t0);
    console.log(`[look] ${look.mode} ${model} first text ${ttftMs} ms, total ${ms} ms, notebook ${look.notebook.length}`);
    emit({ type: "done", model, ttftMs, ms });
  } catch (err) {
    if (!ctl.signal.aborted) {
      console.warn("[look] failed:", (err as Error).message);
      emit({ type: "error", message: (err as Error).message });
    }
  } finally {
    res.end();
  }
}
