import { SudokuGame } from "./game";

/**
 * Draws the 9x9 grid onto a <canvas> and handles cell selection by pointer.
 * Hand-ported from the Android app's SudokuView.kt (Canvas drawing → 2D context).
 *
 * Two palettes keep the board legible in light and dark mode.
 */

interface Palette {
  boardFill: string;
  thinLine: string;
  thickLine: string;
  givenText: string;
  userText: string;
  conflictText: string;
  noteText: string;
  selectedFill: string;
  peerFill: string;
  sameFill: string;
}

const LIGHT: Palette = {
  boardFill: "#FFFFFF",
  thinLine: "#B0BEC5",
  thickLine: "#37474F",
  givenText: "#212121",
  userText: "#1565C0",
  conflictText: "#D32F2F",
  noteText: "#AEB4BC",
  selectedFill: "#E3F2FD",
  peerFill: "#F1F8FE",
  sameFill: "#FFF0BF",
};

const DARK: Palette = {
  boardFill: "#1B1B1F",
  thinLine: "#4A4A52",
  thickLine: "#D0D0D8",
  givenText: "#ECECEF",
  userText: "#7EB8FF",
  conflictText: "#FF6E66",
  noteText: "#767E88",
  selectedFill: "#35506B",
  peerFill: "#26333F",
  sameFill: "#4C4A2E",
};

export class BoardView {
  private ctx: CanvasRenderingContext2D;
  private cssSize = 0; // logical (CSS px) side length
  private cell = 0;
  private palette: Palette;

  constructor(
    private canvas: HTMLCanvasElement,
    private game: SudokuGame,
    dark: boolean,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.palette = dark ? DARK : LIGHT;

    canvas.addEventListener("pointerdown", (e) => this.onPointer(e));
    game.onChange = () => this.draw();
  }

  /** Size the canvas to a square of [side] CSS px, accounting for device pixel ratio. */
  resize(side: number): void {
    const dpr = window.devicePixelRatio || 1;
    this.cssSize = side;
    this.cell = side / 9;
    this.canvas.style.width = `${side}px`;
    this.canvas.style.height = `${side}px`;
    this.canvas.width = Math.round(side * dpr);
    this.canvas.height = Math.round(side * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private onPointer(e: PointerEvent): void {
    if (this.cell <= 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const c = clamp(Math.floor((e.clientX - rect.left) / this.cell), 0, 8);
    const r = clamp(Math.floor((e.clientY - rect.top) / this.cell), 0, 8);
    this.game.select(r, c);
  }

  draw(): void {
    const g = this.game;
    const p = this.palette;
    const ctx = this.ctx;
    const cell = this.cell;
    const size = this.cssSize;
    if (cell <= 0) return;

    // Board background.
    ctx.fillStyle = p.boardFill;
    ctx.fillRect(0, 0, size, size);

    // Highlights, low-to-high: peers, then same-number cells, then selection.
    const sel = g.selected;
    const activeNumber = sel >= 0 ? g.board[sel] : 0;

    if (sel >= 0) {
      const sr = Math.floor(sel / 9);
      const sc = sel % 9;
      ctx.fillStyle = p.peerFill;
      for (let i = 0; i < 81; i++) {
        if (i === sel) continue;
        const r = Math.floor(i / 9);
        const c = i % 9;
        if (
          r === sr ||
          c === sc ||
          (Math.floor(r / 3) === Math.floor(sr / 3) && Math.floor(c / 3) === Math.floor(sc / 3))
        ) {
          this.fillCell(r, c);
        }
      }
    }

    if (activeNumber !== 0) {
      ctx.fillStyle = p.sameFill;
      for (let i = 0; i < 81; i++) {
        if (i !== sel && g.board[i] === activeNumber) this.fillCell(Math.floor(i / 9), i % 9);
      }
    }

    if (sel >= 0) {
      ctx.fillStyle = p.selectedFill;
      this.fillCell(Math.floor(sel / 9), sel % 9);
    }

    // Grid lines (every third is thick, marking the 3x3 boxes).
    for (let i = 0; i <= 9; i++) {
      ctx.strokeStyle = i % 3 === 0 ? p.thickLine : p.thinLine;
      ctx.lineWidth = i % 3 === 0 ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, size);
      ctx.moveTo(0, i * cell);
      ctx.lineTo(size, i * cell);
      ctx.stroke();
    }

    // Numbers.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = cell * 0.6;
    ctx.font = `${fontSize}px system-ui, sans-serif`;
    for (let i = 0; i < 81; i++) {
      const v = g.board[i];
      if (v === 0) continue;
      const r = Math.floor(i / 9);
      const c = i % 9;
      ctx.fillStyle = g.given[i] ? p.givenText : g.isError(i) ? p.conflictText : p.userText;
      ctx.fillText(String(v), c * cell + cell / 2, r * cell + cell / 2);
    }

    // Pencil marks — small draft digits in a 3x3 sub-grid, only in empty cells.
    const third = cell / 3;
    ctx.font = `${cell * 0.26}px system-ui, sans-serif`;
    ctx.fillStyle = p.noteText;
    for (let i = 0; i < 81; i++) {
      if (g.board[i] !== 0) continue;
      const r = Math.floor(i / 9);
      const c = i % 9;
      for (let n = 1; n <= 9; n++) {
        if (!g.notes[i][n]) continue;
        const sr = Math.floor((n - 1) / 3);
        const sc = (n - 1) % 3;
        const x = c * cell + (sc + 0.5) * third;
        const y = r * cell + (sr + 0.5) * third;
        ctx.fillText(String(n), x, y);
      }
    }
  }

  private fillCell(r: number, c: number): void {
    this.ctx.fillRect(c * this.cell, r * this.cell, this.cell, this.cell);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
