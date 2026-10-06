// Qu's core loop. One press:
//   tick -> best frame -> quality gate -> same-view cache -> stream answer from the hub -> speak each sentence -> notebook
// click = look, hold = ask (photo + spoken question), double = more about the last look.
import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerStream } from "./answer";
import { goalFrom } from "./ask";
import { jpegBase64, thumbnail } from "./encode";
import { fingerprint } from "./fingerprint";
import { HubUnavailable, hubHealth, streamLook, type LookBody } from "./look";
import {
  contextLines,
  findSameView,
  loadGoal,
  loadNotebook,
  newId,
  saveGoal,
  saveNotebook,
  sameAnswer,
  type Entry,
  type LookMode,
} from "./notebook";
import { PROBLEM_TEXT, measure } from "./quality";
import { speaker } from "./speaker";
import type { Shot } from "../components/Viewfinder";
import type { FeedbackKind } from "../vision/input/types";

export type Phase = "idle" | "capturing" | "listening" | "thinking" | "speaking";

export interface QuDeps {
  capture: () => Promise<Shot | null>;
  feedback: (kind: FeedbackKind) => void;
}

const RETRY_PENDING_MS = 10_000;

export const SAY = {
  noPicture: "No picture from the camera.",
  offline: "Can't reach Qu right now. I saved it for later.",
  failed: "Sorry, that didn't work. Try again.",
  nothingYet: "Point at something first.",
  goalSet: "Got it. I'll keep that in mind.",
  noQuestion: "I didn't catch a question.",
};

