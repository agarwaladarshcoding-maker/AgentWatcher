/**
 * A swappable description of how a given agent signals a PERMISSION prompt
 * (architecture doc §6, §21). State (working/idle/completed) is no longer
 * regex-matched — it is derived from output activity in the interpreter, which
 * is far more robust across CLIs. Profiles now only need to know how this agent
 * asks for permission and how to answer Allow/Deny.
 *
 * Profiles are heuristic and degrade gracefully: a missing pattern means "fewer
 * permission annotations", never a broken terminal (§18).
 */
export interface AgentProfile {
  name: string;
  match: {
    /** Permission-prompt patterns, tested against the rolling buffer tail. */
    permission: RegExp[];
  };
  /** What to write to stdin on Allow / Deny (used by the Phase 3 control plane). */
  responses: { allow: string; deny: string };
}
