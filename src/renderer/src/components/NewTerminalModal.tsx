import { useState } from "react";
import { Modal } from "./Modal";
import { useSessions } from "../store/sessions";

/**
 * Start a brand-new terminal/agent straight from the app (no native launcher
 * needed). The command is spawned as its own GUI-owned PTY session.
 */
const PRESETS = ["bash", "gemini", "claude", "node", "python3", "npm run dev"];

/** Split a command line into command + args (simple whitespace split). */
function parseCommand(line: string): { command: string; args: string[] } {
  const parts = line.trim().split(/\s+/).filter(Boolean);
  return { command: parts[0] ?? "", args: parts.slice(1) };
}

export function NewTerminalModal({
  onClose,
}: {
  onClose: () => void;
}): JSX.Element {
  const [line, setLine] = useState("");
  const [cwd, setCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setActive = useSessions((s) => s.setActive);

  const run = async (): Promise<void> => {
    const { command, args } = parseCommand(line);
    if (!command) {
      setError("Enter a command to run.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const info = await window.agentwatch.spawn({
        command,
        args,
        cwd: cwd.trim() || undefined,
        cols: 80,
        rows: 24,
      });
      if (info) {
        setActive(info.id);
        onClose();
      } else {
        setError("Could not start that command.");
      }
    } catch {
      setError("Could not start that command.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New terminal"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-allow" onClick={run} disabled={busy}>
            {busy ? "Starting…" : "Run"}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="nt-cmd">
          Command
        </label>
        <input
          id="nt-cmd"
          className="field-input"
          value={line}
          autoFocus
          placeholder="e.g. gemini, claude, bash, npm run dev"
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
        />
        <div className="preset-row">
          {PRESETS.map((p) => (
            <button
              key={p}
              className="preset-chip"
              onClick={() => setLine(p)}
              type="button"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="nt-cwd">
          Working directory (optional)
        </label>
        <input
          id="nt-cwd"
          className="field-input"
          value={cwd}
          placeholder="defaults to your home directory"
          onChange={(e) => setCwd(e.target.value)}
        />
      </div>

      {error && <p className="field-hint confirm-warn">{error}</p>}
      <p className="field-hint">
        It opens here and behaves exactly like a native terminal — fully
        interactive, mirrored, and annotated.
      </p>
    </Modal>
  );
}
