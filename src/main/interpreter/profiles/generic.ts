import type { AgentProfile } from "./types";

/**
 * The default profile (architecture doc §21). Any unknown CLI falls back to
 * this and still mirrors perfectly — it just gets fewer annotations. Patterns
 * are intentionally broad and case-insensitive.
 */
export const genericProfile: AgentProfile = {
  name: "generic",
  match: {
    state: {
      idle: [/^\s*[>$#]\s*$/],
      reading: [/\b(reading|opening|loading|scanning|fetching|searching)\b/i],
      thinking: [/\b(thinking|analy[sz]ing|planning|reasoning|considering)\b/i],
      writing: [/\b(writing|editing|creating|patch(ing)?|applying|saving)\b/i],
      waiting: [
        /\?\s*\(y\/n\)/i,
        /\?\s*\(yes\/no\)/i,
        /\bpress\b.*\bto continue\b/i,
        /\besc to cancel\b/i,
      ],
      done: [/\b(done|complete|finished|success(ful)?)\b/i],
    },
    permission: [
      /allow\b.*\?\s*\(y\/n\)/i,
      /\?\s*\(y\/n\)\s*$/im,
      /\?\s*\(yes\/no\)/i,
      /do you want to (allow|proceed|continue|run|execute)/i,
      /\bpermission\b.*\?/i,
      /\bconfirm\b.*\?/i,
      /press\s+enter\s+to\s+(continue|confirm)/i,
      /\benter to submit\b.*\besc to cancel\b/is,
    ],
  },
  responses: { allow: "y\n", deny: "n\n" },
};
