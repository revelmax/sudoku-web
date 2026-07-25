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
  /** "unknown" whenever the SDK has no Telegram host behind it. */
  platform: string;
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

const sdk = window.Telegram?.WebApp;

/**
 * True only when a real Telegram host is behind the SDK.
 *
 * telegram-web-app.js is loaded unconditionally from index.html, so
 * `window.Telegram.WebApp` exists on an ordinary page too — testing the object
 * alone would make every browser look like Telegram. Outside Telegram the SDK
 * reports platform "unknown" and stubs `colorScheme` to "light".
 */
export const inTelegram = !!sdk && sdk.platform !== "unknown";

/** The SDK, but only when it is actually backed by Telegram. */
const wa = inTelegram ? sdk : undefined;

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
