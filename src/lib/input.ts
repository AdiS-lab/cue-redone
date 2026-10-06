// Keyboard stand-in for the ring's single button:
//   Space = click (look), D = double-click (more), H = hold (ask).
import type { InputAction } from "./types";

type InputHandler = (action: InputAction) => void;

let handler: InputHandler | null = null;

const KEYS: Record<string, InputAction> = {
  Space: "click",
  KeyD: "double",
  KeyH: "hold",
};

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function onKeyDown(e: KeyboardEvent): void {
  const action = KEYS[e.code];
  if (!handler || !action) return;
  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  e.preventDefault();
  if (e.repeat) return;
  handler(action);
}

function onKeyUp(e: KeyboardEvent): void {
  // Stop a focused button from also being "clicked" by the space bar
  if (e.code === "Space" && !isTyping(e.target)) e.preventDefault();
}

export function startInputListening(h: InputHandler): void {
  handler = h;
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
}

export function stopInputListening(): void {
  handler = null;
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
}
