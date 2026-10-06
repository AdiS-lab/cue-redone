// Speaks Qu's answer sentence by sentence as it streams in.
//   ElevenLabs (through the hub, POST /voice/speak) when the hub has a key, else browser SpeechSynthesis.
//   With ElevenLabs, each sentence's request starts as soon as the sentence is queued (so the next ones are
//   generating while the current one plays), and playback starts on the first audio bytes through MediaSource
//   instead of waiting for the whole file.
//   stop() drops everything queued: a new press always wins.
import { HUB } from "./hub";
import { browserSpeak, browserStop, speechRate } from "./speak";

interface Item {
  text: string;
  audio: Promise<Response | null> | null;
  queuedAt: number;
}

type Listener = (speaking: string | null) => void;

const FETCH_TIMEOUT_MS = 4000;
const MSE_TYPE = "audio/mpeg";

function canStream(): boolean {
  return typeof MediaSource !== "undefined" && MediaSource.isTypeSupported(MSE_TYPE);
}

export class Speaker {
  private queue: Item[] = [];
  private generation = 0;
  private running = false;
  private current: HTMLAudioElement | null = null;
  private eleven = false;
  private failures = 0;
  private listeners = new Set<Listener>();
  private idleWaiters: (() => void)[] = [];
  private controllers = new Set<AbortController>();
  /** Text actually spoken, for tests and the transcript. */
  readonly log: string[] = [];

  /** Use the hub's ElevenLabs voice (true) or the browser voice (false). */
  setElevenLabs(on: boolean): void {
    this.eleven = on;
    this.failures = 0;
  }

  usingElevenLabs(): boolean {
    return this.eleven;
  }

  onChange(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  say(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.queue.push({ text: t, audio: this.eleven ? this.fetchAudio(t) : null, queuedAt: performance.now() });
    if (!this.running) void this.run(this.generation);
  }

  stop(): void {
    this.generation++;
    for (const c of this.controllers) c.abort();
    this.controllers.clear();
    this.queue = [];
    this.current?.pause();
    this.current = null;
    browserStop();
    this.running = false;
    this.emit(null);
    this.flushIdle();
  }

  busy(): boolean {
    return this.running || this.queue.length > 0;
  }

  /** Resolves when everything queued so far has been spoken (or stop() was called). */
  idle(): Promise<void> {
    if (!this.busy()) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private emit(s: string | null): void {
    for (const l of this.listeners) l(s);
  }

  private flushIdle(): void {
    const w = this.idleWaiters;
    this.idleWaiters = [];
    w.forEach((r) => r());
  }

  /** Starts the request; resolves when the response headers arrive (the body keeps streaming). */
  private async fetchAudio(text: string): Promise<Response | null> {
    const ctl = new AbortController();
    this.controllers.add(ctl);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${HUB}/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`hub ${res.status}`);
      return res;
    } catch (err) {
      // stop() aborting a prefetch is not a failure; a timeout or an error is
      if (timedOut || !ctl.signal.aborted) {
        console.warn("[speaker] ElevenLabs unavailable, using the browser voice:", (err as Error).message);
        if (++this.failures >= 2) this.eleven = false;
      }
      this.controllers.delete(ctl);
      return null;
    } finally {
      // the controller stays registered while the body streams, so stop() can cancel the download too
      clearTimeout(timer);
    }
  }

  /** Play an audio/mpeg response as it downloads. Resolves when playback ends (or fails / is stopped). */
  private playStreaming(res: Response, gen: number, queuedAt: number): Promise<boolean> {
    return new Promise((resolve) => {
      const ms = new MediaSource();
      const url = URL.createObjectURL(ms);
      const audio = new Audio(url);
      audio.playbackRate = speechRate();
      this.current = audio;
      let started = false;
      let finished = false;
      const finish = (ok: boolean) => {
        if (finished) return;
        finished = true;
        URL.revokeObjectURL(url);
        resolve(ok);
      };
      audio.onended = () => finish(true);
      audio.onerror = () => finish(started);
      audio.onpause = () => {
        if (gen !== this.generation) finish(true);
      };
      audio.onplaying = () => {
        if (!started) console.info(`[speaker] audio playing ${Math.round(performance.now() - queuedAt)} ms after the sentence was queued`);
        started = true;
      };
      ms.addEventListener("sourceopen", async () => {
        let sb: SourceBuffer;
        try {
          sb = ms.addSourceBuffer(MSE_TYPE);
        } catch {
          return finish(false);
        }
        const appended = () => new Promise<void>((r) => sb.addEventListener("updateend", () => r(), { once: true }));
        const reader = res.body!.getReader();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (gen !== this.generation) {
              void reader.cancel();
              return finish(true);
            }
            if (done) break;
            sb.appendBuffer(value);
            await appended();
            if (!started && audio.paused) audio.play().catch(() => finish(false));
          }
          if (ms.readyState === "open") ms.endOfStream();
          if (!started && audio.paused) audio.play().catch(() => finish(false));
        } catch {
          finish(started);
        }
      });
    });
  }

  private async playBlob(res: Response, gen: number): Promise<boolean> {
    const url = URL.createObjectURL(await res.blob());
    return new Promise((resolve) => {
      if (gen !== this.generation) return resolve(true);
      const audio = new Audio(url);
      audio.playbackRate = speechRate();
      this.current = audio;
      const done = (ok: boolean) => {
        URL.revokeObjectURL(url);
        resolve(ok);
      };
      audio.onended = () => done(true);
      audio.onerror = () => done(false);
      audio.onpause = () => done(true);
      audio.play().catch(() => done(false));
    });
  }

  private async run(gen: number): Promise<void> {
    this.running = true;
    while (gen === this.generation && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.emit(item.text);
      const res = item.audio ? await item.audio : null;
      if (gen !== this.generation) return;
      this.log.push(item.text);
      let played = false;
      if (res) played = await (canStream() ? this.playStreaming(res, gen, item.queuedAt) : this.playBlob(res, gen));
      if (this.controllers.size > 32) this.controllers.clear(); // finished downloads; keeps the set from growing all session
      if (gen !== this.generation) return;
      if (!played) await browserSpeak(item.text);
    }
    if (gen !== this.generation) return;
    this.running = false;
    this.emit(null);
    this.flushIdle();
  }
}

export const speaker = new Speaker();
