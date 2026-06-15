import type { AgentProfile } from "./types";

/**
 * The default profile (architecture doc §21). Any unknown CLI falls back to
 * this and still mirrors perfectly — it just gets fewer annotations. Patterns
 * are intentionally broad and case-insensitive.
 */
export const genericProfile: AgentProfile = {
  name: "generic",
  match: {
    permission: [
      /allow\b.*\?\s*\(y\/n\)/i,
      /\?\s*\(y\/n\)\s*$/im,
      /\?\s*\(yes\/no\)/i,
      /do you want to (allow|proceed|continue|run|execute)/i,
      /\bpermission\b.*\?/i,
      /\bconfirm\b.*\?/i,
      /press\s+enter\s+to\s+(continue|confirm)/i,
    ],
  },
  responses: { allow: "y\n", deny: "n\n" },
};
