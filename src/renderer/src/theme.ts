/**
 * The single source of truth for AgentWatch colors (architecture doc §16.2),
 * tuned to Claude's DARK identity: clay/coral accent on warm near-black
 * surfaces, with the terminal as a seamless hero. These JS tokens mirror the
 * CSS custom properties in styles.css so the xterm terminal and the React
 * chrome share one universal palette.
 */
export const COLORS = {
  accent: "#D97757", // Claude coral (dark)
  surface1: "#262624", // warm near-black panels
  surface2: "#2F2E2C", // headers / inputs / hover
  border: "#393834", // warm hairline
  text1: "#ECEBE3", // warm near-white
  text2: "#9D988D", // warm secondary

  terminalBg: "#1F1E1D", // warm dark hero
  command: "#E6E4D9", // typed / echoed commands
  output: "#A9D9C2", // success / normal output
  dim: "#6B6760", // context / meta
  warn: "#E0913A", // warnings + permission requests

  blue: "#5C9CD6",
  amber: "#E0913A",
  green: "#3FA985",
  red: "#D8615C",
  neutral: "#B8B4AA",
} as const;

/** xterm.js theme derived from the universal palette (terminal is always dark). */
export const XTERM_THEME = {
  background: COLORS.terminalBg,
  foreground: COLORS.command,
  cursor: COLORS.accent,
  cursorAccent: COLORS.terminalBg,
  selectionBackground: "#3A3733",
  black: "#1F1E1D",
  red: COLORS.red,
  green: COLORS.green,
  yellow: COLORS.warn,
  blue: COLORS.blue,
  magenta: COLORS.accent,
  cyan: "#5BC7B5",
  white: COLORS.command,
  brightBlack: COLORS.dim,
  brightRed: "#E8807B",
  brightGreen: "#5CC79F",
  brightYellow: "#EBA855",
  brightBlue: "#76B0E0",
  brightMagenta: "#E0805F",
  brightCyan: "#76D6C6",
  brightWhite: "#FBFAF6",
} as const;
