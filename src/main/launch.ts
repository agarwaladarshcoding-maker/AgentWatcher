/**
 * Parses the wrapped command handed to the app by the `agentwatch` launcher.
 *
 * The launcher passes it as AGENTWATCH_ARGV (JSON). When the app is started
 * directly (e.g. `electron .` during development) the env var may be absent,
 * in which case we fall back to a harmless default so the window still opens.
 */
export interface LaunchInfo {
  /** The command to wrap, e.g. "gemini" or "echo". */
  command: string;
  /** Arguments passed after the command, e.g. ["hello"]. */
  args: string[];
  /** Directory the user invoked `agentwatch` from. */
  cwd: string;
}

export function readLaunchInfo(env: NodeJS.ProcessEnv = process.env): LaunchInfo {
  const raw = env.AGENTWATCH_ARGV;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<LaunchInfo>;
      if (parsed && typeof parsed.command === "string") {
        return {
          command: parsed.command,
          args: Array.isArray(parsed.args) ? parsed.args.map(String) : [],
          cwd: typeof parsed.cwd === "string" ? parsed.cwd : process.cwd(),
        };
      }
    } catch {
      // fall through to default
    }
  }

  return { command: "", args: [], cwd: process.cwd() };
}

/** Human-readable form of the wrapped command, e.g. `echo hello`. */
export function formatCommand(info: LaunchInfo): string {
  if (!info.command) return "(no command — started directly)";
  return [info.command, ...info.args].join(" ");
}

/**
 * Resolve the actual command to spawn in the PTY.
 *
 * Normally this is exactly what the user wrapped (`agentwatch gemini`). When the
 * app is started directly without a wrapped command (e.g. `npm run dev`), we
 * fall back to an interactive shell so the mirror is still usable for testing.
 */
export function resolveCommand(info: LaunchInfo): { command: string; args: string[] } {
  if (info.command) return { command: info.command, args: info.args };

  if (process.platform === "win32") {
    return { command: process.env.COMSPEC || "powershell.exe", args: [] };
  }
  return { command: process.env.SHELL || "bash", args: [] };
}
