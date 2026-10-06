import type { Entry } from "../lib/notebook";

const MODE_LABEL: Record<Entry["mode"], string> = { look: "Look", ask: "Asked", more: "More", recall: "Recall" };

function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function seconds(ms?: number): string | null {
  return ms !== undefined && ms >= 0 ? `${(ms / 1000).toFixed(1)} s` : null;
}

export function AnswerCard({ entry, phase }: { entry: Entry | null; phase: string }) {
  if (!entry) {
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-5 text-stone-500" data-testid="answer">
        Point the ring at something and press. Qu tells you what matters about it.
      </div>
    );
  }
  const first = seconds(entry.ttftMs);
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5" data-testid="answer">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
        <span className="rounded-full bg-stone-100 px-2 py-0.5 font-medium text-stone-700">{MODE_LABEL[entry.mode]}</span>
        {entry.question && <span className="italic">“{entry.question}”</span>}
        {entry.cachedFrom && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">instant replay</span>}
        {entry.status === "pending" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">saved for later</span>}
        {first && <span data-testid="first-word">first words in {first}</span>}
      </div>
      <p className="text-2xl font-semibold leading-snug text-stone-900" data-testid="headline">
        {entry.headline || (phase === "thinking" ? "Looking…" : "…")}
      </p>
      {entry.detail && <p className="mt-2 text-lg leading-snug text-stone-700" data-testid="detail">{entry.detail}</p>}
    </div>
  );
}

export function Notebook({ entries, onEnd }: { entries: Entry[]; onEnd: () => void }) {
  const shown = [...entries].reverse();
  return (
    <section className="flex min-h-0 flex-col" data-testid="notebook">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">This session · {entries.length}</h2>
        {entries.length > 0 && (
          <button onClick={onEnd} className="rounded-lg px-2 py-1 text-xs text-stone-500 hover:bg-stone-100" data-testid="end-session">
            End session
          </button>
        )}
      </div>
      {shown.length === 0 && <p className="text-sm text-stone-400">Everything you point at is noted here, and Qu uses it to understand where you are.</p>}
      <ol className="min-h-0 space-y-2 overflow-y-auto">
        {shown.map((e) => (
          <li key={e.id} className="flex gap-3 rounded-xl border border-stone-200 bg-white p-2" data-testid="entry">
            {e.thumb ? (
              <img src={e.thumb} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-xl text-stone-400">?</div>
            )}
            <div className="min-w-0 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                <span>{timeOf(e.at)}</span>
                <span>{MODE_LABEL[e.mode]}</span>
                {e.place && <span>· {e.place}</span>}
                {e.cachedFrom && <span className="text-emerald-700">· replay</span>}
                {e.status === "pending" && <span className="text-amber-700">· waiting for hub</span>}
                {e.status === "error" && <span className="text-red-700">· failed</span>}
              </div>
              <div className="truncate font-medium text-stone-900">{e.title || e.question || "…"}</div>
              <div className="line-clamp-2 text-stone-600">{e.headline}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
