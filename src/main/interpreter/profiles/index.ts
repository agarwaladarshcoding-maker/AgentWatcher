import type { AgentProfile } from "./types";
import { genericProfile } from "./generic";
import { geminiProfile } from "./gemini";
import { claudeProfile } from "./claude";

export type { AgentProfile } from "./types";
export { genericProfile, geminiProfile, claudeProfile };

/**
 * Pick a profile from the wrapped command name. Unknown agents fall back to the
 * generic profile and still mirror perfectly (architecture doc §4.2).
 */
export function selectProfile(command: string): AgentProfile {
  const name = command.toLowerCase();
  if (/\bgemini\b|gemini/.test(name)) return geminiProfile;
  if (/\bclaude\b|claude/.test(name)) return claudeProfile;
  return genericProfile;
}
