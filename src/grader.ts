import { Difficulty } from "./types";

/**
 * Rates a puzzle by the hardest *human* technique needed to solve it, using a
 * logical solver that never guesses. Tiers, simplest first:
 *   1 naked single, 2 hidden single, 3 locked candidates,
 *   4 naked/hidden pairs & triples.
 * The grade is the highest tier the solver was forced to use:
 *   only singles (<=2)  -> EASY
 *   needed tier 3 or 4  -> MEDIUM
 *   couldn't finish     -> HARD (requires guessing / techniques beyond these)
 *
 * Candidates are kept as a bitmask per cell (bit v set = value v is possible).
 *
 * Hand-ported from the Android app's SudokuGrader.kt.
 */

// 27 units: rows (0..8), columns (9..17), boxes (18..26).
const units: number[][] = buildUnits();

export function grade(puzzle: string): Difficulty {
  const grid = new Int32Array(81);
  for (let i = 0; i < 81; i++) grid[i] = puzzle.charCodeAt(i) - 48;
  const cand = new Int32Array(81);
  computeCandidates(grid, cand);

  let maxTier = 0;
  while (anyEmpty(grid)) {
    const tier = step(grid, cand);
    if (tier === 0) break; // stuck — no technique in our set applies
    if (tier > maxTier) maxTier = tier;
  }

  if (anyEmpty(grid)) return Difficulty.HARD;
  return maxTier <= 2 ? Difficulty.EASY : Difficulty.MEDIUM;
}

function anyEmpty(grid: Int32Array): boolean {
  for (let i = 0; i < 81; i++) if (grid[i] === 0) return true;
  return false;
}

/** Apply the simplest technique that makes progress; return its tier, or 0 if none. */
function step(grid: Int32Array, cand: Int32Array): number {
  if (nakedSingle(grid, cand)) return 1;
  if (hiddenSingle(grid, cand)) return 2;
  if (lockedCandidates(cand)) return 3;
  if (subsets(cand)) return 4;
  return 0;
}

// --- candidate bookkeeping ----------------------------------------------

function computeCandidates(grid: Int32Array, cand: Int32Array): void {
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) {
      cand[i] = 0;
      continue;
    }
    let m = 0;
    for (let v = 1; v <= 9; v++) if (canPlace(grid, i, v)) m |= 1 << v;
    cand[i] = m;
  }
}

function canPlace(grid: Int32Array, i: number, v: number): boolean {
  const r = Math.floor(i / 9);
  const c = i % 9;
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

/** Place v at cell i and strip it from every peer's candidates. */
function place(grid: Int32Array, cand: Int32Array, i: number, v: number): void {
  grid[i] = v;
  cand[i] = 0;
  const clear = ~(1 << v);
  const r = Math.floor(i / 9);
  const c = i % 9;
  for (let k = 0; k < 9; k++) {
    cand[r * 9 + k] &= clear;
    cand[k * 9 + c] &= clear;
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++)
    for (let dc = 0; dc < 3; dc++) {
      cand[(br + dr) * 9 + (bc + dc)] &= clear;
    }
}

// --- techniques ---------------------------------------------------------

function bitCount(n: number): number {
  let count = 0;
  while (n) {
    n &= n - 1;
    count++;
  }
  return count;
}

function trailingZeros(n: number): number {
  if (n === 0) return 32;
  let count = 0;
  while ((n & 1) === 0) {
    n >>= 1;
    count++;
  }
  return count;
}

function nakedSingle(grid: Int32Array, cand: Int32Array): boolean {
  for (let i = 0; i < 81; i++) {
    if (grid[i] === 0 && bitCount(cand[i]) === 1) {
      place(grid, cand, i, trailingZeros(cand[i]));
      return true;
    }
  }
  return false;
}

function hiddenSingle(grid: Int32Array, cand: Int32Array): boolean {
  for (const unit of units) {
    for (let v = 1; v <= 9; v++) {
      const bit = 1 << v;
      let count = 0;
      let pos = -1;
      for (const cell of unit)
        if ((cand[cell] & bit) !== 0) {
          count++;
          pos = cell;
        }
      if (count === 1) {
        place(grid, cand, pos, v);
        return true;
      }
    }
  }
  return false;
}

function lockedCandidates(cand: Int32Array): boolean {
  // Pointing: in a box, a digit confined to one row/col is cleared from the rest of that line.
  for (let bi = 0; bi < 9; bi++) {
    const box = units[18 + bi];
    for (let v = 1; v <= 9; v++) {
      const bit = 1 << v;
      const cells = box.filter((c) => (cand[c] & bit) !== 0);
      if (cells.length < 2) continue;
      if (cells.every((c) => Math.floor(c / 9) === Math.floor(cells[0] / 9))) {
        const r = Math.floor(cells[0] / 9);
        const line: number[] = [];
        for (let k = 0; k < 9; k++) line.push(r * 9 + k);
        if (clearBitFromLine(cand, bit, line, cells)) return true;
      } else if (cells.every((c) => c % 9 === cells[0] % 9)) {
        const c0 = cells[0] % 9;
        const line: number[] = [];
        for (let k = 0; k < 9; k++) line.push(k * 9 + c0);
        if (clearBitFromLine(cand, bit, line, cells)) return true;
      }
    }
  }
  // Claiming: in a row/col, a digit confined to one box is cleared from the rest of that box.
  for (let li = 0; li < 18; li++) {
    const lineUnit = units[li];
    for (let v = 1; v <= 9; v++) {
      const bit = 1 << v;
      const cells = lineUnit.filter((c) => (cand[c] & bit) !== 0);
      if (cells.length < 2) continue;
      if (cells.every((c) => boxOf(c) === boxOf(cells[0]))) {
        const box = units[18 + boxOf(cells[0])];
        if (clearBitFromLine(cand, bit, box, cells)) return true;
      }
    }
  }
  return false;
}

function clearBitFromLine(
  cand: Int32Array,
  bit: number,
  cells: number[],
  keep: number[],
): boolean {
  let changed = false;
  for (const j of cells) {
    if (!keep.includes(j) && (cand[j] & bit) !== 0) {
      cand[j] &= ~bit;
      changed = true;
    }
  }
  return changed;
}

function boxOf(i: number): number {
  return Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);
}

