// "Hold to ask": listen for one spoken question with the browser's speech recognition.
// Ends by itself when the speaker pauses. Chrome sends the audio to its speech service, so this needs a network.
// Where speech recognition is missing (Firefox, some embedded browsers) the UI's text box is the fallback.

interface RecognitionResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: { results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function canListen(): boolean {
  return ctor() !== null;
}

export interface ListenHandle {
  /** Resolves with the question, or "" if nothing was said. Rejects if the mic is unavailable. */
  result: Promise<string>;
  /** Stop early and use what was heard so far. */
  stop(): void;
  cancel(): void;
}

export function listenForQuestion(onPartial?: (text: string) => void, maxMs = 8000): ListenHandle {
  const Ctor = ctor();
  if (!Ctor) {
    return { result: Promise.reject(new Error("Speech recognition isn't available in this browser")), stop() {}, cancel() {} };
  }
  const rec = new Ctor();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  let heard = "";
  let cancelled = false;
  const result = new Promise<string>((resolve, reject) => {
    const limit = setTimeout(() => rec.stop(), maxMs);
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heard = text.trim();
      onPartial?.(heard);
    };
    rec.onerror = (e) => {
      clearTimeout(limit);
      if (e.error === "no-speech" || e.error === "aborted") return resolve(cancelled ? "" : heard);
      reject(new Error(e.error === "not-allowed" ? "Microphone permission denied" : `Speech recognition: ${e.error}`));
    };
    rec.onend = () => {
      clearTimeout(limit);
      resolve(cancelled ? "" : heard);
    };
  });
  rec.start();
  return {
    result,
    stop: () => rec.stop(),
    cancel: () => {
      cancelled = true;
      rec.abort();
    },
  };
}

/** Spoken goal-setting: "my goal is ...", "I'm shopping for ...". Returns the goal text or null. */
export function goalFrom(question: string): string | null {
  const m = /^(?:my goal is|goal:?|remember that|i(?:'m| am) (?=shopping|cooking|looking|trying|allergic))\s*(.+)$/i.exec(question.trim());
  if (!m) return null;
  const rest = m[1].replace(/[.!?]+$/, "").trim();
  return /^i(?:'m| am)/i.test(question.trim()) ? question.trim().replace(/[.!?]+$/, "") : rest;
}
