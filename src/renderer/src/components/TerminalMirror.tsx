import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type {
  PtyExitInfo,
  PtyStartResult,
  SizeAuthority,
} from "../../../shared/ipc";

interface TerminalMirrorProps {
  onStarted?: (result: PtyStartResult) => void;
  onExit?: (info: PtyExitInfo) => void;
}

/**
 * The sacred GUI mirror (architecture doc §4.1, §12, §18).
 *
 * xterm.js is mounted ONCE into a ref and lives outside React's render cycle.
 * Raw `pty:data` bytes are written straight into the terminal — terminal output
 * never touches React state.
 *
 * Size authority (dual-mirror passthrough): when the native terminal is attached
 * it owns the PTY size, so here we simply render at the PTY size reported via
 * `onSize` and do NOT drive the PTY from our own fit. When there is no native
 * terminal, the GUI mirror fits-to-window and drives the PTY size.
 */
export function TerminalMirror({
  onStarted,
  onExit,
}: TerminalMirrorProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
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

    // Default to mirror authority until startPty tells us otherwise.
    let authority: SizeAuthority = "mirror";

    // 1) verbatim PTY bytes -> xterm, synchronously and unmodified.
    const offData = window.agentwatch.onData((chunk) => term.write(chunk));

    const offExit = window.agentwatch.onExit((info) => {
      const sig = info.signal ? `, signal ${info.signal}` : "";
      term.write(
        `\r\n\x1b[2m── session ended (code ${info.code}${sig}) ──\x1b[0m\r\n`,
      );
      onExitRef.current?.(info);
    });

    // When the native terminal owns size, render at exactly the PTY size.
    const offSize = window.agentwatch.onSize((size) => {
      if (size.cols > 0 && size.rows > 0) {
        try {
          term.resize(size.cols, size.rows);
        } catch {
          /* ignore */
        }
      }
    });

    // 2) keystrokes / paste -> PTY stdin (works alongside the native terminal).
    const inputSub = term.onData((data) => window.agentwatch.sendInput(data));

    // Spawn the single PTY at the fitted size; main decides the size authority.
    window.agentwatch
      .startPty({ cols: term.cols, rows: term.rows })
      .then((result) => {
        authority = result.sizeAuthority;
        if (authority === "native" && result.cols > 0 && result.rows > 0) {
          try {
            term.resize(result.cols, result.rows);
          } catch {
            /* ignore */
          }
        }
        onStartedRef.current?.(result);
      })
      .catch((error: unknown) => {
        term.write(
          `\r\n\x1b[31m[agentwatch] failed to start: ${String(error)}\x1b[0m\r\n`,
        );
      });

    // Container resize: only the mirror-authority case drives the PTY.
    const syncSize = (): void => {
      if (authority !== "mirror") return;
      try {
        fit.fit();
      } catch {
        /* host may briefly be 0-sized during layout */
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
      offSize();
      inputSub.dispose();
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncSize);
      term.dispose();
    };
  }, []);

  return <div className="terminal-host" ref={hostRef} />;
}
