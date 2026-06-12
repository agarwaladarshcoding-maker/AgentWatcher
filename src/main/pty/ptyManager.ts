import * as pty from "node-pty";
import type { IPty } from "node-pty";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import type { PtyExitInfo } from "../../shared/ipc";

/**
 * Resolve a realistic PATH for spawned commands. A GUI-launched Electron app
 * (double-click, or `open`) inherits only a minimal PATH (/usr/bin:/bin…), so
 * agents installed via Homebrew/nvm/pipx (gemini, claude, node…) can't be found
 * — the New-Terminal flow then fails silently. We load the user's LOGIN shell
 * PATH once and merge in the usual install dirs. Cached after first call.
 */
let cachedPath: string | null = null;
function resolveLoginPath(): string {
  if (cachedPath !== null) return cachedPath;
  let p = process.env.PATH || "";
  if (process.platform !== "win32") {
    try {
      const shell = process.env.SHELL || "/bin/bash";
      const out = execSync(`${shell} -ilc 'printf %s "$PATH"'`, {
        timeout: 4000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      if (out && out.trim()) p = out.trim();
    } catch {
      /* keep the inherited PATH */
    }
    const home = homedir();
    const extra = [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      `${home}/.local/bin`,
      `${home}/bin`,
    ];
    const parts = p.split(":").filter(Boolean);
    for (const dir of extra) if (!parts.includes(dir)) parts.push(dir);
    p = parts.join(":");
  }
  cachedPath = p;
  return p;
}

/**
 * PtyManager — the foundation of the mirror (architecture doc §4.1, §20).
 *
 * It owns the spawned child PTY (we always own the spawn, §4.4), streams its
 * raw output to listeners, and accepts input / resize / kill. It does NOT clean,
 * delay, buffer, or reorder the stream — raw bytes flow straight through. The
 * interpreter tee (Phase 2) will attach as a second, independent listener.
 */
export interface PtySpawnOptions {
  command: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
}

type DataListener = (chunk: string) => void;
type ExitListener = (info: PtyExitInfo) => void;

export class PtyManager {
  private proc: IPty | null = null;
  private readonly dataListeners = new Set<DataListener>();
  private readonly exitListeners = new Set<ExitListener>();

  /** The session identity — the child PID (architecture §4.4). */
  get pid(): number | null {
    return this.proc ? this.proc.pid : null;
  }

  get isRunning(): boolean {
    return this.proc !== null;
  }

  /** Spawn the wrapped command. Idempotent: a second call returns the live pid. */
  start(opts: PtySpawnOptions): number {
    if (this.proc) return this.proc.pid;

    const shell = pty.spawn(opts.command, opts.args, {
      name: "xterm-256color",
      cols: opts.cols > 0 ? opts.cols : 80,
      rows: opts.rows > 0 ? opts.rows : 30,
      cwd: opts.cwd || process.cwd(),
      env: {
        ...(process.env as Record<string, string>),
        PATH: resolveLoginPath(),
      },
    });
    this.proc = shell;

    shell.onData((data) => {
      // Fan out verbatim to every listener (the mirror; later, the interpreter).
      for (const listener of this.dataListeners) listener(data);
    });

    shell.onExit(({ exitCode, signal }) => {
      const info: PtyExitInfo = { code: exitCode, signal };
      for (const listener of this.exitListeners) listener(info);
      this.proc = null;
    });

    return shell.pid;
  }

  /** Send keystrokes / paste / Allow-Deny bytes to the PTY stdin. */
  write(data: string): void {
    this.proc?.write(data);
  }

  /** Keep the PTY size in sync with the rendered view. */
  resize(cols: number, rows: number): void {
    if (!this.proc || cols <= 0 || rows <= 0) return;
    try {
      this.proc.resize(cols, rows);
    } catch {
      // resize can race with exit; ignore once the process is gone.
    }
  }

  /**
   * Forward a kill to the child and GUARANTEE it dies. Agents like the Gemini
   * CLI are Node processes that ignore a soft SIGHUP and often spawn children,
   * so a single default kill frequently left them running. We therefore:
   *   1. signal the whole process GROUP (negative pid) so children die too,
   *   2. start with SIGTERM (graceful), and
   *   3. escalate to SIGKILL after a short grace period if it is still alive.
   */
  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    const proc = this.proc;
    if (!proc) return;
    const pid = proc.pid;

    const signalAll = (sig: NodeJS.Signals): void => {
      // node-pty's own kill (handles the pty master); best for the leader.
      try {
        proc.kill(sig);
      } catch {
        /* may already be gone */
      }
      // The process group (the child is a session leader via node-pty), so this
      // reaches any subprocesses it spawned.
      try {
        process.kill(-pid, sig);
      } catch {
        /* group may not exist / already gone */
      }
    };

    signalAll(signal);

    // Escalate if the process is still alive after the grace period.
    setTimeout(() => {
      if (!this.proc) return; // onExit already cleared it
      try {
        process.kill(pid, 0); // throws if the process is gone
        signalAll("SIGKILL");
      } catch {
        /* already exited — nothing to do */
      }
    }, 1500);
  }

  onData(listener: DataListener): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }
}
