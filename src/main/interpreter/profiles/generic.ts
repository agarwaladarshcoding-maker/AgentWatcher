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
      waiting: [/\?\s*\(y\/n\)/i, /\bpress\b.*\bto continue\b/i],
      done: [/\b(done|complete|finished|success(ful)?)\b/i],
    },
    permission: [
      /allow\b.*\?\s*\(y\/n\)/i,
      /do you want to (allow|proceed|continue)/i,
      /\bpermission\b.*\?/i,
    ],
  },
  responses: { allow: "y\n", deny: "n\n" },
};
