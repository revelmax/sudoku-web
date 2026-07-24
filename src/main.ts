import { SudokuGame } from "./game";
import { BoardView } from "./board";
import { Difficulty, DIFFICULTIES, Move } from "./types";
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

/** Create an element with an optional class. */
function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

let board: BoardView | null = null;
let solvedState = false;
let generating = false;

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

  app.appendChild(menu);
}

// --- Game screen ---------------------------------------------------------

let statusEl: HTMLElement;
let undoBtn: HTMLButtonElement;
let pencilBtn: HTMLButtonElement;
let canvas: HTMLCanvasElement;

function showGame(diff: Difficulty | null, resume: boolean): void {
  app.innerHTML = "";
  const root = el("div", "game");

  // Top bar: Menu | New
  const topbar = el("div", "topbar");
  const menuBtn = document.createElement("button");
  menuBtn.textContent = "☰ Menu";
  menuBtn.onclick = () => {
    pauseTimer();
    save();
    showMenu();
  };
  const newBtn = document.createElement("button");
  newBtn.textContent = "New";
  newBtn.onclick = () => {
    if (!generating) startNewGame(game.difficulty);
  };
  topbar.append(menuBtn, newBtn);

  statusEl = el("div", "status");

  const boardWrap = el("div", "board-wrap");
  canvas = document.createElement("canvas");
  boardWrap.appendChild(canvas);

  // Number keys 1..9
  const numbers = el("div", "numbers");
  for (let n = 1; n <= 9; n++) {
    const b = document.createElement("button");
    b.textContent = String(n);
    b.onclick = () => placeNumber(n);
    numbers.appendChild(b);
  }

  // Actions: Undo | Notes | Clear
  const actions = el("div", "actions");
  undoBtn = document.createElement("button");
  undoBtn.textContent = "↶ Undo";
  undoBtn.onclick = () => {
    if (!generating) game.undo();
  };
  pencilBtn = document.createElement("button");
  pencilBtn.textContent = "✏️ Notes";
  pencilBtn.onclick = () => {
    if (generating) return;
    game.pencil = !game.pencil;
    refreshPencilStyle();
    save();
  };
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  clearBtn.onclick = () => {
    if (!generating) game.clear();
  };
  actions.append(undoBtn, pencilBtn, clearBtn);

  root.append(topbar, statusEl, boardWrap, numbers, actions);
  app.appendChild(root);

  board = new BoardView(canvas, game, dark);
  sizeBoard();

  game.onChange = () => {
    board?.draw();
    refreshStatus();
    const nowSolved = game.isSolved();
    if (nowSolved && !solvedState) hapticSuccess();
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
 * Start a new game. Generation can take a second or two for MEDIUM/HARD, so we
 * show "Generating…", yield once to let the browser paint that, then generate.
 */
function startNewGame(diff: Difficulty): void {
  hardResetTimer();
  solvedState = false;
  generating = true;
  canvas.classList.add("hidden");
  statusEl.textContent = "Generating…";

  setTimeout(() => {
    const puzzle = game.generatePuzzle(diff);
    generating = false;
    canvas.classList.remove("hidden");
    game.loadPuzzle(puzzle); // triggers onChange → refreshStatus + save
  }, 16);
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

function placeNumber(n: number): void {
  if (generating) return;
  switch (game.enter(n)) {
    case Move.VALUE: {
      const cell = game.selected;
      const wrong = game.isError(cell);
      if (wrong) hapticError();
      else haptic(true);
      startTimer();
      if (!wrong && game.isSolved()) pauseTimer();
      break;
    }
    case Move.NOTE:
      haptic(false);
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
