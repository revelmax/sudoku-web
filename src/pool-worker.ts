import { SudokuGame } from "./game";
import { Difficulty, Puzzle } from "./types";

/**
 * Runs on a Web Worker thread. Generates one puzzle per "generate" message and
 * posts it back, so puzzle generation (which can block ~0.3s for MEDIUM) never
 * stalls the UI thread. The main-thread PuzzlePool decides how many to keep warm.
 */

// Reused across generations; only ever touched on this worker thread.
const generator = new SudokuGame();

interface GenerateMsg {
  type: "generate";
  diff: Difficulty;
}

self.onmessage = (e: MessageEvent<GenerateMsg>) => {
  const { diff } = e.data;
  const puzzle: Puzzle = generator.generatePuzzle(diff);
  (self as unknown as Worker).postMessage({ type: "puzzle", diff, puzzle });
};
