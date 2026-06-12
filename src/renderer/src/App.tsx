import { useEffect, useState } from "react";
import type { LaunchInfo } from "../../main/launch";
import type { PtyExitInfo, PtyStartResult } from "../../shared/ipc";
import type { AgentState } from "../../shared/types";
import { TerminalMirror } from "./components/TerminalMirror";
import { EventFeed } from "./components/EventFeed";
import { useWords } from "./store/words";

const STATE_LABELS: Record<AgentState, string> = {
  idle: "Idle",
  reading: "Reading",
  thinking: "Thinking",
  writing: "Writing",
  waiting: "Waiting",
  done: "Done",
};

/**
 * Phase 2 renderer: the faithful mirror is still the hero, now with "the words"
 * — a header state badge driven by the interpreter and a live event feed in the
 * right column. The terminal stream never enters React state (§18).
 */
function App(): JSX.Element {
  const [info, setInfo] = useState<LaunchInfo | null>(null);
  const [pid, setPid] = useState<number | null>(null);
  const [nativeMirror, setNativeMirror] = useState(false);
  const [exit, setExit] = useState<PtyExitInfo | null>(null);

  const agentState = useWords((s) => s.state);
  const setWordsState = useWords((s) => s.setState);
  const addEvent = useWords((s) => s.addEvent);

  useEffect(() => {
    let active = true;
    window.agentwatch
      .getLaunchInfo()
      .then((result) => {
        if (active) setInfo(result);
      })
      .catch(() => {
        if (active) setInfo({ command: "", args: [], cwd: "" });
      });
    return () => {
      active = false;
    };
  }, []);

  // Subscribe to the words (state + feed). These are safe in React state.
  useEffect(() => {
    const offState = window.agentwatch.onState((state) => setWordsState(state));
    const offEvent = window.agentwatch.onEvent((event) => addEvent(event));
    return () => {
      offState();
      offEvent();
    };
  }, [setWordsState, addEvent]);

  const command =
    info && info.command ? [info.command, ...info.args].join(" ") : "shell";
  const running = exit === null;

  const handleStarted = (result: PtyStartResult): void => {
    setPid(result.pid >= 0 ? result.pid : null);
    setNativeMirror(result.nativeMirror);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo-dot" aria-hidden="true" />
        <span className="app-name">AgentWatch</span>
        {nativeMirror && (
          <span className="mirror-chip" title="Mirrored to the native terminal too">
            native + GUI
          </span>
        )}
        <span
          className={`status-badge ${running ? "live" : "ended"}`}
          role="status"
        >
          {running ? "Watching" : "Session ended"}
        </span>
      </header>

      <div className="layout">
        <main className="left-col">
          <section className="agent-card">
            <div className="agent-header">
              <span
                className={`state-dot state-${running ? agentState : "done"} ${running && agentState !== "idle" ? "pulse" : ""}`}
                aria-hidden="true"
              />
              <span className="agent-name">{command}</span>
              {pid !== null && <span className="agent-pid">pid {pid}</span>}
              <span className={`state-pill state-${running ? agentState : "done"}`}>
                {running ? STATE_LABELS[agentState] : exit?.code === 0 ? "Done" : "Exited"}
              </span>
            </div>
            <TerminalMirror onStarted={handleStarted} onExit={setExit} />
          </section>
        </main>

        <aside className="right-col">
          <EventFeed />
        </aside>
      </div>
    </div>
  );
}

export default App;
