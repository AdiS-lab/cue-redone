// Browser SpeechSynthesis, one utterance at a time. The fallback voice when ElevenLabs isn't available.
let rate = 1.05;

export function setSpeechRate(r: number): void {
  rate = Math.min(2, Math.max(0.5, r));
}

export function speechRate(): number {
  return rate;
}

export function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    // Some systems never fire onend (no voices installed); don't hang the queue
    const safety = setTimeout(() => resolve(), 2000 + text.split(/\s+/).length * 450);
    const finish = () => {
      clearTimeout(safety);
      resolve();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
}

export function browserStop(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
