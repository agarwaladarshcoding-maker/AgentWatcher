import { useCallback, useEffect, useRef, useState } from "react";
import { useSessions } from "./store/sessions";
import { TerminalManager } from "./terminal/manager";
import { Sidebar } from "./components/Sidebar";
import { TerminalsLayer } from "./components/TerminalsLayer";
import { EventFeed } from "./components/EventFeed";
import { NotificationPanel } from "./components/NotificationPanel";
import { HistoryModal } from "./components/HistoryModal";
import { SettingsModal } from "./components/SettingsModal";
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
  const addPermission = useSessions((s) => s.addPermission);
  const resolvePermission = useSessions((s) => s.resolvePermission);
  const pending = useSessions((s) => s.pending);

  const [modal, setModal] = useState<"history" | "settings" | null>(null);

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
    const offPermission = window.agentwatch.onPermission((m) =>
      addPermission(m.id, m.permission),
    );
    const offVerdict = window.agentwatch.onVerdict((m) =>
      resolvePermission(m.id, m.verdict),
    );

    return () => {
      offSessions();
      offData();
      offSize();
      offState();
      offEvent();
      offExit();
      offPermission();
      offVerdict();
    };
  }, [
    manager,
    setSessions,
    applyState,
    addEvent,
    applyExit,
    addPermission,
    resolvePermission,
  ]);

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
  const pendingCount = Object.values(pending).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo-dot" aria-hidden="true" />
        <span className="app-name">AgentWatch</span>
        <span className="status-badge live" role="status">
          {running} running
        </span>
        {pendingCount > 0 && (
          <span className="status-badge waiting">{pendingCount} pending</span>
        )}
        <button className="topbar-btn" onClick={() => setModal("history")}>
          History
        </button>
        <button className="topbar-btn" onClick={() => setModal("settings")}>
          Settings
        </button>
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
                <span className="agent-name">{active.label}</span>
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
          <NotificationPanel />
        </aside>
      </div>

      {modal === "history" && <HistoryModal onClose={() => setModal(null)} />}
      {modal === "settings" && <SettingsModal onClose={() => setModal(null)} />}
    </div>
  );
}

export default App;
