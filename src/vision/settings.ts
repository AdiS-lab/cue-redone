import { HAND_PRESETS, IDENTITY, ROTATIONS, type Hand, type Orientation, type Rotation } from "./sources/orient";
import type { SourceKind, SourceMode } from "./sources/types";
import type { BurstSimulation } from "./sources/FileSource";

export type ButtonKind = "none" | "ws" | "ble";

export interface SourceSettings {
  kind: SourceKind;
  wsUrl: string;
  wsMode: SourceMode;
  buttonKind: ButtonKind;
  buttonUrl: string;
  hand: Hand;
  burst: number;
  discard: number;
  delayMs: number;
  sim: BurstSimulation;
  beep: boolean;
  orientations: Partial<Record<string, Orientation>>;
}

export const SOURCE_KINDS: { kind: SourceKind; label: string }[] = [
  { kind: "webcam", label: "Webcam / USB camera" },
  { kind: "ws", label: "Wi-Fi camera (WebSocket)" },
  { kind: "ble", label: "Bluetooth ring (photos on press)" },
  { kind: "file", label: "Image files" },
];

export const DEFAULT_SETTINGS: SourceSettings = {
  kind: "webcam",
  wsUrl: "ws://192.168.4.1:81/",
  wsMode: "stream",
  buttonKind: "none",
  buttonUrl: "",
  hand: "right",
  burst: 3,
  discard: 1,
  delayMs: 0,
  sim: { wakeFrames: 0, wakeMs: 0, frameMs: 0, shake: 0 },
  beep: true,
  orientations: {},
};

const KEY = "cue.vision.source.v1";

export const MAX_BURST = 5;
export const MAX_DISCARD = 3;
export const MAX_DELAY_MS = 3000;

function intParam(q: URLSearchParams, name: string, min: number, max: number): number | null {
  const raw = q.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

export function isStillSource(s: SourceSettings): boolean {
  return s.kind === "ble" || s.kind === "file" || (s.kind === "ws" && s.wsMode === "still");
}

export function orientationKey(kind: SourceKind, hand: Hand): string {
  return `${kind}:${hand}`;
}

export function defaultOrientation(kind: SourceKind, hand: Hand): Orientation {
  return kind === "webcam" || kind === "file" ? IDENTITY : HAND_PRESETS[hand];
}

export function orientationFor(s: SourceSettings): Orientation {
  return s.orientations[orientationKey(s.kind, s.hand)] ?? defaultOrientation(s.kind, s.hand);
}

export function withOrientation(s: SourceSettings, o: Orientation): SourceSettings {
  return { ...s, orientations: { ...s.orientations, [orientationKey(s.kind, s.hand)]: o } };
}

function isKind(v: string | null): v is SourceKind {
  return v === "webcam" || v === "ws" || v === "ble" || v === "file";
}

function isRotation(n: number): n is Rotation {
  return (ROTATIONS as number[]).includes(n);
}

export function parseQuery(search: string, base: SourceSettings): SourceSettings {
  const q = new URLSearchParams(search);
  let s = { ...base };
  const source = q.get("source");
  if (isKind(source)) s.kind = source;
  const url = q.get("url");
  if (url) s.wsUrl = url;
  const mode = q.get("mode");
  if (mode === "stream" || mode === "still") s.wsMode = mode;
  const hand = q.get("hand");
  if (hand === "left" || hand === "right") s.hand = hand;
  const burst = Number(q.get("burst"));
  if (Number.isInteger(burst) && burst >= 1 && burst <= MAX_BURST) s.burst = burst;
  const discard = intParam(q, "discard", 0, MAX_DISCARD);
  if (discard !== null) s.discard = discard;
  const delay = intParam(q, "delay", 0, MAX_DELAY_MS);
  if (delay !== null) s.delayMs = delay;
  const sim = { ...s.sim };
  const simWake = intParam(q, "simwake", 0, MAX_DISCARD);
  if (simWake !== null) sim.wakeFrames = simWake;
  const simWakeMs = intParam(q, "simwakems", 0, MAX_DELAY_MS);
  if (simWakeMs !== null) sim.wakeMs = simWakeMs;
  const simFrameMs = intParam(q, "simframems", 0, MAX_DELAY_MS);
  if (simFrameMs !== null) sim.frameMs = simFrameMs;
  const simShake = q.get("simshake");
  if (simShake !== null && Number.isFinite(Number(simShake))) sim.shake = Math.max(0, Math.min(8, Number(simShake)));
  s.sim = sim;
  const beep = q.get("beep");
  if (beep !== null) s.beep = beep === "1" || beep === "true";
  const button = q.get("button");
  if (button === "none" || button === "ws" || button === "ble") s.buttonKind = button;
  const buttonUrl = q.get("buttonUrl");
  if (buttonUrl) s.buttonUrl = buttonUrl;
  const rotate = q.get("rotate");
  const mirror = q.get("flip");
  if (rotate !== null || mirror !== null) {
    const cur = orientationFor(s);
    const r = Number(rotate);
    s = withOrientation(s, {
      rotation: rotate !== null && isRotation(r) ? r : cur.rotation,
      mirror: mirror !== null ? mirror === "1" || mirror === "true" : cur.mirror,
    });
  }
  return s;
}

export function loadSourceSettings(search = window.location.search): SourceSettings {
  let stored: Partial<SourceSettings> = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SourceSettings>;
  } catch {
    stored = {};
  }
  return parseQuery(search, { ...DEFAULT_SETTINGS, ...stored, sim: { ...DEFAULT_SETTINGS.sim, ...stored.sim } });
}

export function saveSourceSettings(s: SourceSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    return;
  }
}
