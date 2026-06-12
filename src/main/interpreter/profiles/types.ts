import type { AgentState } from "../../../shared/types";

/**
 * A swappable set of regex patterns describing how a given agent signals state
 * and permission prompts (architecture doc §6, §21). Profiles are heuristic and
 * degrade gracefully: a missing pattern means "fewer words", never a broken
 * terminal (§18).
 */
export interface AgentProfile {
  name: string;
  match: {
    /** Per-state regexes. A state may be omitted; absence just means no match. */
    state: Partial<Record<AgentState, RegExp[]>>;
    /** Permission-prompt patterns, tested against the rolling buffer tail. */
    permission: RegExp[];
  };
  /** What to write to stdin on Allow / Deny (used by the Phase 3 control plane). */
  responses: { allow: string; deny: string };
}
