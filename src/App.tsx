import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Viewfinder, type ViewfinderHandle } from "./components/Viewfinder";
import { AnswerCard, Notebook } from "./components/Notebook";
import { SourceSettings } from "./components/SourceSettings";
import { canListen, listenForQuestion, type ListenHandle } from "./lib/ask";
import { HUB } from "./lib/hub";
import { hubHealth, type HubHealth } from "./lib/look";
import { currentPlace } from "./lib/notebook";
import { speaker } from "./lib/speaker";
import { useQu, type Phase } from "./lib/useQu";
import type { InputAction } from "./lib/types";
import type { FeedbackKind } from "./vision/input/types";
import { isStillSource, loadSourceSettings, orientationFor, saveSourceSettings } from "./vision/settings";
import { useButtonInputs, useFrameSource } from "./vision/useVisionIO";
import { WebcamSource } from "./vision/sources";

const PHASE_TEXT: Record<Phase, string | null> = {
  idle: null,
  capturing: "Taking the picture…",
  listening: "Listening…",
  thinking: "Looking…",
  speaking: "Speaking",
};

const HINTS = [
  ["Space", "Look", "what is this?"],
  ["H", "Ask", "hold, then ask a question"],
  ["D", "More", "tell me more about it"],
] as const;

export default function App() {
  const [settings, setSettings] = useState(loadSourceSettings);
  useEffect(() => saveSourceSettings(settings), [settings]);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string | undefined>(undefined);
  const { source, status } = useFrameSource(settings, cameraId);
  const viewRef = useRef<ViewfinderHandle>(null);
  const [health, setHealth] = useState<HubHealth | null>(null);
  const [voice, setVoice] = useState<"elevenlabs" | "browser">("browser");
  const [heard, setHeard] = useState("");
  const [typed, setTyped] = useState("");
  const listenRef = useRef<ListenHandle | null>(null);
  const typedWaiter = useRef<((q: string) => void) | null>(null);
  const [waitingForTyped, setWaitingForTyped] = useState(false);
  const askInputRef = useRef<HTMLInputElement>(null);

  // Hub + voice status, refreshed every 15 s.
  useEffect(() => {
    let stop = false;
    const check = async () => {
      const h = await hubHealth();
      if (stop) return;
      setHealth(h);
      try {
        const v = h ? ((await (await fetch(`${HUB}/voice/status`)).json()) as { configured: boolean }) : null;
        const eleven = Boolean(v?.configured);
        speaker.setElevenLabs(eleven);
        setVoice(eleven ? "elevenlabs" : "browser");
      } catch {
        speaker.setElevenLabs(false);
        setVoice("browser");
      }
    };
    void check();
    const t = setInterval(check, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (source.kind !== "webcam" || status.status !== "live") return;
    WebcamSource.devices().then(setCameras).catch(() => {});
  }, [source, status.status]);

  const feedbackRef = useRef<(k: FeedbackKind) => void>(() => {});
  const qu = useQu({
    capture: () => viewRef.current?.capture() ?? Promise.resolve(null),
    feedback: (k) => feedbackRef.current(k),
  });

  /** The question for "ask": spoken if the browser can listen, otherwise typed into the box. */
  const getQuestion = useCallback((): Promise<string> => {
    const draft = typed.trim();
    if (draft) {
      setTyped("");
      return Promise.resolve(draft);
    }
    if (canListen()) {
      setHeard("");
      const handle = listenForQuestion(setHeard);
      listenRef.current = handle;
      return handle.result.finally(() => {
        listenRef.current = null;
      });
    }
    setWaitingForTyped(true);
    setTimeout(() => askInputRef.current?.focus(), 0);
    return new Promise<string>((resolve) => {
      typedWaiter.current = (q) => {
        setWaitingForTyped(false);
        resolve(q);
      };
    });
  }, [typed]);

  const onAction = useCallback(
    (action: InputAction) => {
      // A press while listening ends the question early; any other gesture abandons it.
      if (listenRef.current) {
        if (action === "click") return listenRef.current.stop();
        listenRef.current.cancel();
      }
      if (typedWaiter.current) {
        typedWaiter.current("");
        typedWaiter.current = null;
      }
      if (action === "click") void qu.look();
      else if (action === "double") void qu.more();
      else void qu.ask(getQuestion);
    },
    [qu, getQuestion]
  );

  const { hub } = useButtonInputs(settings, onAction, settings.beep);
  feedbackRef.current = (k) => hub.feedback(k);

  const last = qu.entries[qu.entries.length - 1] ?? null;
  const place = useMemo(() => currentPlace(qu.entries), [qu.entries]);
  const still = isStillSource(settings);
  const brain = !health ? "offline" : health.look?.mock ? "mock" : health.look?.configured ? health.look.model : "no key";
  const overlay = qu.phase === "listening" && heard ? `“${heard}”` : PHASE_TEXT[qu.phase];

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const q = typed.trim();
    if (!q) return;
    if (typedWaiter.current) {
      setTyped("");
      typedWaiter.current(q);
      typedWaiter.current = null;
      return;
    }
    // typed question: photo + question, like a hold
    void qu.ask(() => {
      setTyped("");
      return Promise.resolve(q);
    });
  };

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <h1 className="text-2xl font-bold tracking-tight">Qu</h1>
        <span className="text-sm text-stone-500">point · press · listen</span>
        {place && (
          <span className="rounded-full bg-indigo-100 px-3 py-0.5 text-sm text-indigo-900" data-testid="place">
            {place}
          </span>
        )}
        {qu.goal && (
          <span className="rounded-full bg-amber-100 px-3 py-0.5 text-sm text-amber-900" data-testid="goal">
            goal: {qu.goal}
            <button className="ml-2 text-amber-700" onClick={() => qu.setGoal("")} aria-label="Clear goal">
              ×
            </button>
          </span>
        )}
        <span className="ml-auto flex gap-2 text-xs text-stone-500" data-testid="status">
          <span className={brain === "offline" ? "text-red-700" : ""}>brain: {brain}</span>
          <span>· voice: {voice === "elevenlabs" ? "ElevenLabs" : "browser"}</span>
        </span>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 pb-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Viewfinder
            ref={viewRef}
            source={source}
            status={status}
            orientation={orientationFor(settings)}
            mirror={source.kind === "webcam"}
            burst={settings.burst}
            discard={settings.discard}
            delayMs={settings.delayMs}
            overlay={overlay}
          />
          <div className="grid grid-cols-3 gap-2">
            {HINTS.map(([key, label, hint], i) => (
              <button
                key={key}
                onClick={(e) => {
                  e.currentTarget.blur();
                  onAction((["click", "hold", "double"] as const)[i]);
                }}
                className="rounded-xl border border-stone-200 bg-white px-3 py-3 text-left hover:bg-stone-100"
                data-testid={`btn-${label.toLowerCase()}`}
              >
                <div className="font-semibold">
                  {label} <kbd className="ml-1 rounded bg-stone-100 px-1.5 text-xs font-normal text-stone-500">{key}</kbd>
                </div>
                <div className="text-xs text-stone-500">{hint}</div>
              </button>
            ))}
          </div>
          <form onSubmit={submitTyped} className="flex gap-2">
            <input
              ref={askInputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={waitingForTyped ? "Type your question and press Enter" : "Ask about this, or about anything you've looked at…"}
              className={`min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 ${waitingForTyped ? "border-indigo-400 ring-2 ring-indigo-200" : "border-stone-200"}`}
              data-testid="ask-input"
            />
            <button className="rounded-xl bg-stone-900 px-4 py-2 font-medium text-white" data-testid="ask-submit">
              Ask
            </button>
          </form>
          {qu.notice && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="notice">
              {qu.notice}
            </p>
          )}
          <SourceSettings settings={settings} onChange={setSettings} source={source} status={status} buttonStatus={null} />
          {source.kind === "webcam" && cameras.length > 1 && (
            <select
              value={cameraId ?? ""}
              onChange={(e) => setCameraId(e.target.value || undefined)}
              className="w-fit rounded border border-stone-200 bg-white px-2 py-1 text-xs"
            >
              <option value="">Default camera</option>
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>
                  {c.label || c.deviceId.slice(0, 8)}
                </option>
              ))}
            </select>
          )}
          {still && <p className="text-xs text-stone-500">Ring mode: the camera wakes on each press.</p>}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <AnswerCard entry={last} phase={qu.phase} />
          <div className="flex gap-2 text-sm">
            <button onClick={qu.repeat} className="rounded-lg border border-stone-200 bg-white px-3 py-1 hover:bg-stone-100" data-testid="repeat">
              Repeat
            </button>
            <button onClick={() => speaker.stop()} className="rounded-lg border border-stone-200 bg-white px-3 py-1 hover:bg-stone-100" data-testid="stop">
              Stop talking
            </button>
          </div>
          <Notebook entries={qu.entries} onEnd={qu.endSession} />
        </div>
      </main>
    </div>
  );
}
