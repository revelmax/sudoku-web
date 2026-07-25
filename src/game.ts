import { CLUES, Difficulty, Move, Puzzle } from "./types";
import { grade } from "./grader";

/**
 * Holds the state of a single Sudoku puzzle: the current board, which cells are
 * fixed clues, the solution (computed by the built-in solver), the pencil marks,
 * the mistake count, and an undo history. Cells are indexed 0..80 (row * 9 + col).
 *
 * Hand-ported from the Android app's SudokuGame.kt.
 */

const VERSION = "1";
const MAX_HISTORY = 200;
const GEN_ATTEMPTS = 40;
const MEDIUM_BASE_ATTEMPTS = 6;

interface Snapshot {
  board: number[];
  notes: boolean[][];
  mistakes: number;
  selected: number;
}

function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class SudokuGame {
  board: number[] = new Array(81).fill(0);
  given: boolean[] = new Array(81).fill(false);
  private solution: number[] = new Array(81).fill(0);

  /** notes[cell][n] is true when candidate n (1..9) is drafted. */
  notes: boolean[][] = Array.from({ length: 81 }, () => new Array(10).fill(false));

  selected = -1;

  /** When true, entering a number toggles a pencil mark instead of setting the value. */
  pencil = false;

  mistakes = 0;
  difficulty: Difficulty = Difficulty.MEDIUM;

  /** Accumulated solve time. The UI owns the ticking clock and syncs this. */
  elapsedMs = 0;

  /** Becomes true on the first value placed — the signal for the timer to start. */
  started = false;

  private puzzleStr = "";
  private history: Snapshot[] = [];

  /** Called whenever the board or selection changes, so the UI can redraw. */
  onChange: (() => void) | null = null;

  constructor() {
    this.newGame(Difficulty.EASY);
  }

  // --- Loading -------------------------------------------------------------

  private loadWithSolution(puzzle: string, sol: number[]): void {
    this.puzzleStr = puzzle;
    for (let i = 0; i < 81; i++) {
      this.board[i] = puzzle.charCodeAt(i) - 48;
      this.given[i] = this.board[i] !== 0;
      this.solution[i] = sol[i];
      this.clearNotes(i);
    }
    this.mistakes = 0;
    this.selected = -1;
    this.elapsedMs = 0;
    this.started = false;
    this.history = [];
  }

  /** Generate a fresh puzzle at [diff] and reset progress (synchronous). */
  newGame(diff: Difficulty = this.difficulty): void {
    this.difficulty = diff;
    const [puzzle, sol] = this.generate(diff);
    this.loadWithSolution(puzzle, sol);
    this.onChange?.();
  }

  /**
   * Generate a puzzle WITHOUT touching this game's state. Apply the result with
   * [loadPuzzle].
   */
  generatePuzzle(diff: Difficulty): Puzzle {
    const [puzzle, sol] = this.generate(diff);
    return { puzzle, solution: sol, difficulty: diff };
  }

  /** Apply a pre-generated puzzle and reset progress. */
  loadPuzzle(p: Puzzle): void {
    this.difficulty = p.difficulty;
    this.loadWithSolution(p.puzzle, p.solution);
    this.onChange?.();
  }

  // --- Interaction ---------------------------------------------------------

  select(row: number, col: number): void {
    this.selected = row * 9 + col;
    this.onChange?.();
  }

  /**
   * Enter a number (1..9) into the selected cell. In pencil mode this toggles a
   * draft mark (only on an empty cell); otherwise it sets the cell's value,
   * clears its own drafts, removes that candidate from its peers' drafts, and
   * counts a mistake if the value is wrong.
   */
  enter(n: number): Move {
    const i = this.selected;
    if (i < 0 || this.given[i] || n < 1 || n > 9) return Move.NONE;
    if (this.pencil && this.board[i] !== 0) return Move.NONE;

    let move: Move;
    if (this.pencil) {
      this.pushHistory();
      this.notes[i][n] = !this.notes[i][n];
      move = Move.NOTE;
    } else {
      const prev = this.board[i];
      // Re-entering the value that is already there changes nothing, so don't
      // record it: otherwise tapping "5" five times would take five undos.
      if (prev === n && this.notesEmpty(i) && !this.peerHasNote(i, n)) return Move.VALUE;
      this.pushHistory();
      this.board[i] = n;
      this.clearNotes(i);
      this.clearPeerNotes(i, n);
      // Count a mistake only when the value actually changes to a wrong one, so
      // re-entering the same wrong number doesn't keep inflating the counter.
      if (n !== this.solution[i] && n !== prev) this.mistakes++;
      if (!this.started) this.started = true;
      move = Move.VALUE;
    }
    this.onChange?.();
    return move;
  }

  private isCellCorrect(i: number): boolean {
    return this.board[i] !== 0 && this.board[i] === this.solution[i];
  }

  /**
   * If placing at [i] just completed its row, column, and/or 3x3 box correctly,
   * return the union of those cells (for a completion animation); else empty.
   */
  newlyCompletedCells(i: number): number[] {
    if (!this.isCellCorrect(i)) return [];
    const r = Math.floor(i / 9);
    const c = i % 9;
    const cells = new Set<number>();
    let rowDone = true;
    for (let k = 0; k < 9; k++) if (!this.isCellCorrect(r * 9 + k)) rowDone = false;
    if (rowDone) for (let k = 0; k < 9; k++) cells.add(r * 9 + k);
    let colDone = true;
    for (let k = 0; k < 9; k++) if (!this.isCellCorrect(k * 9 + c)) colDone = false;
    if (colDone) for (let k = 0; k < 9; k++) cells.add(k * 9 + c);
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    let boxDone = true;
    for (let k = 0; k < 9; k++)
      if (!this.isCellCorrect((br + Math.floor(k / 3)) * 9 + (bc + (k % 3)))) boxDone = false;
    if (boxDone)
      for (let dr = 0; dr < 3; dr++)
        for (let dc = 0; dc < 3; dc++) cells.add((br + dr) * 9 + (bc + dc));
    return Array.from(cells);
  }

  /** Clear the selected cell's value and any drafts. Returns true if anything changed. */
  clear(): boolean {
    const i = this.selected;
    if (i < 0 || this.given[i]) return false;
    if (this.board[i] === 0 && this.notesEmpty(i)) return false;
    this.pushHistory();
    this.board[i] = 0;
    this.clearNotes(i);
    this.onChange?.();
    return true;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  /** Revert the last move. Returns true if there was something to undo. */
  undo(): boolean {
    const s = this.history.pop();
    if (!s) return false;
    for (let i = 0; i < 81; i++) this.board[i] = s.board[i];
    for (let i = 0; i < 81; i++) this.notes[i] = s.notes[i].slice();
    this.mistakes = s.mistakes;
    this.selected = s.selected;
    this.onChange?.();
    return true;
  }

  private pushHistory(): void {
    this.history.push({
      board: this.board.slice(),
      notes: this.notes.map((n) => n.slice()),
      mistakes: this.mistakes,
      selected: this.selected,
    });
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  private clearNotes(i: number): void {
    for (let k = 1; k <= 9; k++) this.notes[i][k] = false;
  }

  private notesEmpty(i: number): boolean {
    for (let k = 1; k <= 9; k++) if (this.notes[i][k]) return false;
    return true;
  }

  /** True if any peer of cell [i] still carries [n] as a pencil mark. */
  private peerHasNote(i: number, n: number): boolean {
    const r = Math.floor(i / 9);
    const c = i % 9;
    for (let k = 0; k < 9; k++) {
      if (this.notes[r * 9 + k][n] || this.notes[k * 9 + c][n]) return true;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++) {
        if (this.notes[(br + dr) * 9 + (bc + dc)][n]) return true;
      }
    return false;
  }

  /** Remove candidate [n] from the pencil marks of every peer of cell [i]. */
  private clearPeerNotes(i: number, n: number): void {
    const r = Math.floor(i / 9);
    const c = i % 9;
    for (let k = 0; k < 9; k++) {
      this.notes[r * 9 + k][n] = false;
      this.notes[k * 9 + c][n] = false;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++) {
        this.notes[(br + dr) * 9 + (bc + dc)][n] = false;
      }
  }

  // --- Checks --------------------------------------------------------------

  /** True if the user filled this cell with a value that doesn't match the solution. */
  isError(i: number): boolean {
    return !this.given[i] && this.board[i] !== 0 && this.board[i] !== this.solution[i];
  }

  /** True if this filled-in cell duplicates a value in its row, column, or 3x3 box. */
  isConflict(i: number): boolean {
    const v = this.board[i];
    if (v === 0) return false;
    const r = Math.floor(i / 9);
    const c = i % 9;
    for (let k = 0; k < 9; k++) {
      if (k !== c && this.board[r * 9 + k] === v) return true;
      if (k !== r && this.board[k * 9 + c] === v) return true;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++) {
        const j = (br + dr) * 9 + (bc + dc);
        if (j !== i && this.board[j] === v) return true;
      }
    return false;
  }

  isSolved(): boolean {
    for (let i = 0; i < 81; i++) if (this.board[i] !== this.solution[i]) return false;
    return true;
  }

  /**
   * Digits (1..9) that can no longer legally go in the selected cell because a
   * peer in its row, column, or box already holds them — counting only clues and
   * *correct* user entries, so a wrong placement never hides a still-usable digit.
   * Returns a length-10 array indexed by digit (index 0 unused); all false when
   * nothing is selected. Powers the keypad's "hide used numbers" aid.
   */
  unavailableForSelected(): boolean[] {
    const blocked = new Array(10).fill(false);
    const i = this.selected;
    if (i < 0) return blocked;
    const consider = (j: number) => {
      const v = this.board[j];
      if (v !== 0 && (this.given[j] || v === this.solution[j])) blocked[v] = true;
    };
    const r = Math.floor(i / 9);
    const c = i % 9;
    for (let k = 0; k < 9; k++) {
      consider(r * 9 + k);
      consider(k * 9 + c);
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++) consider((br + dr) * 9 + (bc + dc));
    return blocked;
  }

  // --- Persistence ---------------------------------------------------------

  /** Serialize the full state to a single string. */
  serialize(): string {
    const notesMask = Array.from({ length: 81 }, (_, i) => {
      let m = 0;
      for (let n = 1; n <= 9; n++) if (this.notes[i][n]) m |= 1 << n;
      return m.toString();
    }).join(",");
    const boardStr = this.board.join("");
    const solStr = this.solution.join("");
    return [
      VERSION,
      this.puzzleStr,
      solStr,
      boardStr,
      this.mistakes.toString(),
      this.pencil ? "1" : "0",
      this.selected.toString(),
      notesMask,
      this.difficulty,
      this.elapsedMs.toString(),
      this.started ? "1" : "0",
    ].join("\n");
  }

  /** Restore state produced by [serialize]. Returns false if invalid. */
  restore(data: string): boolean {
    const p = data.split("\n");
    if (p.length < 8 || p[0] !== VERSION) return false;
    try {
      const sol = new Array(81);
      for (let i = 0; i < 81; i++) sol[i] = p[2].charCodeAt(i) - 48;
      this.loadWithSolution(p[1], sol);
      for (let i = 0; i < 81; i++) this.board[i] = p[3].charCodeAt(i) - 48;
      this.mistakes = parseInt(p[4], 10);
      this.pencil = p[5] === "1";
      this.selected = parseInt(p[6], 10);
      const masks = p[7].split(",");
      for (let i = 0; i < 81; i++) {
        const m = parseInt(masks[i], 10);
        for (let n = 1; n <= 9; n++) this.notes[i][n] = (m & (1 << n)) !== 0;
      }
      if (p.length >= 9 && (p[8] as Difficulty) in CLUES) {
        this.difficulty = p[8] as Difficulty;
      }
      if (p.length >= 10) this.elapsedMs = parseInt(p[9], 10) || 0;
      if (p.length >= 11) this.started = p[10] === "1";
      this.history = [];
      this.onChange?.();
      return true;
    } catch {
      return false;
    }
  }

  // --- Generation & solving (backtracking) --------------------------------

  private generate(diff: Difficulty): [string, number[]] {
    // MEDIUM is built by construction (reliable); EASY/HARD by generate-and-test.
    return diff === Difficulty.MEDIUM ? this.buildMedium() : this.buildTargeting(diff);
  }

  private buildTargeting(diff: Difficulty): [string, number[]] {
    let last = this.buildUnique(diff);
    for (let attempt = 0; attempt < GEN_ATTEMPTS; attempt++) {
      if (grade(last[0]) === diff) return last;
      last = this.buildUnique(diff);
    }
    return last;
  }

  private buildMedium(): [string, number[]] {
    let fallback: [string, number[]] | null = null;
    for (let a = 0; a < MEDIUM_BASE_ATTEMPTS; a++) {
      const [str, solution] = this.buildTargeting(Difficulty.HARD);
      const puzzle = new Array(81);
      for (let i = 0; i < 81; i++) puzzle[i] = str.charCodeAt(i) - 48;
      const emptyPositions = shuffled(
        Array.from({ length: 81 }, (_, i) => i).filter((i) => puzzle[i] === 0),
      );
      for (const pos of emptyPositions) {
        puzzle[pos] = solution[pos];
        const g = grade(this.gridToStr(puzzle));
        if (g === Difficulty.MEDIUM) return [this.gridToStr(puzzle), solution];
        if (g === Difficulty.EASY) puzzle[pos] = 0; // over-eases; undo, try another
        // HARD: still hard, keep the clue and continue
      }
      fallback = [this.gridToStr(puzzle), solution];
    }
    return fallback ?? this.buildTargeting(Difficulty.HARD);
  }

  private gridToStr(grid: number[]): string {
    let s = "";
    for (let i = 0; i < 81; i++) s += String.fromCharCode(48 + grid[i]);
    return s;
  }

  /**
   * Make a random full solution, then remove clues one at a time, keeping a
   * removal only while the puzzle still has exactly one solution.
   */
  private buildUnique(diff: Difficulty): [string, number[]] {
    const solution = new Array(81).fill(0);
    this.fillGrid(solution);

    const puzzle = solution.slice();
    let clues = 81;
    for (const pos of shuffled(Array.from({ length: 81 }, (_, i) => i))) {
      if (clues <= CLUES[diff]) break;
      const backup = puzzle[pos];
      puzzle[pos] = 0;
      if (this.countSolutions(puzzle.slice(), 2) === 1) {
        clues--;
      } else {
        puzzle[pos] = backup; // removal made it ambiguous — keep the clue
      }
    }
    return [this.gridToStr(puzzle), solution];
  }

  /** Fill an empty grid with a random valid complete solution. */
  private fillGrid(grid: number[]): boolean {
    let idx = -1;
    for (let k = 0; k < 81; k++)
      if (grid[k] === 0) {
        idx = k;
        break;
      }
    if (idx === -1) return true;
    const r = Math.floor(idx / 9);
    const c = idx % 9;
    for (const v of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      if (this.canPlace(grid, r, c, v)) {
        grid[idx] = v;
        if (this.fillGrid(grid)) return true;
        grid[idx] = 0;
      }
    }
    return false;
  }

  /**
   * Count solutions, short-circuiting once [limit] are found. Uses the MRV
   * heuristic — branch on the empty cell with the fewest candidates.
   */
  private countSolutions(grid: number[], limit: number): number {
    let bestIdx = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let k = 0; k < 81; k++) {
      if (grid[k] !== 0) continue;
      const r = Math.floor(k / 9);
      const c = k % 9;
      let mask = 0;
      let cnt = 0;
      for (let v = 1; v <= 9; v++)
        if (this.canPlace(grid, r, c, v)) {
          mask |= 1 << v;
          cnt++;
        }
      if (cnt < bestCount) {
        bestCount = cnt;
        bestIdx = k;
        bestMask = mask;
        if (cnt <= 1) break; // 0 = dead end, 1 = forced; can't do better
      }
    }
    if (bestIdx === -1) return 1; // no empty cells: a complete solution
    if (bestCount === 0) return 0; // a cell with no candidates: dead end

    let count = 0;
    for (let v = 1; v <= 9; v++) {
      if ((bestMask & (1 << v)) !== 0) {
        grid[bestIdx] = v;
        count += this.countSolutions(grid, limit);
        grid[bestIdx] = 0;
        if (count >= limit) return count;
      }
    }
    return count;
  }

  private canPlace(grid: number[], r: number, c: number, v: number): boolean {
    for (let k = 0; k < 9; k++) {
      if (grid[r * 9 + k] === v) return false;
      if (grid[k * 9 + c] === v) return false;
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++) {
        if (grid[(br + dr) * 9 + (bc + dc)] === v) return false;
      }
    return true;
  }
}