export function useQu(deps: QuDeps) {
  const [entries, setEntries] = useState<Entry[]>(loadNotebook);
  const [goal, setGoalState] = useState(loadGoal);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const goalRef = useRef(goal);
  goalRef.current = goal;
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const retryingRef = useRef(false);
  /** A look still taking its picture. The ring sends "click" at once and "double" only if a second press follows,
   *  so a double-press arrives while the click's look is capturing: "more" waits for it and uses that photo. */
  const capturingLookRef = useRef<Promise<Entry | null> | null>(null);

  useEffect(() => saveNotebook(entries), [entries]);
  useEffect(() => {
    return speaker.onChange((s) => setPhase((p) => (s ? "speaking" : p === "speaking" ? "idle" : p)));
  }, []);

  const patch = useCallback((id: string, p: Partial<Entry>) => {
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...p } : e)));
  }, []);

  const add = useCallback((e: Entry) => {
    entriesRef.current = [...entriesRef.current, e];
    setEntries(entriesRef.current);
  }, []);

  const say = (text: string) => speaker.say(text);

  /** Start a new interaction: stop talking, cancel whatever was in flight. Returns its sequence number. */
  const begin = () => {
    speaker.stop();
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setNotice(null);
    return ++seqRef.current;
  };

  const body = (mode: LookMode, extra: Partial<LookBody>): LookBody => ({
    mode,
    notebook: contextLines(entriesRef.current),
    goal: goalRef.current || undefined,
    ...extra,
  });

  /**
   * Stream an answer into entry `id`. Speaks each sentence as it completes unless `silent`.
   * Returns the final answer, or null if it failed (entry is marked pending or error).
   */
  const answer = async (id: string, req: LookBody, opts: { silent?: boolean; seq: number; t0: number }) => {
    const parser = new AnswerStream();
    const signal = abortRef.current?.signal;
    let firstAt = -1;
    const speakAll = (sentences: string[]) => {
      if (opts.silent || opts.seq !== seqRef.current) return;
      for (const s of sentences) {
        if (firstAt < 0) firstAt = performance.now();
        say(s);
      }
    };
    setPhase("thinking");
    try {
      const done = await streamLook(
        req,
        (text) => {
          speakAll(parser.push(text));
          const r = parser.result();
          if (!opts.silent && r.headline) patch(id, { headline: r.headline, detail: r.detail });
        },
        signal
      );
      speakAll(parser.end());
      const r = parser.result();
      const final = {
        headline: r.headline || "No answer.",
        detail: r.detail,
        kind: r.meta?.kind,
        title: r.meta?.title || r.headline.split(/\s+/).slice(0, 3).join(" "),
        place: r.meta?.place ?? "",
      };
      if (!opts.silent) {
        patch(id, { ...final, status: "done", ttftMs: firstAt > 0 ? Math.round(firstAt - opts.t0) : undefined, ms: Math.round(performance.now() - opts.t0) });
      }
      console.info("[qu]", JSON.stringify({ mode: req.mode, model: done.model, firstSentenceMs: firstAt > 0 ? Math.round(firstAt - opts.t0) : null, hubTtftMs: done.ttftMs, totalMs: Math.round(performance.now() - opts.t0) }));
      if (opts.seq === seqRef.current && !speaker.busy()) setPhase("idle");
      return final;
    } catch (err) {
      if (signal?.aborted) {
        // a newer press interrupted this answer: keep what arrived
        const r = parser.result();
        if (!opts.silent) patch(id, r.headline ? { headline: r.headline, detail: r.detail, status: "done", title: r.meta?.title || r.headline.split(/\s+/).slice(0, 3).join(" ") } : { headline: "Interrupted", status: "error" });
        return null;
      }
      const offline = err instanceof HubUnavailable;
      console.warn("[qu] answer failed:", (err as Error).message);
      if (!opts.silent) {
        patch(id, { status: offline ? "pending" : "error", headline: offline ? "Saved for later" : (err as Error).message });
        if (opts.seq === seqRef.current) {
          depsRef.current.feedback("error");
          say(offline ? SAY.offline : SAY.failed);
          const msg = (err as Error).message;
          setNotice(offline && msg.startsWith("hub unreachable") ? "Hub unreachable: run npm run hub" : msg);
        }
      }
      if (opts.seq === seqRef.current && !speaker.busy()) setPhase("idle");
      return null;
    }
  };

  /** Take the picture. Returns it with the quality verdict already spoken if it failed. */
  const shoot = async (seq: number) => {
    setPhase("capturing");
    let shot: Shot | null = null;
    try {
      shot = await depsRef.current.capture();
    } catch (err) {
      console.warn("[qu] capture failed:", (err as Error).message);
    }
    if (seq !== seqRef.current) return null;
    if (!shot) {
      setPhase("idle");
      depsRef.current.feedback("error");
      say(SAY.noPicture);
      setNotice(SAY.noPicture);
      return null;
    }
    return { shot, quality: measure(shot.image) };
  };

  const look = useCallback(async () => {
    const seq = begin();
    const t0 = performance.now();
    depsRef.current.feedback("captured");
    let settle: (e: Entry | null) => void = () => {};
    const capturing = new Promise<Entry | null>((r) => (settle = r));
    capturingLookRef.current = capturing;
    const done = (e: Entry | null) => {
      settle(e);
      if (capturingLookRef.current === capturing) capturingLookRef.current = null;
    };
    const got = await shoot(seq);
    if (!got) return done(null);
    const { shot, quality } = got;
    if (quality.problem) {
      depsRef.current.feedback("error");
      say(PROBLEM_TEXT[quality.problem]);
      setNotice(`${PROBLEM_TEXT[quality.problem]} (sharpness ${Math.round(quality.sharpness)}, light ${Math.round(quality.brightness)})`);
      setPhase("idle");
      return done(null);
    }
    const fp = fingerprint(shot.image);
    const image = jpegBase64(shot.image);
    const entry: Entry = { id: newId(), at: Date.now(), mode: "look", headline: "", detail: "", title: "", place: "", thumb: thumbnail(shot.image), image, fingerprint: fp, status: "answering" };
    const hit = findSameView(entriesRef.current, fp);
    if (hit) {
      // Instant replay, then check it's still right in the background.
      const replay: Entry = { ...entry, headline: hit.headline, detail: hit.detail, title: hit.title, place: hit.place, kind: hit.kind, cachedFrom: hit.id, ttftMs: Math.round(performance.now() - t0) };
      add(replay);
      done(replay);
      depsRef.current.feedback("highlight");
      say(hit.headline);
      const fresh = await answer(entry.id, body("look", { image }), { silent: true, seq, t0 });
      const current = seq === seqRef.current;
      if (fresh && !sameAnswer(fresh.headline, hit.headline)) {
        if (current) say(`Correction: ${fresh.headline}`);
        patch(entry.id, { ...fresh, status: "done", cachedFrom: undefined });
      } else {
        // the replayed answer stands (also when a newer press cut the re-check short)
        patch(entry.id, { status: "done", ms: Math.round(performance.now() - t0) });
      }
      if (!current) return;
      if (!speaker.busy()) setPhase("idle");
      return;
    }
    add(entry);
    done(entry);
    await answer(entry.id, body("look", { image }), { seq, t0 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Hold: photo now, then the question (spoken, or typed when `typed` is given). */
  const ask = useCallback(async (getQuestion: () => Promise<string>, opts: { photo?: boolean } = {}) => {
    const seq = begin();
    const t0 = performance.now();
    depsRef.current.feedback("captured");
    let image: string | undefined;
    let thumb: string | undefined;
    if (opts.photo !== false) {
      setPhase("capturing");
      try {
        const shot = await depsRef.current.capture();
        if (shot && !measure(shot.image).problem) {
          image = jpegBase64(shot.image);
          thumb = thumbnail(shot.image);
        }
      } catch {
        // no photo: the question can still be answered from the notebook
      }
    }
    if (seq !== seqRef.current) return;
    setPhase("listening");
    depsRef.current.feedback("on-target");
    let question = "";
    try {
      question = (await getQuestion()).trim();
    } catch (err) {
      setNotice((err as Error).message);
    }
    if (seq !== seqRef.current) return;
    if (!question) {
      setPhase("idle");
      say(SAY.noQuestion);
      return;
    }
    const g = goalFrom(question);
    if (g) {
      setGoalState(g);
      saveGoal(g);
      setPhase("idle");
      say(SAY.goalSet);
      return;
    }
    const mode: LookMode = image ? "ask" : "recall";
    const entry: Entry = { id: newId(), at: Date.now(), mode, question, headline: "", detail: "", title: "", place: "", thumb, image, status: "answering" };
    add(entry);
    await answer(entry.id, body(mode, { image, question }), { seq, t0 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const more = useCallback(async () => {
    const capturing = capturingLookRef.current;
    if (capturing && !(await capturing)) return; // that look already said what went wrong (dark, blurry, no picture)
    // double-pressing while Qu is still answering means "more about this", so in-progress looks count too
    const last = [...entriesRef.current].reverse().find((e) => e.image && (e.status === "done" || e.status === "answering") && e.mode !== "more");
    const seq = begin();
    const t0 = performance.now();
    depsRef.current.feedback("select");
    if (!last?.image) {
      say(SAY.nothingYet);
      return;
    }
    const entry: Entry = { id: newId(), at: Date.now(), mode: "more", headline: "", detail: "", title: last.title, place: last.place, thumb: last.thumb, status: "answering" };
    add(entry);
    await answer(entry.id, body("more", { image: last.image, previous: `${last.headline} ${last.detail}`.trim() }), { seq, t0 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Answer looks that were saved while the hub was down, oldest first. */
  const retryPending = useCallback(async () => {
    if (retryingRef.current) return;
    const pending = entriesRef.current.filter((e) => e.status === "pending" && (e.image || e.question));
    if (pending.length === 0) return;
    if (!(await hubHealth())?.ok) return;
    retryingRef.current = true;
    try {
      for (const e of pending) {
        if (speaker.busy() || phase === "listening") break;
        const seq = seqRef.current;
        patch(e.id, { status: "answering", headline: "" });
        const fresh = await answer(e.id, body(e.mode, { image: e.image, question: e.question }), { silent: true, seq, t0: performance.now() });
        if (fresh) {
          patch(e.id, { ...fresh, status: "done" });
          if (seq === seqRef.current) say(`About your earlier ${e.mode === "look" ? "photo" : "question"}: ${fresh.headline}`);
        } else {
          patch(e.id, { status: "pending" });
          break;
        }
      }
    } finally {
      retryingRef.current = false;
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!entries.some((e) => e.status === "pending")) return;
    const t = setInterval(() => void retryPending(), RETRY_PENDING_MS);
    return () => clearInterval(t);
  }, [entries, retryPending]);

  const setGoal = useCallback((g: string) => {
    setGoalState(g);
    saveGoal(g);
  }, []);

  const endSession = useCallback(() => {
    begin();
    entriesRef.current = [];
    setEntries([]);
    setGoal("");
    setPhase("idle");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const repeat = useCallback(() => {
    const last = [...entriesRef.current].reverse().find((e) => e.status === "done");
    begin();
    if (last) say(`${last.headline} ${last.detail}`.trim());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { entries, goal, setGoal, phase, notice, look, ask, more, repeat, endSession, retryPending };
}
