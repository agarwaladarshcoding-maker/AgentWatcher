import { useCallback, useEffect, useRef } from "react";
import { useSessions } from "./store/sessions";
import { TerminalManager } from "./terminal/manager";
import { Sidebar } from "./components/Sidebar";
import { TerminalsLayer } from "./components/TerminalsLayer";
import { EventFeed } from "./components/EventFeed";
import type { AgentState } from "../../shared/types";

const STATE_LABEL: Record<AgentState, string> = {
  idle: "Idle",
  reading: "Reading",
  thinking: "Thinking",
  writing: "Writing",
  waiting: "Waiting",
  done: "Done",
};

/**
 * The one window for all agents: sidebar (list + search + switch) · the active
 * agent's mirror · its event feed. Terminal output is routed straight into the
 * imperative TerminalManager and never enters React state (§18).
 */
function App(): JSX.Element {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const states = useSessions((s) => s.states);
  const setSessions = useSessions((s) => s.setSessions);
  const applyState = useSessions((s) => s.applyState);
  const addEvent = useSessions((s) => s.addEvent);
  const applyExit = useSessions((s) => s.applyExit);

  const managerRef = useRef<TerminalManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new TerminalManager((id, data) =>
      window.agentwatch.sendInput(id, data),
    );
  }
  const manager = managerRef.current;

  useEffect(() => {
    window.agentwatch
      .getSessions()
      .then((list) => setSessions(list))
      .catch(() => {
        /* none yet */
      });

    const offSessions = window.agentwatch.onSessions((list) =>
      setSessions(list),
    );
    const offData = window.agentwatch.onData((m) => manager.write(m.id, m.chunk));
    const offSize = window.agentwatch.onSize((m) =>
      manager.resizeTo(m.id, m.cols, m.rows),
    );
    const offState = window.agentwatch.onState((m) => applyState(m.id, m.state));
    const offEvent = window.agentwatch.onEvent((m) => addEvent(m.id, m.event));
    const offExit = window.agentwatch.onExit((m) => {
      applyExit(m.id, m.info.code);
      const sig = m.info.signal ? `, signal ${m.info.signal}` : "";
      manager.notice(
        m.id,
        `\r\n\x1b[2m── session ended (code ${m.info.code}${sig}) ──\x1b[0m\r\n`,
      );
    });

    return () => {
      offSessions();
      offData();
      offSize();
      offState();
      offEvent();
      offExit();
    };
  }, [manager, setSessions, applyState, addEvent, applyExit]);

  useEffect(() => () => manager.disposeAll(), [manager]);

  const onGuiSize = useCallback(
    (id: string, cols: number, rows: number) =>
      window.agentwatch.resize(id, cols, rows),
    [],
  );

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const activeState: AgentState = active
    ? active.ended
      ? "done"
      : (states[active.id] ?? active.state)
    : "idle";

  const running = sessions.filter((s) => !s.ended).length;
  const waiting = sessions.filter(
    (s) => !s.ended && (states[s.id] ?? s.state) === "waiting",
  ).length;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo-dot" aria-hidden="true" />
        <span className="app-name">AgentWatch</span>
        <span className="status-badge live" role="status">
          {running} running
        </span>
        {waiting > 0 && (
          <span className="status-badge waiting">{waiting} waiting</span>
        )}
      </header>

      <div className="layout">
        <Sidebar />

        <main className="center-col">
          <div className="agent-header">
            {active ? (
              <>
                <span
                  className={`state-dot state-${activeState} ${!active.ended && activeState !== "idle" ? "pulse" : ""}`}
                  aria-hidden="true"
                />
                <span className="agent-name">{active.commandLine}</span>
                <span className="agent-pid">pid {active.pid}</span>
                {active.nativeAttached && (
                  <span
                    className="mirror-chip"
                    title="Mirrored to the native terminal too"
                  >
                    native + GUI
                  </span>
                )}
                <span className={`state-pill state-${activeState}`}>
                  {active.ended ? "Done" : STATE_LABEL[activeState]}
                </span>
              </>
            ) : (
              <span className="agent-name dim">No agent selected</span>
            )}
          </div>

          <TerminalsLayer manager={manager} onGuiSize={onGuiSize} />
        </main>

        <aside className="right-col">
          <EventFeed />
        </aside>
      </div>
    </div>
  );
}

export default App;
