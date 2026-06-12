import type { AgentProfile } from "./types";

/**
 * Gemini CLI profile.
 *
 * Patterns tuned for Gemini CLI's interactive tool-permission + question
 * dialogs (e.g. "Apply this change?", "Allow execution of …", and the numbered
 * "Answer Questions" menu that ends with "Enter to submit · Esc to cancel").
 * They stay heuristic: a miss only means fewer "words", never a broken mirror.
 *
 * Gemini's modern dialog is an arrow/number selectable menu rather than a raw
 * y/n, so the control plane prefers the parsed numbered options (rendered as
 * buttons). The allow/deny below are a best-effort fallback for older y/n
 * prompts; manual typing in the mirror always works regardless.
 */
export const geminiProfile: AgentProfile = {
  name: "gemini",
  match: {
    state: {
      idle: [/^\s*>\s*$/],
      reading: [
        /\b(reading|reading file|loading|scanning|searching)\b/i,
        /\bReadFile\b/,
        /\bReadFolder\b/,
        /\bSearchText\b/,
      ],
      thinking: [/\b(thinking|analy[sz]ing|planning|reasoning)\b/i],
      writing: [
        /\b(writing|editing|applying|WriteFile|patch)\b/i,
        /\bReplace\b/,
      ],
      waiting: [
        /\?\s*\(y\/n\)/i,
        /\bapply this change\?/i,
        /\benter to submit\b/i,
        /\besc to cancel\b/i,
      ],
      done: [/\b(done|completed|finished)\b/i],
    },
    permission: [
      /apply this change\?/i,
      /allow execution( of)?/i,
      /\b(write|edit|create|delete|run|execute)\b.*\?\s*\(y\/n\)/i,
      /allow\b.*\?\s*\(y\/n\)/i,
      /do you want to (proceed|continue|run|execute|allow)/i,
      /waiting for (user )?confirmation/i,
      /\benter to submit\b[\s\S]*\besc to cancel\b/i,
      /\besc to cancel\b[\s\S]*\benter to submit\b/i,
    ],
  },
  responses: { allow: "y\n", deny: "n\n" },
};
