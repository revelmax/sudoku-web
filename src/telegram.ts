/**
 * Thin wrapper over the Telegram Mini App SDK (telegram-web-app.js, loaded in
 * index.html). Everything degrades gracefully when the page is opened outside
 * Telegram — so the same build runs as an ordinary web page for local testing.
 */

interface TgHaptic {
  impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  notificationOccurred(type: "error" | "success" | "warning"): void;
}

interface TgWebApp {
  ready(): void;
  expand(): void;
  colorScheme: "light" | "dark";
  HapticFeedback?: TgHaptic;
  onEvent(event: string, cb: () => void): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

const wa = window.Telegram?.WebApp;

/** True when running inside the Telegram in-app browser. */
export const inTelegram = !!wa;

/** Tell Telegram we're ready and take the full viewport. */
export function initTelegram(): void {
  if (!wa) return;
  wa.ready();
  wa.expand();
}

/** Dark mode: Telegram's scheme when present, else the OS/browser preference. */
export function prefersDark(): boolean {
  if (wa) return wa.colorScheme === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

/** A firm tap for placing a value, a lighter one for toggling a pencil mark. */
export function haptic(strong: boolean): void {
  const h = wa?.HapticFeedback;
  if (h) {
    h.impactOccurred(strong ? "medium" : "light");
    return;
  }
  // Fallback for Android browsers outside Telegram (iOS Safari ignores this).
  navigator.vibrate?.(strong ? 20 : 10);
}

/** A success buzz for solving the puzzle. */
export function hapticSuccess(): void {
  wa?.HapticFeedback?.notificationOccurred("success");
}

/** An error buzz for a wrong placement. */
export function hapticError(): void {
  wa?.HapticFeedback?.notificationOccurred("error");
}
