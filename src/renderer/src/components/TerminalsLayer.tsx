import { useEffect, useRef } from "react";
import type { TerminalManager } from "../terminal/manager";
import { useSessions } from "../store/sessions";

interface TerminalsLayerProps {
  manager: TerminalManager;
  /** Report the GUI viewer's fitted size for the active session (size negotiation). */
  onGuiSize: (id: string, cols: number, rows: number) => void;
  /** Open the New Terminal dialog (shown as a CTA when there are no agents). */
  onNewTerminal: () => void;
}

/**
 * Renders one xterm host per session, stacked; only the active one is visible.
 * All terminals stay live (they receive output even when hidden), so switching
 * is instant with full scrollback. We only fit/size the active terminal to its
 * container — and because the PTY size is negotiated to the min across viewers,
 * the visible terminal never overflows (fixing the scroll + cursor glitches).
 */
export function TerminalsLayer({
  manager,
  onGuiSize,
  onNewTerminal,
}: TerminalsLayerProps): JSX.Element {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const hosts = useRef<Map<string, HTMLDivElement>>(new Map());

  // Ensure each session has a terminal mounted into its host.
  useEffect(() => {
    for (const s of sessions) {
      const host = hosts.current.get(s.id);
      if (host) manager.attach(s.id, host);
    }
  }, [sessions, manager]);

  // On activation (or session-set change), fit the active terminal, report the
  // GUI size, and focus it.
  useEffect(() => {
    if (!activeId) return;
    const size = manager.fit(activeId);
    if (size) onGuiSize(activeId, size.cols, size.rows);
    manager.focus(activeId);
  }, [activeId, sessions.length, manager, onGuiSize]);

  // Keep the active terminal fitted to the window / panel.
  useEffect(() => {
    if (!activeId) return;
    const refit = (): void => {
      const size = manager.fit(activeId);
      if (size) onGuiSize(activeId, size.cols, size.rows);
    };
    window.addEventListener("resize", refit);
    const host = hosts.current.get(activeId);
    const ro = host ? new ResizeObserver(() => refit()) : null;
    if (host && ro) ro.observe(host);
    return () => {
      window.removeEventListener("resize", refit);
      ro?.disconnect();
    };
  }, [activeId, manager, onGuiSize]);

  return (
    <div className="terminals">
      {sessions.length === 0 && (
        <div className="empty-stage">
          <p>No agents yet.</p>
          <p className="empty-hint">
            Run <code>agentwatch &lt;cli&gt;</code> in any terminal — it appears
            here and mirrors in that terminal too.
          </p>
          <button className="empty-cta" onClick={onNewTerminal}>
            + New terminal
          </button>
        </div>
      )}
      {sessions.map((s) => (
        <div
          key={s.id}
          className={`terminal-host ${s.id === activeId ? "active" : "hidden"}`}
          ref={(el) => {
            if (el) hosts.current.set(s.id, el);
            else hosts.current.delete(s.id);
          }}
        />
      ))}
    </div>
  );
}
