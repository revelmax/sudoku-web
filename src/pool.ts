import { SudokuGame } from "./game";
import { Difficulty, DIFFICULTIES, Puzzle } from "./types";

/**
 * Keeps a few pre-generated puzzles of each difficulty ready so starting a new
 * game is instant instead of hitching on generation. The web counterpart of the
 * Android app's PuzzlePool.
 *
 * A single Web Worker does the generating; the ready pool is also persisted to
 * localStorage and reloaded at startup, so even a cold launch serves puzzles
 * immediately — generation only ever happens in the background to refill.
 *
 * Falls back to synchronous main-thread generation if Workers are unavailable.
 */

const TARGET_PER_DIFFICULTY = 2;
const STORAGE_KEY = "sudoku.pool";

interface WorkerPuzzleMsg {
  type: "puzzle";
  diff: Difficulty;
  puzzle: Puzzle;
}

export class PuzzlePool {
  private cache: Record<Difficulty, Puzzle[]>;
  private inFlight: Record<Difficulty, number>;
  private pending: Record<Difficulty, ((p: Puzzle) => void)[]>;
  private worker: Worker | null = null;
  private fallback: SudokuGame | null = null;

  constructor() {
    this.cache = emptyRecord(() => [] as Puzzle[]);
    this.inFlight = emptyRecord(() => 0);
    this.pending = emptyRecord(() => [] as ((p: Puzzle) => void)[]);

    this.loadFromDisk();

    try {
      this.worker = new Worker(new URL("./pool-worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (e: MessageEvent<WorkerPuzzleMsg>) => {
        if (e.data?.type === "puzzle") this.onPuzzle(e.data.diff, e.data.puzzle);
      };
    } catch {
      this.worker = null; // no Worker support — synchronous fallback in request()
    }

    this.warm();
  }

  /** A ready puzzle for [diff], or null if none is warmed yet. Triggers a refill. */
  take(diff: Difficulty): Puzzle | null {
    const puzzle = this.cache[diff].shift() ?? null;
    if (puzzle) this.persist();
    this.warm();
    return puzzle;
  }

  /**
   * Resolve with a puzzle for [diff]: instantly if one is cached, otherwise as
   * soon as the worker produces one (fallback generates synchronously).
   */
  request(diff: Difficulty): Promise<Puzzle> {
    const ready = this.take(diff);
    if (ready) return Promise.resolve(ready);

    if (!this.worker) {
      // No worker — generate on the main thread (blocks briefly).
      const gen = (this.fallback ??= new SudokuGame());
      return Promise.resolve(gen.generatePuzzle(diff));
    }

    return new Promise<Puzzle>((resolve) => {
      this.pending[diff].push(resolve);
      this.warm();
    });
  }

  /** Top every difficulty up to its target (plus anyone waiting). Idempotent. */
  warm(): void {
    if (!this.worker) return;
    for (const diff of DIFFICULTIES) {
      const desired = TARGET_PER_DIFFICULTY + this.pending[diff].length;
      let have = this.cache[diff].length + this.inFlight[diff];
      while (have < desired) {
        this.worker.postMessage({ type: "generate", diff });
        this.inFlight[diff]++;
        have++;
      }
    }
  }

  private onPuzzle(diff: Difficulty, puzzle: Puzzle): void {
    this.inFlight[diff]--;
    const resolver = this.pending[diff].shift();
    if (resolver) {
      resolver(puzzle); // hand straight to a waiting caller
    } else {
      this.cache[diff].push(puzzle);
      this.persist();
    }
    this.warm();
  }

  // --- Persistence ---------------------------------------------------------

  private persist(): void {
    try {
      const data: Record<string, [string, number[]][]> = {};
      for (const diff of DIFFICULTIES) {
        data[diff] = this.cache[diff].map((p) => [p.puzzle, p.solution]);
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* storage full/unavailable — the pool just won't survive a reload */
    }
  }

  private loadFromDisk(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, [string, number[]][]>;
      for (const diff of DIFFICULTIES) {
        for (const [puzzle, solution] of data[diff] ?? []) {
          if (puzzle?.length === 81 && solution?.length === 81) {
            this.cache[diff].push({ puzzle, solution, difficulty: diff });
          }
        }
      }
    } catch {
      /* corrupt/missing — start with an empty pool */
    }
  }
}

function emptyRecord<T>(make: () => T): Record<Difficulty, T> {
  const r = {} as Record<Difficulty, T>;
  for (const diff of DIFFICULTIES) r[diff] = make();
  return r;
}
