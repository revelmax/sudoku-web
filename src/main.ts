import { SudokuGame } from "./game";
import { BoardView } from "./board";
import { PuzzlePool } from "./pool";
import { Difficulty, DIFFICULTIES, Move } from "./types";
import { SoundManager, Sfx } from "./sound";
import { loadSettings, saveSettings, OPTION_INFO } from "./settings";
import {
  initTelegram,
  prefersDark,
  haptic,
  hapticError,
  hapticSuccess,
} from "./telegram";

const KEY_STATE = "sudoku.state";
const KEY_DIFFICULTY = "sudoku.difficulty";

initTelegram();
const dark = prefersDark();

const app = document.getElementById("app")!;
const game = new SudokuGame();
const sound = new SoundManager();
const pool = new PuzzlePool();
const settings = loadSettings();

// Web Audio starts suspended until a gesture (iOS especially). Unlock on the
// first pointer/key anywhere, once.
function unlockAudioOnce(): void {
  sound.unlock();
  window.removeEventListener("pointerdown", unlockAudioOnce);
  window.removeEventListener("keydown", unlockAudioOnce);
}
window.addEventListener("pointerdown", unlockAudioOnce);
window.addEventListener("keydown", unlockAudioOnce);

/** Create an element with an optional class. */
function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

/**
 * Icon set for the game screen's controls. Inline SVG rather than emoji so the
 * glyphs are identical across platforms and inherit the button's color (which
 * matters for the pencil button's active state). Stroke styling lives in CSS.
 */
const ICONS = {
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  gear:
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  refresh:
    '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>' +
    '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  undo: '<polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/>',
  pencil: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
  erase:
    '<path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21"/>' +
    '<path d="M22 21H7"/><path d="m5 11 9 9"/>',
} as const;

/**
 * An icon-only button. The name is kept as aria-label and tooltip so the control
 * is still identifiable to screen readers and on hover.
 */
function iconButton(
  name: keyof typeof ICONS,
  label: string,
  onclick: () => void,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.onclick = onclick;
  return b;
}

let board: BoardView | null = null;
let solvedState = false;
let generating = false;
let genToken = 0; // guards against a stale async puzzle overwriting a newer game

// --- Timer: game.elapsedMs is the accumulated total; runningSince marks the
// current running segment (0 = paused). A 1s tick refreshes the display. ---
let runningSince = 0;
let timerId: number | null = null;

function now(): number {
  return performance.now();
}

function startTimer(): void {
  if (runningSince === 0 && game.started && !game.isSolved()) {
    runningSince = now();
    if (timerId === null) timerId = window.setInterval(refreshStatus, 1000);
  }
}

