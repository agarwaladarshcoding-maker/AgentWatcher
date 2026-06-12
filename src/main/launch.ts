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
