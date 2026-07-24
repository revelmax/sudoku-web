/**
 * Player-facing "aids" — optional assists that make the game more forgiving.
 * Persisted to localStorage; all default on, matching the app's baseline feel.
 */
export interface Settings {
  highlightSameNumbers: boolean;
  highlightConflicts: boolean;
  highlightPeers: boolean;
  candidateNarrowing: boolean;
}

const KEY = "sudoku.settings";

const DEFAULTS: Settings = {
  highlightSameNumbers: true,
  highlightConflicts: true,
  highlightPeers: true,
  candidateNarrowing: false,
};

/** Load settings, filling any missing keys from defaults (forward-compatible). */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

/** Definitions for the options UI: order, labels, and plain-language help. */
export const OPTION_INFO: {
  key: keyof Settings;
  label: string;
  help: string;
}[] = [
  {
    key: "highlightSameNumbers",
    label: "Highlight same numbers",
    help: "Shades every cell that already holds the same number as the one you've selected, so you can see where that digit appears.",
  },
  {
    key: "highlightConflicts",
    label: "Highlight mistakes",
    help: "Colors a number red when it doesn't match the puzzle's solution, flagging wrong entries as you make them.",
  },
  {
    key: "highlightPeers",
    label: "Highlight row, column & box",
    help: "Lightly shades the row, column, and 3×3 box of the selected cell — the units its value must be unique within.",
  },
  {
    key: "candidateNarrowing",
    label: "Candidate narrowing",
    help: "Hides number-pad digits that can't legally go in the selected cell because its row, column, or box already contains them.",
  },
];
