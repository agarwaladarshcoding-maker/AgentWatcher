import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { PtyExitInfo, PtyStartResult } from "../../../shared/ipc";

interface TerminalMirrorProps {
  /** Called with the pid once the PTY has spawned. */
  onStarted?: (result: PtyStartResult) => void;
  /** Called once when the wrapped process exits. */
  onExit?: (info: PtyExitInfo) => void;
}

/**
 * The sacred mirror (architecture doc §4.1, §12, §18).
 *
 * xterm.js is mounted ONCE into a ref and lives outside React's render cycle.
 * Raw `pty:data` bytes are written straight into the terminal — terminal output
 * never touches React state. Keystrokes flow back to the PTY stdin, and the
 * view size stays synced to the PTY via the fit addon + a ResizeObserver.
 */
export function TerminalMirror({
  onStarted,
  onExit,
}: TerminalMirrorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

  // Keep the latest callbacks in refs so the mount effect can run exactly once
  // (mounting xterm once is an invariant) without going stale.
  const onStartedRef = useRef(onStarted);
  const onExitRef = useRef(onExit);
  onStartedRef.current = onStarted;
  onExitRef.current = onExit;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 10000,
      allowProposedApi: true,
      theme: {
        background: "#0F1117",
        foreground: "#C8C8D0",
        cursor: "#7F77DD",
        cursorAccent: "#0F1117",
        selectionBackground: "#2A2D3A",
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    // 1) verbatim PTY bytes -> xterm, synchronously and unmodified.
    const offData = window.agentwatch.onData((chunk) => term.write(chunk));

    // exit -> quietly annotate and notify the parent (no behavioral change).
    const offExit = window.agentwatch.onExit((info) => {
      const sig = info.signal ? `, signal ${info.signal}` : "";
      term.write(
        `\r\n\x1b[2m── session ended (code ${info.code}${sig}) ──\x1b[0m\r\n`,
      );
      onExitRef.current?.(info);
    });

    // 2) keystrokes / paste -> PTY stdin (bidirectional).
    const inputSub = term.onData((data) => window.agentwatch.sendInput(data));

    // Spawn the PTY at the fitted size so wrapping is correct from byte 0.
    window.agentwatch
      .startPty({ cols: term.cols, rows: term.rows })
      .then((result) => onStartedRef.current?.(result))
      .catch((error: unknown) => {
        term.write(
          `\r\n\x1b[31m[agentwatch] failed to start: ${String(error)}\x1b[0m\r\n`,
        );
      });

    // Keep the PTY size in sync with the view.
    const syncSize = (): void => {
      try {
        fit.fit();
      } catch {
        // fit can throw if the host is briefly 0-sized during layout; ignore.
      }
      window.agentwatch.resize(term.cols, term.rows);
    };
    const resizeObserver = new ResizeObserver(() => syncSize());
    resizeObserver.observe(host);
    window.addEventListener("resize", syncSize);

    term.focus();

    return () => {
      offData();
      offExit();
      inputSub.dispose();
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncSize);
      term.dispose();
    };
  }, []);

  return <div className="terminal-host" ref={hostRef} />;
}
