import type { AgentProfile } from "./types";

/**
 * Gemini CLI profile — STARTER PATTERNS ONLY.
 *
 * ⚠️ Architecture doc §21: do NOT guess these. The patterns below are a
 * conservative starting point so unknown-but-likely phrasings get some
 * annotation; they MUST be tuned against real recorded Gemini CLI transcripts
 * (the interpreter golden tests in §14) before we trust them. Until then,
 * mirroring is still byte-perfect — this only affects "the words".
 */
export const geminiProfile: AgentProfile = {
  name: "gemini",
  match: {
    state: {
      idle: [/^\s*>\s*$/],
      reading: [/\b(reading|reading file|loading|scanning)\b/i, /\bReadFile\b/],
      thinking: [/\b(thinking|analy[sz]ing|planning)\b/i],
      writing: [/\b(writing|editing|applying|WriteFile|patch)\b/i],
      waiting: [/\?\s*\(y\/n\)/i, /\bapply this change\b/i],
      done: [/\b(done|completed|finished)\b/i],
    },
    permission: [
      /allow\b.*\?\s*\(y\/n\)/i,
      /\b(write|edit|create|delete|run)\b.*\?\s*\(y\/n\)/i,
      /do you want to proceed/i,
    ],
  },
  responses: { allow: "y\n", deny: "n\n" },
};
