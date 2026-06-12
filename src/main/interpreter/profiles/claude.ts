import type { AgentProfile } from "./types";

/**
 * Claude Code profile.
 *
 * Patterns tuned for Claude Code's tool-use confirmation dialogs (the
 * "Do you want to make this edit?" / "❯ 1. Yes  2. Yes, and don't ask again
 * 3. No" menu). Like Gemini, the modern dialog is a selectable menu, so the
 * control plane prefers the parsed numbered options; allow/deny are a fallback.
 * Mirroring stays byte-perfect regardless.
 */
export const claudeProfile: AgentProfile = {
  name: "claude",
  match: {
    state: {
      idle: [/^\s*>\s*$/],
      reading: [/\b(reading|read|opening|searching|grep|glob)\b/i],
      thinking: [/\b(thinking|pondering|analy[sz]ing|planning)\b/i],
      writing: [/\b(writing|editing|creating|applying edit|update|patch)\b/i],
      waiting: [
        /\?\s*\(y\/n\)/i,
        /\bdo you want to\b/i,
        /❯\s*\d+\.\s*yes/i,
      ],
      done: [/\b(done|complete|finished)\b/i],
    },
    permission: [
      /do you want to (make this edit|create|run|proceed|edit|allow)/i,
      /do you want to proceed\?/i,
      /\b(allow|approve)\b.*\?/i,
      /❯\s*\d+\.\s*yes/i,
      /\?\s*\(y\/n\)/i,
    ],
  },
  responses: { allow: "y\n", deny: "n\n" },
};
