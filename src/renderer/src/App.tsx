import { useCallback, useEffect, useRef, useState } from "react";
import { useSessions } from "./store/sessions";
import { useSettings } from "./store/settings";
import { TerminalManager } from "./terminal/manager";
import { Sidebar } from "./components/Sidebar";
import { TerminalsLayer } from "./components/TerminalsLayer";
import { EventFeed } from "./components/EventFeed";
import { NotificationPanel } from "./components/NotificationPanel";
import { NewTerminalModal } from "./components/NewTerminalModal";
import { SettingsModal } from "./components/SettingsModal";
import { HistoryModal } from "./components/HistoryModal";
import type { AgentState } from "../../shared/types";

const STATE_LABEL: Record<AgentState, string> = {
  idle: "Idle",
  reading: "Reading",
  thinking: "Thinking",
  writing: "Writing",
  waiting: "Waiting",
  done: "Done",
};

/** A soft two-note chime via WebAudio (no asset needed). */
function playChime(): void {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    /* audio not available */
  }
}

type ModalKind = "newTerminal" | "settings" | "history" | null;

/**
 * The one window for all agents: sidebar (list + search + switch + new) · the
 * active agent's mirror · its event feed + permission control plane. Terminal
 * output is routed straight into the imperative TerminalManager and never
 * enters React state (§18).
 */
function App(): JSX.Element {
  const sessions = useSessions((s) => s.sessions);
  const activeId = useSessions((s) => s.activeId);
  const states = useSessions((s) => s.states);
  const pending = useSessions((s) => s.pending);
  const setSessions = useSessions((s) => s.setSessions);
  const setActive = useSessions((s) => s.setActive);
  const applyState = useSessions((s) => s.applyState);
  const addEvent = useSessions((s) => s.addEvent);
  const applyExit = useSessions((s) => s.applyExit);
  const addPending = useSessions((s) => s.addPending);
  const removePending = useSessions((s) => s.removePending);
  const addResponded = useSessions((s) => s.addResponded);

  const syncSettings = useSettings((s) => s.sync);
  const soundEnabled = useSettings((s) => s.settings.sound);

  const [modal, setModal] = useState<ModalKind>(null);

  const managerRef = useRef<TerminalManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = new TerminalManager((id, data) =>
      window.agentwatch.sendInput(id, data),
    );
  }
  const manager = managerRef.current;

  // Keep the latest sound preference in a ref so the stable subscription can read it.
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  useEffect(() => {
    syncSettings();

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

    const offPending = window.agentwatch.onPermissionPending((m) => {
      addPending(m.id, m.permission);
      if (soundRef.current) playChime();
    });
    const offResolved = window.agentwatch.onPermissionResolved((m) =>
      removePending(m.id, m.permissionId),
    );
    const offResponded = window.agentwatch.onPermissionResponded((m) => {
      removePending(m.id, m.responded.id);
      addResponded(m.id, m.responded);
    });
    const offFocus = window.agentwatch.onFocusSession((id) => setActive(id));

    return () => {
      offSessions();
      offData();
      offSize();
      offState();
      offEvent();
      offExit();
      offPending();
      offResolved();
      offResponded();
      offFocus();
    };
  }, [
    manager,
    syncSettings,
    setSessions,
    setActive,
    applyState,
    addEvent,
    applyExit,
    addPending,
    removePending,
    addResponded,
  ]);

  // Crash-safety: dispose terminals whose session was removed/dismissed.
  useEffect(() => {
    manager.pruneExcept(new Set(sessions.map((s) => s.id)));
  }, [sessions, manager]);

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
  const totalPending = Object.values(pending).reduce(
    (sum, list) => sum + list.length,
    0,
  );

  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo-dot" aria-hidden="true" />
        <span className="app-name">AgentWatch</span>
        <span className="topbar-spacer" />
        <span className="status-badge live" role="status">
          {running} running
        </span>
        {totalPending > 0 && (
          <span className="status-badge pending">{totalPending} pending</span>
        )}
        <button
          className="topbar-btn primary"
          onClick={() => setModal("newTerminal")}
        >
          + New terminal
        </button>
        <button className="topbar-btn" onClick={() => setModal("history")}>
          History
        </button>
        <button className="topbar-btn" onClick={() => setModal("settings")}>
          Settings
        </button>
      </header>

      <div className="layout">
        <Sidebar onNewTerminal={() => setModal("newTerminal")} />

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

          <TerminalsLayer
            manager={manager}
            onGuiSize={onGuiSize}
            onNewTerminal={() => setModal("newTerminal")}
          />
        </main>

        <aside className="right-col">
          <EventFeed />
          <NotificationPanel />
        </aside>
      </div>

      {modal === "newTerminal" && (
        <NewTerminalModal onClose={() => setModal(null)} />
      )}
      {modal === "settings" && <SettingsModal onClose={() => setModal(null)} />}
      {modal === "history" && <HistoryModal onClose={() => setModal(null)} />}
    </div>
  );
}

export default App;