/** Naked and hidden pairs/triples across every unit. */
function subsets(cand: Int32Array): boolean {
  for (const unit of units) {
    const empties = unit.filter((c) => cand[c] !== 0);
    if (empties.length < 3) continue;
    for (let size = 2; size <= 3; size++) {
      if (nakedSubset(cand, empties, size)) return true;
      if (hiddenSubset(cand, empties, size)) return true;
    }
  }
  return false;
}

function nakedSubset(cand: Int32Array, empties: number[], size: number): boolean {
  for (const combo of combinations(empties.length, size)) {
    let union = 0;
    for (const idx of combo) union |= cand[empties[idx]];
    if (bitCount(union) !== size) continue;
    const chosen = combo.map((i) => empties[i]);
    let changed = false;
    for (const cell of empties) {
      if (chosen.includes(cell)) continue;
      if ((cand[cell] & union) !== 0) {
        cand[cell] &= ~union;
        changed = true;
      }
    }
    if (changed) return true;
  }
  return false;
}

function hiddenSubset(cand: Int32Array, empties: number[], size: number): boolean {
  const present: number[] = [];
  for (let v = 1; v <= 9; v++)
    if (empties.some((c) => (cand[c] & (1 << v)) !== 0)) present.push(v);
  if (present.length < size) return false;
  for (const combo of combinations(present.length, size)) {
    let mask = 0;
    for (const idx of combo) mask |= 1 << present[idx];
    const cells = empties.filter((c) => (cand[c] & mask) !== 0);
    if (cells.length !== size) continue;
    let changed = false;
    for (const cell of cells) {
      const keep = cand[cell] & mask;
      if (cand[cell] !== keep) {
        cand[cell] = keep;
        changed = true;
      }
    }
    if (changed) return true;
  }
  return false;
}

// --- helpers ------------------------------------------------------------

/** All index-combinations of `n` choose `k`. */
function combinations(n: number, k: number): number[][] {
  const result: number[][] = [];
  const combo = new Array<number>(k);
  function rec(start: number, depth: number): void {
    if (depth === k) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      combo[depth] = i;
      rec(i + 1, depth + 1);
    }
  }
  rec(0, 0);
  return result;
}

function buildUnits(): number[][] {
  const list: number[][] = [];
  for (let r = 0; r < 9; r++) {
    const cells: number[] = [];
    for (let k = 0; k < 9; k++) cells.push(r * 9 + k);
    list.push(cells);
  }
  for (let c = 0; c < 9; c++) {
    const cells: number[] = [];
    for (let k = 0; k < 9; k++) cells.push(k * 9 + c);
    list.push(cells);
  }
  for (let br = 0; br < 3; br++)
    for (let bc = 0; bc < 3; bc++) {
      const cells: number[] = [];
      for (let dr = 0; dr < 3; dr++)
        for (let dc = 0; dc < 3; dc++) cells.push((br * 3 + dr) * 9 + (bc * 3 + dc));
      list.push(cells);
    }
  return list;
}
