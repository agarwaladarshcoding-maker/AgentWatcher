/**
 * The single source of truth for AgentWatch colors (architecture doc §16.2).
 * These JS tokens mirror the CSS custom properties in styles.css so the xterm
 * terminal and the React chrome share one universal palette.
 */
export const COLORS = {
  accent: "#7F77DD",
  surface1: "#FFFFFF",
  surface2: "#F7F7F5",
  border: "#EBEBEA",
  text1: "#191919",
  text2: "#787774",

  terminalBg: "#0F1117",
  command: "#C8C8D0",
  output: "#9FE1CB",
  dim: "#555566",
  warn: "#EF9F27",

  blue: "#378ADD",
  amber: "#EF9F27",
  green: "#1D9E75",
  red: "#E24B4A",
  neutral: "#B9B9B7",
} as const;

/** xterm.js theme derived from the universal palette (terminal is always dark). */
export const XTERM_THEME = {
  background: COLORS.terminalBg,
  foreground: COLORS.command,
  cursor: COLORS.accent,
  cursorAccent: COLORS.terminalBg,
  selectionBackground: "#2A2D3A",
  black: "#0F1117",
  red: COLORS.red,
  green: COLORS.green,
  yellow: COLORS.warn,
  blue: COLORS.blue,
  magenta: COLORS.accent,
  cyan: "#5BD6C0",
  white: COLORS.command,
  brightBlack: COLORS.dim,
  brightWhite: "#FFFFFF",
} as const;
