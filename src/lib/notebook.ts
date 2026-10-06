// The session notebook: every look, ask and recall, newest last.
// It is what makes Qu smarter over a session: the last entries go with each request,
// it is what "what did that label say?" is answered from, and it is the instant-replay cache.
import type { AnswerMeta } from "./answer";
import { sameView, similarity, type Fingerprint } from "./fingerprint";

export type LookMode = "look" | "ask" | "more" | "recall";
export type EntryStatus = "answering" | "done" | "pending" | "error";

export interface Entry {
  id: string;
  at: number;
  mode: LookMode;
  question?: string;
  headline: string;
  detail: string;
  kind?: AnswerMeta["kind"];
  title: string;
  place: string;
  /** Small JPEG data URL for the UI. */
  thumb?: string;
  /** Full-size JPEG base64 (no prefix) kept in memory only, for "more" and pending retries. */
  image?: string;
  fingerprint?: Fingerprint;
  status: EntryStatus;
  /** Answer was replayed from an earlier look. */
  cachedFrom?: string;
  ms?: number;
  ttftMs?: number;
}

/** What the hub receives for each earlier entry (see server/prompt.ts NotebookLine). */
export interface NotebookLine {
  agoMin: number;
  title: string;
  headline: string;
  kind?: string;
  place?: string;
  question?: string;
  detail?: string;
}

export const CONTEXT_ENTRIES = 12;
const STORE_KEY = "qu.notebook.v1";
const GOAL_KEY = "qu.goal.v1";
const MAX_STORED = 60;
/** Cache hits older than this are not replayed (things change). */
export const CACHE_MAX_AGE_MS = 30 * 60_000;

export function contextLines(entries: Entry[], now = Date.now(), max = CONTEXT_ENTRIES): NotebookLine[] {
  return entries
    .filter((e) => e.status === "done" && e.headline)
    .slice(-max)
    .map((e) => ({
      agoMin: Math.max(0, Math.round((now - e.at) / 60_000)),
      title: e.title,
      headline: e.headline,
      kind: e.kind,
      place: e.place || undefined,
      question: e.question,
      detail: e.detail ? e.detail.slice(0, 300) : undefined,
    }));
}

/** The closest earlier *look* of the same view, if any, recent enough to replay. */
export function findSameView(entries: Entry[], fp: Fingerprint, now = Date.now()): Entry | null {
  let best: Entry | null = null;
  let bestScore = -1;
  for (const e of entries) {
    if (e.mode !== "look" || e.status !== "done" || !e.fingerprint || e.cachedFrom) continue;
    if (now - e.at > CACHE_MAX_AGE_MS) continue;
    if (!sameView(e.fingerprint, fp)) continue;
    const s = similarity(e.fingerprint, fp);
    if (s >= bestScore) {
      // ties go to the newest look
      best = e;
      bestScore = s;
    }
  }
  return best;
}

/** Most recent place the model guessed, for the header ("in a pharmacy"). */
export function currentPlace(entries: Entry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) if (entries[i].place) return entries[i].place;
  return "";
}

/**
 * Two headlines say materially the same thing: most words shared (ignoring case, punctuation, small words)
 * and the same numbers (200 mg vs 500 mg is a different answer).
 */
export function sameAnswer(a: string, b: string): boolean {
  const numbers = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).sort().join(",");
  if (numbers(a) !== numbers(b)) return false;
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return wa.size === wb.size;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size) >= 0.6;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadNotebook(): Entry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as Entry[];
    // anything that was mid-answer when the tab closed is not coming back
    return Array.isArray(raw) ? raw.map((e) => (e.status === "answering" ? { ...e, status: "error" as const } : e)) : [];
  } catch {
    return [];
  }
}

export function saveNotebook(entries: Entry[]): void {
  try {
    // full images stay in memory; pending entries lose theirs on reload and become errors
    const slim = entries.slice(-MAX_STORED).map(({ image: _image, ...e }) => (e.status === "pending" ? { ...e, status: "error" as const } : e));
    localStorage.setItem(STORE_KEY, JSON.stringify(slim));
  } catch {
    return;
  }
}

export function loadGoal(): string {
  try {
    return localStorage.getItem(GOAL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveGoal(goal: string): void {
  try {
    if (goal) localStorage.setItem(GOAL_KEY, goal);
    else localStorage.removeItem(GOAL_KEY);
  } catch {
    return;
  }
}
