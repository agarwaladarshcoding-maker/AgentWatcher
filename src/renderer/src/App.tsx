import { useEffect, useState } from "react";
import type { LaunchInfo } from "../../main/launch";
import type { PtyExitInfo, PtyStartResult } from "../../shared/ipc";
import { TerminalMirror } from "./components/TerminalMirror";

/**
 * Phase 1 renderer: the faithful terminal mirror is the hero. The topbar +
 * agent header carry quiet metadata (command, pid, live/ended), but they never
 * shout over the terminal. The event feed / notifications panel arrive in later
 * phases.
 */
function App(): JSX.Element {
  const [info, setInfo] = useState<LaunchInfo | null>(null);
  const [pid, setPid] = useState<number | null>(null);
  const [exit, setExit] = useState<PtyExitInfo | null>(null);

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

  const command =
    info && info.command ? [info.command, ...info.args].join(" ") : "shell";
  const running = exit === null;

  const handleStarted = (result: PtyStartResult): void => {
    setPid(result.pid >= 0 ? result.pid : null);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo-dot" aria-hidden="true" />
        <span className="app-name">AgentWatch</span>
        <span
          className={`status-badge ${running ? "live" : "ended"}`}
          role="status"
        >
          {running ? "Watching" : "Session ended"}
        </span>
      </header>

      <main className="stage-terminal">
        <section className="agent-card">
          <div className="agent-header">
            <span
              className={`state-dot ${running ? "live" : "idle"}`}
              aria-hidden="true"
            />
            <span className="agent-name">{command}</span>
            {pid !== null && <span className="agent-pid">pid {pid}</span>}
            <span className={`state-pill ${running ? "running" : "done"}`}>
              {running ? "Live" : exit?.code === 0 ? "Done" : "Exited"}
            </span>
          </div>
          <TerminalMirror onStarted={handleStarted} onExit={setExit} />
        </section>
      </main>
    </div>
  );
}

export default App;
