import { useState } from "react";
import {
  HAND_PRESETS,
  ROTATIONS,
  type FrameSource,
  type Rotation,
  type StatusInfo,
} from "../vision/sources";
import { ringBle } from "../vision/sources/bleLink";
import { FileSource } from "../vision/sources/FileSource";
import {
  MAX_BURST,
  MAX_DELAY_MS,
  MAX_DISCARD,
  SOURCE_KINDS,
  defaultOrientation,
  isStillSource,
  orientationFor,
  withOrientation,
  type ButtonKind,
  type SourceSettings as Settings,
} from "../vision/settings";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  source: FrameSource | null;
  status: StatusInfo | null;
  buttonStatus: StatusInfo | null;
}

const blur = (e: { currentTarget: HTMLElement }) => e.currentTarget.blur();

export function SourceSettings({
  settings,
  onChange,
  source,
  status,
  buttonStatus,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pairError, setPairError] = useState("");
  const o = orientationFor(settings);
  const usesBle = settings.kind === "ble" || settings.buttonKind === "ble";

  const pair = async () => {
    setPairError("");
    try {
      await ringBle().pair();
    } catch (err) {
      setPairError(String((err as Error).message ?? err));
    }
  };

  return (
    <div className="w-full max-w-2xl text-xs text-gray-600" data-testid="source-settings">
      <button
        onClick={(e) => {
          setOpen((v) => !v);
          blur(e);
        }}
        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-100"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span className="font-medium">Camera & ring</span>
        <span className="text-gray-400">
          {SOURCE_KINDS.find((k) => k.kind === settings.kind)?.label}
          {status ? ` · ${status.status}` : ""}
          {settings.buttonKind !== "none" && buttonStatus ? ` · button ${buttonStatus.status}` : ""}
        </span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 items-center bg-white border border-gray-200 rounded-xl p-3">
          <label htmlFor="src-kind">Camera source</label>
          <select
            id="src-kind"
            value={settings.kind}
            onChange={(e) => {
              onChange({ ...settings, kind: e.target.value as Settings["kind"] });
              blur(e);
            }}
            className="border border-gray-200 rounded px-1 py-0.5 bg-white"
          >
            {SOURCE_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>

          {settings.kind === "ws" && (
            <>
              <label htmlFor="src-url">Camera URL</label>
              <input
                id="src-url"
                defaultValue={settings.wsUrl}
                onBlur={(e) => onChange({ ...settings, wsUrl: e.target.value.trim() })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="border border-gray-200 rounded px-1 py-0.5 font-mono"
              />
              <label htmlFor="src-mode">Frames</label>
              <select
                id="src-mode"
                value={settings.wsMode}
                onChange={(e) => {
                  onChange({ ...settings, wsMode: e.target.value as Settings["wsMode"] });
                  blur(e);
                }}
                className="border border-gray-200 rounded px-1 py-0.5 bg-white"
              >
                <option value="stream">Live stream</option>
                <option value="still">One photo per press</option>
              </select>
            </>
          )}

          {settings.kind === "file" && source instanceof FileSource && (
            <>
              <span>Images</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    void source.pick();
                    blur(e);
                  }}
                  className="px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-50"
                >
                  Choose images…
                </button>
                <span className="text-gray-400">{status?.message}</span>
              </div>
            </>
          )}

          {isStillSource(settings) && (
            <>
              <label htmlFor="burst">Photos per press</label>
              <div className="flex items-center gap-2">
                <select
                  id="burst"
                  value={settings.burst}
                  onChange={(e) => {
                    onChange({ ...settings, burst: Number(e.target.value) });
                    blur(e);
                  }}
                  className="border border-gray-200 rounded px-1 py-0.5 bg-white"
                >
                  {Array.from({ length: MAX_BURST }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="text-gray-400">
                  The sharpest is used. More photos help with shaky hands but take longer over Bluetooth.
                </span>
              </div>
              <label htmlFor="discard">Skip first photos</label>
              <div className="flex items-center gap-2">
                <select
                  id="discard"
                  value={settings.discard}
                  onChange={(e) => {
                    onChange({ ...settings, discard: Number(e.target.value) });
                    blur(e);
                  }}
                  className="border border-gray-200 rounded px-1 py-0.5 bg-white"
                >
                  {Array.from({ length: MAX_DISCARD + 1 }, (_, i) => i).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <span className="text-gray-400">
                  Small cameras often give dark or off-color pictures right after waking up.
                </span>
              </div>
              <label htmlFor="delay">Wait after press</label>
              <div className="flex items-center gap-2">
                <NumberField
                  id="delay"
                  value={settings.delayMs}
                  max={MAX_DELAY_MS}
                  onChange={(delayMs) => onChange({ ...settings, delayMs })}
                />
                <span className="text-gray-400">ms, lets the hand settle before the photos are taken</span>
              </div>
            </>
          )}

          {settings.kind === "file" && (
            <>
              <span>Simulate ring</span>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1">
                  wake frames
                  <NumberField
                    value={settings.sim.wakeFrames}
                    max={MAX_DISCARD}
                    onChange={(wakeFrames) => onChange({ ...settings, sim: { ...settings.sim, wakeFrames } })}
                  />
                </label>
                <label className="flex items-center gap-1">
                  wake ms
                  <NumberField
                    value={settings.sim.wakeMs}
                    max={MAX_DELAY_MS}
                    onChange={(wakeMs) => onChange({ ...settings, sim: { ...settings.sim, wakeMs } })}
                  />
                </label>
                <label className="flex items-center gap-1">
                  ms per photo
                  <NumberField
                    value={settings.sim.frameMs}
                    max={MAX_DELAY_MS}
                    onChange={(frameMs) => onChange({ ...settings, sim: { ...settings.sim, frameMs } })}
                  />
                </label>
                <label className="flex items-center gap-1">
                  shake
                  <NumberField
                    value={settings.sim.shake}
                    max={8}
                    onChange={(shake) => onChange({ ...settings, sim: { ...settings.sim, shake } })}
                  />
                </label>
              </div>
            </>
          )}

          <label htmlFor="btn-kind">Ring button</label>
          <select
            id="btn-kind"
            value={settings.buttonKind}
            onChange={(e) => {
              onChange({ ...settings, buttonKind: e.target.value as ButtonKind });
              blur(e);
            }}
            className="border border-gray-200 rounded px-1 py-0.5 bg-white"
          >
            <option value="none">Keyboard only</option>
            <option value="ws">Wi-Fi (WebSocket)</option>
            <option value="ble">Bluetooth</option>
          </select>
          {settings.buttonKind === "ws" && (
            <>
              <label htmlFor="btn-url">Button URL</label>
              <input
                id="btn-url"
                placeholder={`same as camera (${settings.wsUrl})`}
                defaultValue={settings.buttonUrl}
                onBlur={(e) => onChange({ ...settings, buttonUrl: e.target.value.trim() })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                className="border border-gray-200 rounded px-1 py-0.5 font-mono"
              />
            </>
          )}

          {usesBle && (
            <>
              <span>Bluetooth</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => {
                    void pair();
                    blur(e);
                  }}
                  className="px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-50"
                >
                  Pair ring
                </button>
                {pairError && <span className="text-red-600">{pairError}</span>}
              </div>
            </>
          )}

          <label htmlFor="hand">Hand</label>
          <select
            id="hand"
            value={settings.hand}
            onChange={(e) => {
              onChange({ ...settings, hand: e.target.value as Settings["hand"] });
              blur(e);
            }}
            className="border border-gray-200 rounded px-1 py-0.5 bg-white"
          >
            <option value="right">Right hand</option>
            <option value="left">Left hand</option>
          </select>

          <span>Frame orientation</span>
          <div className="flex flex-wrap items-center gap-3">
            <select
              aria-label="Rotation"
              value={o.rotation}
              onChange={(e) => {
                onChange(withOrientation(settings, { ...o, rotation: Number(e.target.value) as Rotation }));
                blur(e);
              }}
              className="border border-gray-200 rounded px-1 py-0.5 bg-white"
            >
              {ROTATIONS.map((r) => (
                <option key={r} value={r}>
                  Rotate {r}°
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={o.mirror}
                onChange={(e) => {
                  onChange(withOrientation(settings, { ...o, mirror: e.target.checked }));
                  blur(e);
                }}
              />
              Flip image
            </label>
            <button
              onClick={(e) => {
                onChange(withOrientation(settings, HAND_PRESETS[settings.hand]));
                blur(e);
              }}
              className="px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-50"
            >
              Ring {settings.hand}-hand preset
            </button>
            <button
              onClick={(e) => {
                onChange(withOrientation(settings, defaultOrientation(settings.kind, settings.hand)));
                blur(e);
              }}
              className="px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-50"
            >
              Reset
            </button>
          </div>
          <span>Feedback</span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.beep}
                onChange={(e) => {
                  onChange({ ...settings, beep: e.target.checked });
                  blur(e);
                }}
              />
              Tick/vibrate on this device when the ring is pressed
            </label>
            <span className="text-gray-400">The ring also gets “got it” / error feedback if it supports it.</span>
          </div>

          <span />
          <span className="text-gray-400">
            Orientation is saved per camera source and hand, and is applied before the photo is sent,
            so Qu always sees an upright picture.
          </span>
        </div>
      )}
    </div>
  );
}

function NumberField({
  id,
  value,
  max,
  onChange,
}: {
  id?: string;
  value: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <input
      id={id}
      type="number"
      min={0}
      max={max}
      defaultValue={value}
      onBlur={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.max(0, Math.min(max, n)));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="w-16 border border-gray-200 rounded px-1 py-0.5"
    />
  );
}
