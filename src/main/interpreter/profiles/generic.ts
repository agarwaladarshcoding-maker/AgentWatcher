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
      idle: [/^\s*[>$#❯]\s*$/],
      reading: [
        /\b(reading|read|opening|loading|scanning|fetching|searching|grep|listing|cat|inspecting|viewing)\b/i,
        /\bReadFile\b|\bread_file\b|\bls\b/,
      ],
      thinking: [
        /\b(thinking|analy[sz]ing|planning|reasoning|considering|processing|generating|working on|let me)\b/i,
        /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷]/, // common spinner glyphs
      ],
      writing: [
        /\b(writing|wrote|editing|edited|creating|created|patch(ing)?|applying|applied|saving|saved|updating|updated|modifying|modified)\b/i,
        /\bWriteFile\b|\bwrite_file\b|\bdiff\b/,
      ],
      waiting: [/\?\s*\(y\/n\)/i, /\bpress\b.*\bto continue\b/i, /\(y\/N\)|\(Y\/n\)/],
      done: [/\b(done|complete|completed|finished|success(ful)?)\b/i, /[✓✔]/],
    },
    permission: [
      /allow\b.*\?\s*\(y\/n\)/i,
      /do you want to (allow|proceed|continue|run|execute|apply)/i,
      /\bpermission\b.*\?/i,
      /\b(approve|confirm)\b.*\?/i,
    ],
  },
  responses: { allow: "y\n", deny: "n\n" },
};
