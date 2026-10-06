// Browser side of POST /look: send the photo + notebook, read Qu's answer as it streams.
import { HUB } from "./hub";
import type { LookMode, NotebookLine } from "./notebook";

export interface LookBody {
  mode: LookMode;
  image?: string;
  question?: string;
  notebook: NotebookLine[];
  goal?: string;
  previous?: string;
}

export interface LookDone {
  model: string;
  ttftMs: number;
  ms: number;
}

/** The hub could not be reached or refused; the answer can be retried later. */
export class HubUnavailable extends Error {}

const CONNECT_TIMEOUT_MS = 6000;

export async function streamLook(body: LookBody, onText: (text: string) => void, signal?: AbortSignal): Promise<LookDone> {
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  signal?.addEventListener("abort", abort);
  const timer = setTimeout(abort, CONNECT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${HUB}/look`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (err) {
    signal?.removeEventListener("abort", abort);
    if (signal?.aborted) throw err;
    throw new HubUnavailable(`hub unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  try {
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      let message = `hub ${res.status}`;
      try {
        message = (JSON.parse(detail) as { error?: string }).error ?? message;
      } catch {
        // not JSON
      }
      if (res.status >= 500) throw new HubUnavailable(message);
      throw new Error(message);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let sep: number;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        if (!chunk.startsWith("data: ")) continue;
        const event = JSON.parse(chunk.slice(6)) as { type: string; text?: string; message?: string } & Partial<LookDone>;
        if (event.type === "text" && event.text) onText(event.text);
        else if (event.type === "error") throw new Error(event.message ?? "look failed");
        else if (event.type === "done") return { model: event.model ?? "", ttftMs: event.ttftMs ?? -1, ms: event.ms ?? -1 };
      }
    }
    throw new Error("answer ended early");
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export interface HubHealth {
  ok: boolean;
  look?: { configured: boolean; mock: boolean; model: string; deepModel: string };
}

export async function hubHealth(): Promise<HubHealth | null> {
  try {
    const res = await fetch(`${HUB}/health`, { signal: AbortSignal.timeout(2500) });
    return res.ok ? ((await res.json()) as HubHealth) : null;
  } catch {
    return null;
  }
}
