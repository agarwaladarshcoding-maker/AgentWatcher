import { useEffect, useState } from "react";
import type { LaunchInfo } from "../../main/launch";

/**
 * Phase 0 renderer. Just enough to prove the window opens and the preload
 * bridge works: it asks main what command we were launched to watch and shows
 * it. The real dashboard (terminal mirror, event feed, notifications) is
 * built in Phases 1–4.
 */
function App(): JSX.Element {
  const [info, setInfo] = useState<LaunchInfo | null>(null);

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
    info && info.command ? [info.command, ...info.args].join(" ") : null;

  return (
    <div className="shell">
      <header className="topbar">
        <span className="logo-dot" aria-hidden="true" />
        <span className="app-name">AgentWatch</span>
        <span className="phase-badge">Phase 0 · scaffold</span>
      </header>

      <main className="stage">
        <h1>The window opens.</h1>
        <p className="sub">
          The real terminal already exists — AgentWatch will mirror it 1:1 and
          add the words on top. None of that is wired yet; this is the empty
          shell.
        </p>

        <section className="launch-card">
          <div className="launch-label">Launched to watch</div>
          {command ? (
            <code className="launch-cmd">$ {command}</code>
          ) : (
            <code className="launch-cmd dim">
              (no command — started directly, not via the agentwatch launcher)
            </code>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