function pauseTimer(): void {
  if (runningSince !== 0) {
    game.elapsedMs += now() - runningSince;
    runningSince = 0;
  }
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function hardResetTimer(): void {
  runningSince = 0;
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function syncElapsed(): void {
  if (runningSince !== 0) {
    const t = now();
    game.elapsedMs += t - runningSince;
    runningSince = t;
  }
}

function currentElapsedMs(): number {
  return game.elapsedMs + (runningSince !== 0 ? now() - runningSince : 0);
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return m >= 60
    ? `${Math.floor(m / 60)}:${pad(m % 60)}:${pad(s)}`
    : `${pad(m)}:${pad(s)}`;
}

// --- Persistence ---------------------------------------------------------

function save(): void {
  syncElapsed();
  try {
    localStorage.setItem(KEY_STATE, game.serialize());
  } catch {
    /* storage full or unavailable — ignore */
  }
}

function hasSavedGame(): boolean {
  return localStorage.getItem(KEY_STATE) !== null;
}

function savedDifficulty(): Difficulty {
  const d = localStorage.getItem(KEY_DIFFICULTY);
  return d && DIFFICULTIES.includes(d as Difficulty)
    ? (d as Difficulty)
    : Difficulty.MEDIUM;
}

// --- Menu screen ---------------------------------------------------------

function showMenu(): void {
  hardResetTimer();
  let chosen = savedDifficulty();

  app.innerHTML = "";
  const menu = el("div", "menu");

  const title = el("h1");
  title.textContent = "Sudoku";
  menu.appendChild(title);

  const label = el("div", "label");
  label.textContent = "Difficulty";
  menu.appendChild(label);

  const picker = el("div", "difficulty");
  const buttons: Record<string, HTMLButtonElement> = {};
  for (const d of DIFFICULTIES) {
    const b = document.createElement("button");
    b.textContent = d.charAt(0) + d.slice(1).toLowerCase();
    b.onclick = () => {
      chosen = d;
      for (const key in buttons) buttons[key].classList.toggle("selected", key === d);
    };
    buttons[d] = b;
    picker.appendChild(b);
  }
  buttons[chosen].classList.add("selected");
  menu.appendChild(picker);

  const newBtn = document.createElement("button");
  newBtn.className = "primary";
  newBtn.textContent = "New Game";
  newBtn.onclick = () => {
    localStorage.setItem(KEY_DIFFICULTY, chosen);
    showGame(chosen, false);
  };
  menu.appendChild(newBtn);

  const resumeBtn = document.createElement("button");
  resumeBtn.className = "secondary";
  resumeBtn.textContent = "Resume";
  resumeBtn.disabled = !hasSavedGame();
  resumeBtn.onclick = () => showGame(null, true);
  menu.appendChild(resumeBtn);

  const aidsBtn = document.createElement("button");
  aidsBtn.className = "secondary";
  aidsBtn.textContent = "⚙ Aids";
  aidsBtn.onclick = showSettings;
  menu.appendChild(aidsBtn);

  app.appendChild(menu);
}

// --- Game screen ---------------------------------------------------------

let statusEl: HTMLElement;
let undoBtn: HTMLButtonElement;
let pencilBtn: HTMLButtonElement;
let canvas: HTMLCanvasElement;
let numberButtons: HTMLButtonElement[] = [];

function showGame(diff: Difficulty | null, resume: boolean): void {
  app.innerHTML = "";
  const root = el("div", "game");

  // Top bar: Menu | Aids | New
  const topbar = el("div", "topbar");
  const menuBtn = iconButton("menu", "Menu", () => {
    pauseTimer();
    save();
    showMenu();
  });
  const aidsBtn = iconButton("gear", "Aids", showSettings);
  const newBtn = iconButton("refresh", "New game", () => {
    if (!generating) startNewGame(game.difficulty);
  });
  topbar.append(menuBtn, aidsBtn, newBtn);

  statusEl = el("div", "status");

  const boardWrap = el("div", "board-wrap");
  canvas = document.createElement("canvas");
  boardWrap.appendChild(canvas);

  // Number keys 1..9
  const numbers = el("div", "numbers");
  numberButtons = [];
  for (let n = 1; n <= 9; n++) {
    const b = document.createElement("button");
    b.textContent = String(n);
    b.onclick = () => placeNumber(n);
    numberButtons.push(b);
    numbers.appendChild(b);
  }

  // Actions: Undo | Notes | Clear
  const actions = el("div", "actions");
  undoBtn = iconButton("undo", "Undo", () => {
    if (!generating && game.undo()) sound.play(Sfx.ERASE);
  });
  pencilBtn = iconButton("pencil", "Notes", () => {
    if (generating) return;
    game.pencil = !game.pencil;
    refreshPencilStyle();
    save();
  });
  const clearBtn = iconButton("erase", "Clear", () => {
    if (!generating && game.clear()) sound.play(Sfx.ERASE);
  });
  actions.append(undoBtn, pencilBtn, clearBtn);

  root.append(topbar, statusEl, boardWrap, numbers, actions);
  app.appendChild(root);

  board = new BoardView(canvas, game, dark, settings);
  sizeBoard();

  game.onChange = () => {
    board?.draw();
    refreshStatus();
    refreshNumberKeys();
    const nowSolved = game.isSolved();
    if (nowSolved && !solvedState) {
      hapticSuccess();
      sound.play(Sfx.SUCCESS);
    }
    solvedState = nowSolved;
    save();
  };

  refreshPencilStyle();

  const restored = resume && game.restore(localStorage.getItem(KEY_STATE) ?? "");
  if (restored) {
    solvedState = game.isSolved();
    refreshStatus();
    startTimer();
  } else {
    startNewGame(diff ?? savedDifficulty());
  }
}

/**
 * Start a new game. Prefer a pre-generated puzzle from the pool (instant); only
 * if none is warmed yet do we show "Generating…" and wait for the worker.
 */
function startNewGame(diff: Difficulty): void {
  hardResetTimer();
  solvedState = false;
  board?.cancelAnimations();

  const ready = pool.take(diff);
  if (ready) {
    generating = false;
    canvas.classList.remove("hidden");
    game.loadPuzzle(ready); // triggers onChange → refreshStatus + save
    return;
  }

  generating = true;
  canvas.classList.add("hidden");
  statusEl.textContent = "Generating…";
  const token = ++genToken;
  pool.request(diff).then((puzzle) => {
    if (token !== genToken) return; // a newer request superseded this one
    generating = false;
    canvas.classList.remove("hidden");
    game.loadPuzzle(puzzle); // triggers onChange → refreshStatus + save
  });
}

function refreshStatus(): void {
  if (generating) return;
  const level = game.difficulty.charAt(0) + game.difficulty.slice(1).toLowerCase();
  const time = formatTime(currentElapsedMs());
  const prefix = game.isSolved() ? "Solved 🎉   ·   " : "";
  statusEl.textContent = `${prefix}${level}   ·   ${time}   ·   Mistakes: ${game.mistakes}`;
  undoBtn.disabled = !game.canUndo;
}

function refreshPencilStyle(): void {
  pencilBtn.classList.toggle("pencil-on", game.pencil);
}

/** Re-apply aids to the current view after a settings toggle (no-op on the menu). */
function applySettingsLive(): void {
  board?.draw();
  refreshNumberKeys();
}

/**
 * The Aids options overlay — a modal sheet shared by the menu and game screens.
 * Each toggle flips a setting live and persists it; each (i) expands an inline
 * explanation (touch-friendly, unlike a hover tooltip).
 */
function showSettings(): void {
  const overlay = el("div", "overlay");
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove(); // tap the backdrop to dismiss
  };

  const sheet = el("div", "sheet");

  const head = el("div", "sheet-head");
  const h2 = el("h2");
  h2.textContent = "Aids";
  const done = document.createElement("button");
  done.className = "done";
  done.textContent = "Done";
  done.onclick = () => overlay.remove();
  head.append(h2, done);
  sheet.appendChild(head);

  for (const opt of OPTION_INFO) {
    const option = el("div", "option");

    const row = el("div", "option-row");
    const label = el("span", "option-label");
    label.textContent = opt.label;

    const info = document.createElement("button");
    info.className = "info";
    info.textContent = "i";
    info.setAttribute("aria-label", `About: ${opt.label}`);
    info.onclick = () => option.classList.toggle("expanded");

    const sw = document.createElement("label");
    sw.className = "switch";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = settings[opt.key];
    checkbox.onchange = () => {
      settings[opt.key] = checkbox.checked;
      saveSettings(settings);
      applySettingsLive();
    };
    const track = el("span", "track");
    sw.append(checkbox, track);

    row.append(label, info, sw);

    const help = el("p", "option-help");
    help.textContent = opt.help;

    option.append(row, help);
    sheet.appendChild(option);
  }

  overlay.appendChild(sheet);
  app.appendChild(overlay);
}

/** Hide keypad digits that a peer of the selected cell already holds correctly. */
function refreshNumberKeys(): void {
  if (numberButtons.length === 0) return;
  const blocked = settings.candidateNarrowing ? game.unavailableForSelected() : null;
  for (let n = 1; n <= 9; n++) {
    numberButtons[n - 1].classList.toggle("used", blocked ? blocked[n] : false);
  }
}

function placeNumber(n: number): void {
  if (generating) return;
  switch (game.enter(n)) {
    case Move.VALUE: {
      const cell = game.selected;
      const wrong = game.isError(cell);
      if (wrong) {
        hapticError();
        sound.play(Sfx.ERROR);
      } else {
        haptic(true);
        sound.play(Sfx.PLACE);
      }
      startTimer();
      if (!wrong) {
        if (game.isSolved()) {
          pauseTimer();
          board?.playWin();
        } else {
          const completed = game.newlyCompletedCells(cell);
          board?.flashUnits(completed);
          if (completed.length > 0) sound.chime();
        }
      }
      break;
    }
    case Move.NOTE:
      haptic(false);
      sound.play(Sfx.NOTE);
      break;
    case Move.NONE:
      break;
  }
}

// --- Responsive board sizing --------------------------------------------

function sizeBoard(): void {
  if (!board || !canvas) return;
  // Fit the board to the available width, capped so it stays square and leaves
  // room for the keypad on tall screens.
  const wrapWidth = canvas.parentElement!.clientWidth;
  const maxByHeight = window.innerHeight * 0.62;
  const side = Math.floor(Math.min(wrapWidth, maxByHeight, 520));
  board.resize(side);
}

window.addEventListener("resize", sizeBoard);

// --- Lifecycle: pause the clock when the app is backgrounded -------------

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseTimer();
    save();
  } else if (statusEl) {
    startTimer();
  }
});

window.addEventListener("pagehide", () => {
  pauseTimer();
  save();
});

// --- Boot ----------------------------------------------------------------

showMenu();
