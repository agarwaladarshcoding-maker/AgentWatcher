import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { XTERM_THEME } from "../theme";

/**
 * Imperative manager for the per-session xterm instances. Lives entirely OUTSIDE
 * React (§18): raw PTY bytes are written straight into a Terminal, and terminal
 * output never enters React state.
 *
 * One Terminal per session is kept alive even when hidden, so switching agents
 * is instant and preserves full scrollback. Hidden terminals still receive their
 * output live; we only fit/size the active one to its container.
 */
interface Entry {
  term: Terminal;
  fit: FitAddon;
  host: HTMLElement;
  inputSub: { dispose: () => void };
}

export class TerminalManager {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly onInput: (id: string, data: string) => void) {}

  /** Ensure a Terminal exists for `id` and is mounted into `host`. */
  attach(id: string, host: HTMLElement): void {
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.host !== host && existing.term.element) {
        host.appendChild(existing.term.element);
        existing.host = host;
      }
      return;
    }

    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10000,
      allowProposedApi: true,
      theme: { ...XTERM_THEME },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    const inputSub = term.onData((data) => this.onInput(id, data));
    this.entries.set(id, { term, fit, host, inputSub });
  }

  /** Write verbatim output to a session's terminal. */
  write(id: string, chunk: string): void {
    this.entries.get(id)?.term.write(chunk);
  }

  /** Apply an authoritative size (from the PTY negotiation) to a terminal. */
  resizeTo(id: string, cols: number, rows: number): void {
    const e = this.entries.get(id);
    if (e && cols > 0 && rows > 0) {
      try {
        e.term.resize(cols, rows);
      } catch {
        /* ignore */
      }
    }
  }

  /** Fit a terminal to its container; returns the resulting cell size. */
  fit(id: string): { cols: number; rows: number } | null {
    const e = this.entries.get(id);
    if (!e) return null;
    try {
      e.fit.fit();
    } catch {
      /* host may be 0-sized briefly */
    }
    return { cols: e.term.cols, rows: e.term.rows };
  }

  focus(id: string): void {
    this.entries.get(id)?.term.focus();
  }

  /** Write a dim notice (e.g. session-ended banner) without affecting the agent. */
  notice(id: string, text: string): void {
    this.entries.get(id)?.term.write(text);
  }

  dispose(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.inputSub.dispose();
    e.term.dispose();
    this.entries.delete(id);
  }

  disposeAll(): void {
    for (const id of [...this.entries.keys()]) this.dispose(id);
  }
}
