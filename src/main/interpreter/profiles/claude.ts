import type { AgentProfile } from "./types";

/**
 * Claude Code profile — STARTER PATTERNS ONLY.
 *
 * ⚠️ Architecture doc §21: do NOT guess these. Tune against real recorded
 * Claude Code transcripts before trusting them. Mirroring stays byte-perfect
 * regardless; these patterns only enrich "the words".
 */
export const claudeProfile: AgentProfile = {
  name: "claude",
  match: {
    state: {
      idle: [/^\s*>\s*$/],
      reading: [/\b(reading|read|opening|searching|grep)\b/i],
      thinking: [/\b(thinking|pondering|analy[sz]ing|planning)\b/i],
      writing: [/\b(writing|editing|creating|applying edit|patch)\b/i],
      waiting: [/\?\s*\(y\/n\)/i, /\bdo you want to\b/i],
      done: [/\b(done|complete|finished)\b/i],
    },
    permission: [
      /do you want to (make this edit|create|run|proceed)/i,
      /\b(allow|approve)\b.*\?/i,
      /\?\s*\(y\/n\)/i,
    ],
  },
  responses: { allow: "y\n", deny: "n\n" },
};
