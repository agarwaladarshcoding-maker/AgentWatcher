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
    permission: [
      /apply this change\?/i,
      /allow execution( of)?/i,
      /\b(write|edit|create|delete|run|execute)\b.*\?\s*\(y\/n\)/i,
      /allow\b.*\?\s*\(y\/n\)/i,
      /do you want to (proceed|continue|run|execute|allow)/i,
      /waiting for (user )?confirmation/i,
    ],
  },
  responses: { allow: "y\n", deny: "n\n" },
};
