# Sudoku (web / Telegram Mini App)

A web port of the Android Sudoku app, playable in a browser or as a Telegram
Mini App on iPhone — no Mac, Xcode, or App Store needed.

The game logic (`src/game.ts`, `src/grader.ts`) is a hand port of the Android
app's Kotlin `SudokuGame` and `SudokuGrader`. The UI is HTML + a `<canvas>`
board (`src/board.ts`), a port of the Android `SudokuView`.

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

Open it in a normal browser to develop and play. Telegram-specific features
(native theming, haptics) degrade gracefully when not inside Telegram — outside
it, haptics fall back to `navigator.vibrate` (Android browsers only).

## Build

```bash
npm run build    # static site in dist/ (~6.5 KB gzipped)
npm run preview  # serve the built dist/
```

`dist/` is a fully static site — host it anywhere.

## Ship it as a Telegram Mini App

1. **Host `dist/` over HTTPS.** Free options: GitHub Pages, Cloudflare Pages,
   Vercel, Netlify. (Telegram requires HTTPS.)
2. **Create a bot:** message [@BotFather](https://t.me/BotFather) → `/newbot`,
   follow the prompts, save the token.
3. **Attach the web app:** BotFather → `/newapp` (or Bot Settings → Menu Button
   → set a URL) and point it at your hosted URL.
4. Open your bot in Telegram on your iPhone and tap the menu button / launch the
   app. It runs in Telegram's in-app browser, full screen, with native haptics.

For quick testing without hosting, run `npm run dev -- --host` and expose it via
a tunnel (e.g. `cloudflared tunnel --url http://localhost:5173`), then use that
HTTPS URL in step 3.

## What's implemented (core)

- 3 difficulties (Easy / Medium / Hard), graded by the same logical solver as
  the Android app
- Uniquely-solvable generation (backtracking + MRV), on demand
- Cell selection, number entry, pencil notes, undo, clear
- Peer / same-number / selection highlights; conflict coloring
- Timer, mistake count, difficulty display
- Save / resume via `localStorage`, auto-saved on every change and on background
- Light/dark board palettes (follows Telegram theme or OS preference)
- Haptics (Telegram HapticFeedback on iOS; `navigator.vibrate` elsewhere)

## Deferred (easy follow-ups)

- **Sound effects** — the 5 `.wav` files from the Android app
  (`res/raw/*.wav`) drop straight into a Web Audio player.
- **Completion animations** — the green unit-flash and gold win-wave from
  `SudokuView` (the `flashUnits` / `playWin` logic).
- **Puzzle pre-warm pool** — generate puzzles in a Web Worker so starting a new
  game is instant (Medium generation currently blocks ~0.3s behind a
  "Generating…" state).
```
