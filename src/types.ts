/** Difficulty of a puzzle. `clues` is the generator's removal bias, not the grade. */
export enum Difficulty {
  EASY = "EASY",
  MEDIUM = "MEDIUM",
  HARD = "HARD",
}

/** Stop removing clues near this many (fewer clues tends toward harder puzzles). */
export const CLUES: Record<Difficulty, number> = {
  [Difficulty.EASY]: 46,
  [Difficulty.MEDIUM]: 32,
  [Difficulty.HARD]: 25,
};

export const DIFFICULTIES: Difficulty[] = [
  Difficulty.EASY,
  Difficulty.MEDIUM,
  Difficulty.HARD,
];

/** What an `enter` call actually did — used by the UI to choose feedback strength. */
export enum Move {
  NONE = "NONE",
  VALUE = "VALUE",
  NOTE = "NOTE",
}

/** A generated puzzle, ready to be applied to a game. */
export interface Puzzle {
  puzzle: string; // 81 chars, '0' = empty
  solution: number[]; // length 81
  difficulty: Difficulty;
}
